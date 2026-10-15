-- =====================================================================
-- Cobrança Pix gerada pelo Estokfy (Mercado Pago, Orders API).
--
-- Aditiva: não altera settle_sale_payment nem nenhuma RPC existente.
--
-- Por que existe uma função "service" de quitação (mercadopago_pix_apply_paid):
-- settle_sale_payment exige um usuário logado (require_active_profile). O
-- aviso de pagamento do Mercado Pago chega sem usuário. Esta função replica
-- o registro da quitação com as mesmas travas: venda da loja, não quitada,
-- valor exato da cobrança, idempotência por (store_id, idempotency_key).
-- Qualquer mudança na regra de quitação precisa ser espelhada aqui.
--
-- Regras:
--   * Só a Edge Function (service_role) cria e altera cobranças.
--   * Valor da cobrança = saldo devedor da venda no momento da criação.
--   * Pagamento parcial por Pix não existe nesta versão: o valor pago tem
--     que bater exatamente com a cobrança.
-- =====================================================================

create table if not exists public.mercadopago_pix_charges (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores(id) on delete cascade,
  sale_id          uuid not null references public.sales(id),
  amount           numeric(15,2) not null check (amount > 0),
  status           text not null default 'creating'
                   check (status in ('creating','pending','paid','expired','cancelled','failed')),
  mp_order_id      text unique,
  mp_payment_id    text unique,
  qr_code          text,
  qr_code_base64   text,
  ticket_url       text,
  expires_at       timestamptz,
  paid_at          timestamptz,
  last_error       text,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- No máximo uma cobrança aberta por venda.
create unique index if not exists mercadopago_pix_one_open_per_sale
  on public.mercadopago_pix_charges (sale_id)
  where status in ('creating','pending');

create index if not exists mercadopago_pix_store_created_idx
  on public.mercadopago_pix_charges (store_id, created_at desc);

alter table public.mercadopago_pix_charges enable row level security;

drop policy if exists mercadopago_pix_charges_select on public.mercadopago_pix_charges;
create policy mercadopago_pix_charges_select on public.mercadopago_pix_charges
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.store_id = mercadopago_pix_charges.store_id
        and p.role in ('owner','admin','manager','sales','finance')
    )
  );

revoke all on public.mercadopago_pix_charges from anon, authenticated;
grant select on public.mercadopago_pix_charges to authenticated;

-- ── 1. Abrir cobrança (antes de chamar o Mercado Pago) ─────────────────
create or replace function public.mercadopago_pix_begin_charge(
  p_store_id   uuid,
  p_sale_id    uuid,
  p_actor_id   uuid
)
returns public.mercadopago_pix_charges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale    record;
  v_charge  public.mercadopago_pix_charges;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.store_id <> p_store_id then raise exception 'store_invalida'; end if;
  if v_sale.deleted_at is not null or v_sale.status in ('cancelled','refunded','returned') then
    raise exception 'venda_nao_encontrada';
  end if;
  if v_sale.payment_status = 'paid' or coalesce(v_sale.amount_pending, 0) <= 0 then
    raise exception 'venda_ja_quitada';
  end if;

  -- Se já existe cobrança aberta, devolve ela em vez de criar outra.
  select * into v_charge
    from public.mercadopago_pix_charges
   where sale_id = p_sale_id and status in ('creating','pending')
   limit 1;
  if found then return v_charge; end if;

  insert into public.mercadopago_pix_charges (store_id, sale_id, amount, status, created_by)
  values (p_store_id, p_sale_id, round(v_sale.amount_pending, 2), 'creating', p_actor_id)
  returning * into v_charge;

  return v_charge;
end;
$$;

