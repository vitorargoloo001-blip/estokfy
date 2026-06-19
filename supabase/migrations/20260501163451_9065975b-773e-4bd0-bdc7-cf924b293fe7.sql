-- Add optional note to payments
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_note_length_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_note_length_check CHECK (note IS NULL OR char_length(note) <= 500);

-- Update settle_sale_payment to accept and persist the note
CREATE OR REPLACE FUNCTION public.settle_sale_payment(
  p_sale_id uuid,
  p_payments jsonb,
  p_paid_at timestamptz DEFAULT now(),
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_ctx record;
  v_sale record;
  v_pay jsonb;
  v_method text;
  v_amount numeric;
  v_added numeric := 0;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_note text;
  v_cash_desc text;
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'observacao_muito_longa';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.store_id <> v_ctx.store_id then raise exception 'store_invalida'; end if;
  if v_ctx.role not in ('owner','admin','manager','sales','finance') then
    raise exception 'sem_permissao_para_quitar';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'venda_ja_quitada';
  end if;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    v_method := (v_pay->>'method')::text;
    v_amount := (v_pay->>'amount')::numeric;
    if v_method = 'pending' then raise exception 'metodo_invalido_para_quitacao'; end if;
    if v_amount is null or v_amount <= 0 then continue; end if;

    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at, note)
    values (v_sale.store_id, v_sale.id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', p_paid_at, v_note);

    v_cash_desc := 'Recebimento de venda (quitação)';
    if v_note is not null then
      v_cash_desc := v_cash_desc || ' — Obs: ' || v_note;
    end if;

    insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
    select v_sale.store_id, l.id, 'income', 'venda', v_amount, v_method, 'sale', v_sale.id, v_cash_desc, v_ctx.profile_id, p_paid_at
    from public.cash_ledger l
    where l.store_id = v_sale.store_id and l.is_default = true
    limit 1;

    v_added := v_added + v_amount;
  end loop;

  if v_added <= 0 then raise exception 'pagamento_invalido'; end if;

  v_new_paid := v_sale.amount_paid + v_added;
  v_new_pending := greatest(v_sale.amount_pending - v_added, 0);

  if v_new_pending <= 0 then
    delete from public.payments
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'paid';
  elsif v_new_paid > 0 then
    update public.payments
       set amount = v_new_pending
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'partial';
  else
    v_new_status := 'pending';
  end if;

  update public.sales
     set amount_paid = v_new_paid,
         amount_pending = v_new_pending,
         payment_status = v_new_status
   where id = v_sale.id;

  insert into public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (v_sale.store_id, v_ctx.profile_id, 'settle', 'sale', v_sale.id,
    jsonb_build_object('added',v_added,'paid',v_new_paid,'pending',v_new_pending,'payment_status',v_new_status,'note',v_note));

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status,
    'note', v_note
  );
end;
$function$;