-- 1. New columns on sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_pending numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date date NULL;

-- Backfill existing rows: existing sales are fully paid
UPDATE public.sales
   SET amount_paid = net_total,
       amount_pending = 0,
       payment_status = 'paid'
 WHERE payment_status = 'paid' AND amount_paid = 0;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_sales_store_payment_status ON public.sales(store_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_sales_due_date ON public.sales(store_id, due_date) WHERE payment_status <> 'paid';

-- 2. Replace create_sale_atomic to support pending/partial payments + due_date
CREATE OR REPLACE FUNCTION public.create_sale_atomic(
  p_store_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_delivery jsonb,
  p_discount numeric DEFAULT 0,
  p_due_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_ctx record;
  v_sale_id uuid := gen_random_uuid();
  v_gross numeric := 0;
  v_cost numeric := 0;
  v_net numeric := 0;
  v_profit numeric := 0;
  v_item jsonb;
  v_pay jsonb;
  v_product record;
  v_qty int;
  v_unit_price numeric;
  v_line_total numeric;
  v_ship_fee numeric := coalesce((p_delivery->>'shipping_fee')::numeric,0);
  v_delivery_cost numeric := coalesce((p_delivery->>'delivery_cost')::numeric,0);
  v_paid_total numeric := 0;
  v_pending_total numeric := 0;
  v_method text;
  v_amount numeric;
  v_payment_status text;
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();
  if v_ctx.store_id <> p_store_id then
    raise exception 'store_invalida';
  end if;
  if v_ctx.role not in ('owner','admin','manager','sales') then
    raise exception 'sem_permissao_para_vender';
  end if;

  insert into public.sales(id, store_id, customer_id, status, discount_total, created_by, due_date)
  values (v_sale_id, p_store_id, p_customer_id, 'paid', coalesce(p_discount,0), v_ctx.profile_id, p_due_date);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::int;
    select * into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid
        and store_id = p_store_id
        and is_active = true
      for update;

    if not found then raise exception 'produto_invalido'; end if;
    if v_qty <= 0 then raise exception 'qty_invalida'; end if;
    if v_product.on_hand < v_qty then raise exception 'estoque_insuficiente'; end if;

    v_unit_price := coalesce(nullif(v_item->>'unit_price','')::numeric, v_product.sale_price);
    v_line_total := v_unit_price * v_qty;

    insert into public.sale_items(sale_id, product_id, qty, unit_price, unit_cost, line_total)
    values (v_sale_id, v_product.id, v_qty, v_unit_price, v_product.cost_price, v_line_total);

    insert into public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by)
    values (p_store_id, v_product.id, 'sale_out', -v_qty, v_product.cost_price, 'sale', v_sale_id, v_ctx.profile_id);

    update public.products
      set on_hand = on_hand - v_qty, updated_at = now()
      where id = v_product.id;

    v_gross := v_gross + v_line_total;
    v_cost := v_cost + (v_product.cost_price * v_qty);
  end loop;

  v_net := v_gross - coalesce(p_discount,0) + v_ship_fee;
  v_profit := v_net - v_cost;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    v_method := (v_pay->>'method')::text;
    v_amount := (v_pay->>'amount')::numeric;
    if v_amount is null or v_amount <= 0 then
      continue;
    end if;

    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id)
    values (
      p_store_id, v_sale_id,
      v_method,
      v_amount,
      v_pay->>'provider',
      v_pay->>'external_tx_id'
    );

    if v_method = 'pending' then
      v_pending_total := v_pending_total + v_amount;
    else
      v_paid_total := v_paid_total + v_amount;
      insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by)
      select p_store_id, l.id, 'income', 'venda', v_amount, v_method, 'sale', v_sale_id, 'Recebimento de venda', v_ctx.profile_id
      from public.cash_ledger l
      where l.store_id = p_store_id and l.is_default = true
      limit 1;
    end if;
  end loop;

  if v_pending_total <= 0 then
    v_payment_status := 'paid';
  elsif v_paid_total <= 0 then
    v_payment_status := 'pending';
  else
    v_payment_status := 'partial';
  end if;

  update public.sales
    set gross_total = v_gross,
        shipping_fee = v_ship_fee,
        net_total = v_net,
        cost_total = v_cost,
        profit_gross = v_profit,
        amount_paid = v_paid_total,
        amount_pending = v_pending_total,
        payment_status = v_payment_status
    where id = v_sale_id;

  if p_delivery is not null then
    insert into public.deliveries(store_id, sale_id, method, status, tracking_code, external_delivery_id, delivery_cost)
    values (
      p_store_id, v_sale_id,
      coalesce(p_delivery->>'method','pickup'),
      'pending',
      p_delivery->>'tracking_code',
      p_delivery->>'external_delivery_id',
      v_delivery_cost
    );
  end if;

  insert into public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (p_store_id, v_ctx.profile_id, 'create', 'sale', v_sale_id,
    jsonb_build_object('gross',v_gross,'net',v_net,'profit',v_profit,'paid',v_paid_total,'pending',v_pending_total,'payment_status',v_payment_status));

  return v_sale_id;
end;
$function$;

-- 3. New RPC: settle pending sale payment
CREATE OR REPLACE FUNCTION public.settle_sale_payment(
  p_sale_id uuid,
  p_payments jsonb,
  p_paid_at timestamptz DEFAULT now()
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
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();

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

    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at)
    values (v_sale.store_id, v_sale.id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', p_paid_at);

    insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
    select v_sale.store_id, l.id, 'income', 'venda', v_amount, v_method, 'sale', v_sale.id, 'Recebimento de venda (quitação)', v_ctx.profile_id, p_paid_at
    from public.cash_ledger l
    where l.store_id = v_sale.store_id and l.is_default = true
    limit 1;

    v_added := v_added + v_amount;
  end loop;

  if v_added <= 0 then raise exception 'pagamento_invalido'; end if;

  v_new_paid := v_sale.amount_paid + v_added;
  v_new_pending := greatest(v_sale.amount_pending - v_added, 0);

  -- Remove a "pending" placeholder payment row if fully settled
  if v_new_pending <= 0 then
    delete from public.payments
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'paid';
  elsif v_new_paid > 0 then
    -- Adjust placeholder pending row to remaining balance
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
    jsonb_build_object('added',v_added,'paid',v_new_paid,'pending',v_new_pending,'payment_status',v_new_status));

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status
  );
end;
$function$;