-- ── 2. Guardar o retorno do Mercado Pago ─────────────────────────────
create or replace function public.mercadopago_pix_attach(
  p_charge_id     uuid,
  p_order_id      text,
  p_payment_id    text,
  p_qr_code       text,
  p_qr_code_b64   text,
  p_ticket_url    text,
  p_expires_at    timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mercadopago_pix_charges
     set status         = 'pending',
         mp_order_id    = p_order_id,
         mp_payment_id  = p_payment_id,
         qr_code        = p_qr_code,
         qr_code_base64 = p_qr_code_b64,
         ticket_url     = p_ticket_url,
         expires_at     = p_expires_at,
         last_error     = null,
         updated_at     = now()
   where id = p_charge_id and status = 'creating';
$$;

create or replace function public.mercadopago_pix_mark_failed(p_charge_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mercadopago_pix_charges
     set status = 'failed', last_error = left(p_error, 500), updated_at = now()
   where id = p_charge_id and status = 'creating';
$$;

-- ── 3. Aplicar o status vindo da API (confirmado pela Edge Function) ───
-- p_status: 'paid' | 'pending' | 'expired' | 'cancelled' | 'failed'
-- Para 'paid', registra a quitação. Idempotente: segunda chamada não duplica.
create or replace function public.mercadopago_pix_apply_status(
  p_charge_id      uuid,
  p_status         text,
  p_payment_id     text,
  p_paid_amount    numeric,
  p_paid_at        timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge     public.mercadopago_pix_charges;
  v_sale       record;
  v_ledger_id  uuid;
  v_payment_id uuid;
  v_new_paid   numeric;
  v_new_pend   numeric;
  v_new_status text;
begin
  select * into v_charge from public.mercadopago_pix_charges where id = p_charge_id for update;
  if not found then raise exception 'cobranca_nao_encontrada'; end if;

  if p_status is null or p_status not in ('paid','pending','expired','cancelled','failed') then
    raise exception 'status_invalido';
  end if;

  -- Já quitada: nada a fazer.
  if v_charge.status = 'paid' then
    return jsonb_build_object('charge_id', v_charge.id, 'action', 'already_paid');
  end if;

  if p_status <> 'paid' then
    -- Só move cobranças que ainda estão abertas.
    if v_charge.status in ('creating','pending') then
      update public.mercadopago_pix_charges
         set status = p_status, mp_payment_id = coalesce(p_payment_id, mp_payment_id),
             updated_at = now()
       where id = p_charge_id;
    end if;
    return jsonb_build_object('charge_id', v_charge.id, 'action', 'status_' || p_status);
  end if;

  -- ── Quitação ──
  if v_charge.status not in ('creating','pending') then
    raise exception 'cobranca_nao_aberta';
  end if;
  if p_paid_amount is null or round(p_paid_amount, 2) <> v_charge.amount then
    raise exception 'valor_pago_diferente_da_cobranca';
  end if;

  select * into v_sale from public.sales where id = v_charge.sale_id for update;
  if not found or v_sale.deleted_at is not null then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.store_id <> v_charge.store_id then raise exception 'store_invalida'; end if;
  if v_sale.payment_status = 'paid' then
    -- Venda foi quitada por outro meio enquanto o Pix estava aberto.
    update public.mercadopago_pix_charges
       set status = 'cancelled', last_error = 'venda_ja_quitada', updated_at = now()
     where id = p_charge_id;
    return jsonb_build_object('charge_id', v_charge.id, 'action', 'sale_already_paid');
  end if;
  if v_charge.amount > v_sale.amount_pending then
    raise exception 'valor_maior_que_saldo_devedor';
  end if;

  insert into public.payments (
    store_id, sale_id, method, amount, provider, external_tx_id,
    paid_at, note, idempotency_key
  ) values (
    v_charge.store_id, v_sale.id, 'pix', v_charge.amount, 'mercadopago', p_payment_id,
    p_paid_at, 'Pix Mercado Pago', 'mercadopago:' || p_payment_id
  )
  on conflict (store_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    -- Aviso repetido: o pagamento já existe. Só garante que a cobrança fica paga.
    update public.mercadopago_pix_charges
       set status = 'paid', paid_at = p_paid_at, mp_payment_id = p_payment_id, updated_at = now()
     where id = p_charge_id;
    return jsonb_build_object('charge_id', v_charge.id, 'action', 'duplicate_ignored');
  end if;

  perform public._allocate_payment_fifo_within_sale(v_payment_id, v_sale.id, v_charge.amount);

  select l.id into v_ledger_id
    from public.cash_ledger l
   where l.store_id = v_sale.store_id and l.is_default = true
   limit 1;
  if v_ledger_id is not null then
    insert into public.cash_entries (
      store_id, ledger_id, entry_type, category, amount, payment_method,
      reference_type, reference_id, description, created_by, occurred_at
    ) values (
      v_sale.store_id, v_ledger_id, 'income', 'venda', v_charge.amount, 'pix',
      'sale', v_sale.id, 'Recebimento de venda (Pix Mercado Pago)', v_charge.created_by, p_paid_at
    );
  end if;

  v_new_paid := v_sale.amount_paid + v_charge.amount;
  v_new_pend := greatest(v_sale.amount_pending - v_charge.amount, 0);
  if v_new_pend <= 0 then
    delete from public.payments where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'paid';
  elsif v_new_paid > 0 then
    update public.payments set amount = v_new_pend where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'partial';
  else
    v_new_status := 'pending';
  end if;

  update public.sales
     set amount_paid = v_new_paid,
         amount_pending = v_new_pend,
         payment_status = v_new_status
   where id = v_sale.id;

  update public.mercadopago_pix_charges
     set status = 'paid', paid_at = p_paid_at, mp_payment_id = p_payment_id, updated_at = now()
   where id = p_charge_id;

  insert into public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (v_sale.store_id, v_charge.created_by, 'settle', 'sale', v_sale.id,
    jsonb_build_object('added', v_charge.amount, 'paid', v_new_paid, 'pending', v_new_pend,
      'payment_status', v_new_status, 'source', 'mercadopago_pix', 'mp_payment_id', p_payment_id));

  return jsonb_build_object(
    'charge_id', v_charge.id, 'payment_id', v_payment_id, 'sale_id', v_sale.id,
    'payment_status', v_new_status, 'action', 'paid'
  );
end;
$$;

-- Só o service_role (Edge Functions) executa estas funções.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.mercadopago_pix_begin_charge(uuid,uuid,uuid)',
    'public.mercadopago_pix_attach(uuid,text,text,text,text,text,timestamptz)',
    'public.mercadopago_pix_mark_failed(uuid,text)',
    'public.mercadopago_pix_apply_status(uuid,text,text,numeric,timestamptz)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
