-- Receivables: reject deleted/cancelled sales, invalid methods and fractional/extra cents.
BEGIN;

CREATE OR REPLACE FUNCTION public.settle_sale_payment(p_sale_id uuid, p_payments jsonb, p_paid_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text)
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
  v_payment_id uuid;
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();

  if p_paid_at is null or not isfinite(p_paid_at) or (p_paid_at at time zone 'America/Sao_Paulo')::date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'data_recebimento_invalida';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'observacao_muito_longa';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.deleted_at is not null or v_sale.status = 'cancelled' then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.store_id <> v_ctx.store_id then raise exception 'store_invalida'; end if;
  if v_ctx.role not in ('owner','admin','manager','sales','finance') then
    raise exception 'sem_permissao_para_quitar';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'venda_ja_quitada';
  end if;

  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then raise exception 'pagamento_invalido'; end if;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    v_method := (v_pay->>'method')::text;
    v_amount := (v_pay->>'amount')::numeric;
    if v_method is null or v_method not in ('pix', 'cash', 'credit_card', 'debit_card', 'transfer') then raise exception 'metodo_invalido_para_quitacao'; end if;
    if v_amount is null or v_amount::text in ('NaN', 'Infinity', '-Infinity') or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'pagamento_invalido'; end if;

    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at, note)
    values (v_sale.store_id, v_sale.id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', p_paid_at, v_note)
    returning id into v_payment_id;

    perform public._allocate_payment_fifo_within_sale(v_payment_id, v_sale.id, v_amount);

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

  -- Trava: nunca aceitar mais do que a dívida real (lida sob FOR UPDATE acima).
  -- Sem isso, o excesso era absorvido em amount_paid sem erro, quebrando
  -- amount_paid + amount_pending = net_total (confirmado em 46 vendas de
  -- produção via o recebimento em lote de BatchSettlePaymentDialog.tsx).
  if v_added > v_sale.amount_pending then
    raise exception 'valor_maior_que_saldo_devedor';
  end if;

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
    'payment_id', v_payment_id,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status,
    'note', v_note
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.settle_sale_items_payment(p_sale_id uuid, p_item_allocations jsonb, p_method text, p_paid_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx record;
  v_sale record;
  v_alloc jsonb;
  v_sale_item_id uuid;
  v_amount numeric;
  v_item_balance numeric;
  v_total numeric := 0;
  v_payment_id uuid;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_note text;
  v_cash_desc text;
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();

  if p_paid_at is null or not isfinite(p_paid_at) or (p_paid_at at time zone 'America/Sao_Paulo')::date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'data_recebimento_invalida';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'observacao_muito_longa';
  end if;

  if p_method is null or p_method not in ('pix', 'cash', 'credit_card', 'debit_card', 'transfer') then
    raise exception 'metodo_invalido_para_quitacao';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.deleted_at is not null or v_sale.status = 'cancelled' then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.store_id <> v_ctx.store_id then raise exception 'store_invalida'; end if;
  if v_ctx.role not in ('owner','admin','manager','sales','finance') then
    raise exception 'sem_permissao_para_quitar';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'venda_ja_quitada';
  end if;

  if p_item_allocations is null or jsonb_typeof(p_item_allocations) <> 'array' or jsonb_array_length(p_item_allocations) = 0 then
    raise exception 'nenhum_item_selecionado';
  end if;

  if round(v_sale.amount_pending, 2) <> (
    select coalesce(sum(greatest(li.line_total - coalesce((
      select sum(pa.amount) from public.payment_allocations pa where pa.sale_item_id = li.id
    ), 0), 0)), 0) from public.sale_items li where li.sale_id = p_sale_id
  ) then raise exception 'saldo_itens_divergente'; end if;

  -- Rejeita sale_item_id duplicado no mesmo request -- sem isso, duas
  -- entradas pro mesmo item passariam a validação individualmente (cada
  -- uma sozinha cabe no saldo) mas juntas ultrapassariam o saldo real.
  if (select count(*) from jsonb_array_elements(p_item_allocations)) <>
     (select count(distinct (elem->>'sale_item_id')) from jsonb_array_elements(p_item_allocations) elem) then
    raise exception 'item_duplicado_na_requisicao';
  end if;

  for v_alloc in select * from jsonb_array_elements(p_item_allocations)
  loop
    v_sale_item_id := (v_alloc->>'sale_item_id')::uuid;
    v_amount := (v_alloc->>'amount')::numeric;
    if v_amount is null or v_amount::text in ('NaN', 'Infinity', '-Infinity') or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'pagamento_invalido'; end if;

    if not exists (select 1 from public.sale_items where id = v_sale_item_id and sale_id = p_sale_id) then
      raise exception 'item_nao_pertence_a_venda';
    end if;

    select li.line_total - coalesce((
      select sum(pa.amount) from public.payment_allocations pa where pa.sale_item_id = li.id
    ), 0) into v_item_balance
    from public.sale_items li
    where li.id = v_sale_item_id;

    if v_amount > coalesce(v_item_balance, 0) then
      raise exception 'valor_maior_que_saldo_devedor_do_item';
    end if;

    v_total := v_total + v_amount;
  end loop;

  if v_total <= 0 then raise exception 'pagamento_invalido'; end if;

  -- Defesa em profundidade: confere de novo no nível da venda (mesma trava
  -- de settle_sale_payment), mesmo que a soma dos itens já não devesse
  -- ultrapassar isso.
  if v_total > v_sale.amount_pending then
    raise exception 'valor_maior_que_saldo_devedor';
  end if;

  v_cash_desc := 'Recebimento de venda (baixa por item)';
  if v_note is not null then
    v_cash_desc := v_cash_desc || ' — Obs: ' || v_note;
  end if;

  insert into public.payments(store_id, sale_id, method, amount, paid_at, note, created_by)
  values (v_sale.store_id, v_sale.id, p_method, v_total, p_paid_at, v_note, v_ctx.profile_id)
  returning id into v_payment_id;

  insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
  select v_sale.store_id, l.id, 'income', 'venda', v_total, p_method, 'sale', v_sale.id, v_cash_desc, v_ctx.profile_id, p_paid_at
  from public.cash_ledger l
  where l.store_id = v_sale.store_id and l.is_default = true
  limit 1;

  for v_alloc in select * from jsonb_array_elements(p_item_allocations)
  loop
    v_sale_item_id := (v_alloc->>'sale_item_id')::uuid;
    v_amount := (v_alloc->>'amount')::numeric;
    if v_amount is null or v_amount::text in ('NaN', 'Infinity', '-Infinity') or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'pagamento_invalido'; end if;

    insert into public.payment_allocations(store_id, payment_id, sale_id, sale_item_id, amount)
    values (v_sale.store_id, v_payment_id, p_sale_id, v_sale_item_id, v_amount);
  end loop;

  v_new_paid := v_sale.amount_paid + v_total;
  v_new_pending := greatest(v_sale.amount_pending - v_total, 0);

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
  values (v_sale.store_id, v_ctx.profile_id, 'settle_by_item', 'sale', v_sale.id,
    jsonb_build_object('payment_id', v_payment_id, 'added', v_total, 'paid', v_new_paid,
      'pending', v_new_pending, 'payment_status', v_new_status, 'note', v_note,
      'item_allocations', p_item_allocations));

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'payment_id', v_payment_id,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status,
    'note', v_note
  );
end;
$function$;

COMMIT;
