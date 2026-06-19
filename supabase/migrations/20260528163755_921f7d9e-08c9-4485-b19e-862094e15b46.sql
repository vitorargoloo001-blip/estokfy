
-- ============================================================
-- 1. SCHEMA: sale_date + registered_at em sales
-- ============================================================
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_date date,
  ADD COLUMN IF NOT EXISTS registered_at timestamptz;

-- Backfill: sale_date = data local SP de created_at; registered_at = created_at
UPDATE public.sales
   SET sale_date = COALESCE(sale_date, (created_at AT TIME ZONE 'America/Sao_Paulo')::date),
       registered_at = COALESCE(registered_at, created_at)
 WHERE sale_date IS NULL OR registered_at IS NULL;

ALTER TABLE public.sales
  ALTER COLUMN sale_date SET NOT NULL,
  ALTER COLUMN sale_date SET DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  ALTER COLUMN registered_at SET NOT NULL,
  ALTER COLUMN registered_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sales_store_sale_date
  ON public.sales (store_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_store_sale_date_active
  ON public.sales (store_id, sale_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_store_payment_status
  ON public.sales (store_id, payment_status)
  WHERE deleted_at IS NULL AND payment_status IN ('pending','partial');

-- ============================================================
-- 2. create_sale_atomic: separar created_at (auditoria) de sale_date (comercial)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_sale_atomic(
  p_store_id uuid, p_customer_id uuid, p_items jsonb, p_payments jsonb,
  p_delivery jsonb, p_discount numeric DEFAULT 0, p_due_date date DEFAULT NULL,
  p_sale_date timestamptz DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
declare
  v_ctx record;
  v_sale_id uuid := gen_random_uuid();
  v_gross numeric := 0; v_cost numeric := 0; v_net numeric := 0; v_profit numeric := 0;
  v_item jsonb; v_pay jsonb; v_product record; v_category_name text;
  v_qty int; v_unit_price numeric; v_line_total numeric;
  v_ship_fee numeric := coalesce((p_delivery->>'shipping_fee')::numeric,0);
  v_delivery_cost numeric := coalesce((p_delivery->>'delivery_cost')::numeric,0);
  v_paid_total numeric := 0; v_pending_total numeric := 0;
  v_method text; v_amount numeric; v_payment_status text;
  v_op_date timestamptz;
  v_sale_date date;
  v_real_now timestamptz := now();
  v_is_retroactive boolean;
  v_notes text := nullif(btrim(coalesce(p_notes,'')), '');
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();
  if v_ctx.store_id <> p_store_id then raise exception 'store_invalida'; end if;
  if v_ctx.role not in ('owner','admin','manager','sales') then raise exception 'sem_permissao_para_vender'; end if;

  v_op_date := coalesce(p_sale_date, v_real_now);
  if v_op_date > v_real_now + interval '1 minute' then raise exception 'data_futura_invalida'; end if;
  v_sale_date := (v_op_date AT TIME ZONE 'America/Sao_Paulo')::date;
  v_is_retroactive := v_sale_date < (v_real_now AT TIME ZONE 'America/Sao_Paulo')::date;

  if v_notes is not null and length(v_notes) > 1000 then v_notes := substring(v_notes from 1 for 1000); end if;

  -- created_at = momento REAL do cadastro (auditoria)
  -- sale_date = data comercial da operação
  -- registered_at = duplica created_at para análises explícitas
  insert into public.sales(id, store_id, customer_id, status, discount_total, created_by, due_date, created_at, registered_at, sale_date, notes)
  values (v_sale_id, p_store_id, p_customer_id, 'paid', coalesce(p_discount,0), v_ctx.profile_id, p_due_date, v_real_now, v_real_now, v_sale_date, v_notes);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::int;
    select * into v_product from public.products
     where id = (v_item->>'product_id')::uuid and store_id = p_store_id and is_active = true
     for update;
    if not found then raise exception 'produto_invalido'; end if;
    if v_qty <= 0 then raise exception 'qty_invalida'; end if;
    if v_product.on_hand < v_qty then raise exception 'estoque_insuficiente'; end if;
    v_unit_price := coalesce(nullif(v_item->>'unit_price','')::numeric, v_product.sale_price);
    v_line_total := v_unit_price * v_qty;
    select name into v_category_name from public.categories where id = v_product.category_id;
    insert into public.sale_items(sale_id, product_id, qty, unit_price, unit_cost, line_total,
      product_name_snapshot, product_sku_snapshot, product_category_snapshot)
    values (v_sale_id, v_product.id, v_qty, v_unit_price, v_product.cost_price, v_line_total,
      v_product.name, v_product.sku, v_category_name);
    -- stock_movement created_at = REAL (não data retroativa) para fluxo de estoque coerente
    insert into public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by, created_at, reason)
    values (p_store_id, v_product.id, 'sale_out', -v_qty, v_product.cost_price, 'sale', v_sale_id, v_ctx.profile_id, v_real_now,
            case when v_is_retroactive then 'Venda retroativa data ' || v_sale_date else null end);
    update public.products set on_hand = on_hand - v_qty, updated_at = now() where id = v_product.id;
    v_gross := v_gross + v_line_total;
    v_cost := v_cost + (v_product.cost_price * v_qty);
  end loop;

  v_net := v_gross - coalesce(p_discount,0) + v_ship_fee;
  v_profit := v_net - v_cost;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    v_method := (v_pay->>'method')::text;
    v_amount := (v_pay->>'amount')::numeric;
    if v_amount is null or v_amount <= 0 then continue; end if;
    -- paid_at = v_op_date (à vista paga na data da venda — mesmo que retroativa)
    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at, created_by)
    values (p_store_id, v_sale_id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', v_op_date, v_ctx.profile_id);
    if v_method = 'pending' then
      v_pending_total := v_pending_total + v_amount;
    else
      v_paid_total := v_paid_total + v_amount;
      insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
      select p_store_id, l.id, 'income', 'venda', v_amount, v_method, 'sale', v_sale_id,
             case when v_is_retroactive then 'Recebimento venda retroativa ' || v_sale_date else 'Recebimento de venda' end,
             v_ctx.profile_id, v_op_date
      from public.cash_ledger l where l.store_id = p_store_id and l.is_default = true limit 1;
    end if;
  end loop;

  if v_pending_total <= 0 then v_payment_status := 'paid';
  elsif v_paid_total <= 0 then v_payment_status := 'pending';
  else v_payment_status := 'partial'; end if;

  update public.sales
    set gross_total = v_gross, shipping_fee = v_ship_fee, net_total = v_net,
        cost_total = v_cost, profit_gross = v_profit,
        amount_paid = v_paid_total, amount_pending = v_pending_total,
        payment_status = v_payment_status
    where id = v_sale_id;

  if p_delivery is not null then
    insert into public.deliveries(store_id, sale_id, method, status, tracking_code, external_delivery_id, delivery_cost, created_at)
    values (p_store_id, v_sale_id, coalesce(p_delivery->>'method','pickup'), 'pending',
            p_delivery->>'tracking_code', p_delivery->>'external_delivery_id', v_delivery_cost, v_real_now);
  end if;

  insert into public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (p_store_id, v_ctx.profile_id, 'create', 'sale', v_sale_id,
    jsonb_build_object('gross',v_gross,'net',v_net,'profit',v_profit,
      'paid',v_paid_total,'pending',v_pending_total,'payment_status',v_payment_status,
      'sale_date', v_sale_date, 'registered_at', v_real_now,
      'retroactive', v_is_retroactive, 'notes', v_notes));

  return v_sale_id;
end; $function$;

-- ============================================================
-- 3. RPC v2: obter_relatorio_operacional_v2 (fonte única de verdade)
-- ============================================================
CREATE OR REPLACE FUNCTION public.obter_relatorio_operacional_v2(
  p_store_id uuid, p_start date, p_end date,
  p_employee_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_my_store uuid := public.get_my_store_id();
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_today date;
  v_result jsonb;
BEGIN
  IF v_my_store IS NULL THEN RAISE EXCEPTION 'sem_loja'; END IF;
  IF p_store_id <> v_my_store THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN RAISE EXCEPTION 'periodo_invalido'; END IF;

  v_from_ts := (p_start::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_to_ts   := (p_end::text   || ' 23:59:59.999')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_today   := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  WITH
  -- VENDIDO: por sale_date (data comercial)
  sales_period AS (
    SELECT s.* FROM sales s
    WHERE s.store_id = p_store_id
      AND s.sale_date BETWEEN p_start AND p_end
      AND (p_employee_id IS NULL OR s.created_by = p_employee_id)
      AND (p_customer_id IS NULL OR s.customer_id = p_customer_id)
  ),
  sales_valid AS (
    SELECT * FROM sales_period
    WHERE deleted_at IS NULL AND status NOT IN ('cancelled','refunded','returned')
  ),
  sales_retroactive AS (
    SELECT * FROM sales_valid
    WHERE sale_date < (registered_at AT TIME ZONE 'America/Sao_Paulo')::date
  ),
  -- RECEBIDO: por paid_at
  pays AS (
    SELECT p.*, s.deleted_at AS s_deleted_at, s.status AS s_status, s.sale_date AS s_sale_date, s.customer_id AS s_customer_id
    FROM payments p LEFT JOIN sales s ON s.id = p.sale_id
    WHERE p.store_id = p_store_id
      AND p.paid_at >= v_from_ts AND p.paid_at <= v_to_ts
      AND (p_employee_id IS NULL OR p.created_by = p_employee_id OR s.created_by = p_employee_id)
      AND (p_payment_method IS NULL OR p.method = p_payment_method)
      AND (p_customer_id IS NULL OR s.customer_id = p_customer_id)
  ),
  pays_valid AS (
    SELECT * FROM pays
    WHERE s_deleted_at IS NULL
      AND (s_status IS NULL OR s_status NOT IN ('cancelled','refunded','returned'))
      AND method <> 'pending'
  ),
  pays_ignored AS (
    SELECT * FROM pays
    WHERE s_deleted_at IS NOT NULL OR s_status IN ('cancelled','refunded','returned')
  ),
  -- PENDENTE: estado atual
  receivables AS (
    SELECT s.* FROM sales s
    WHERE s.store_id = p_store_id
      AND s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled','refunded','returned')
      AND s.payment_status IN ('pending','partial')
      AND (p_customer_id IS NULL OR s.customer_id = p_customer_id)
      AND (p_employee_id IS NULL OR s.created_by = p_employee_id)
  ),
  -- Itens vendidos (por sale_date)
  items AS (
    SELECT si.*, sv.sale_date AS sd FROM sale_items si JOIN sales_valid sv ON sv.id = si.sale_id
  ),
  -- Despesas pagas
  expenses AS (
    SELECT ce.* FROM cash_entries ce
    WHERE ce.store_id = p_store_id AND ce.entry_type = 'expense'
      AND ce.occurred_at >= v_from_ts AND ce.occurred_at <= v_to_ts
  ),
  -- Devoluções
  rets AS (
    SELECT r.* FROM returns r
    WHERE r.store_id = p_store_id
      AND r.created_at >= v_from_ts AND r.created_at <= v_to_ts
  ),
  return_items_in AS (SELECT ri.* FROM return_items ri JOIN rets r ON r.id = ri.return_id),
  -- Compras de estoque
  stock_purch AS (
    SELECT sm.* FROM stock_movements sm
    WHERE sm.store_id = p_store_id AND sm.movement_type = 'purchase_in'
      AND sm.created_at >= v_from_ts AND sm.created_at <= v_to_ts
  ),
  -- Duplicidades potenciais
  dup_pays AS (
    SELECT sale_id, method, paid_at::date AS day, amount, COUNT(*) AS occurrences
    FROM pays_valid
    GROUP BY sale_id, method, paid_at::date, amount HAVING COUNT(*) > 1
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_start, 'to', p_end),
    'filters', jsonb_build_object('employee_id', p_employee_id, 'payment_method', p_payment_method, 'customer_id', p_customer_id),
    'vendido', jsonb_build_object(
      'count_total', (SELECT COUNT(*) FROM sales_period),
      'count_valid', (SELECT COUNT(*) FROM sales_valid),
      'count_cancelled', (SELECT COUNT(*) FROM sales_period WHERE status IN ('cancelled','refunded','returned') OR deleted_at IS NOT NULL),
      'gross_total', COALESCE((SELECT SUM(gross_total) FROM sales_valid), 0),
      'net_total', COALESCE((SELECT SUM(net_total) FROM sales_valid), 0),
      'discount_total', COALESCE((SELECT SUM(discount_total) FROM sales_valid), 0),
      'shipping_total', COALESCE((SELECT SUM(shipping_fee) FROM sales_valid), 0),
      'cost_total', COALESCE((SELECT SUM(cost_total) FROM sales_valid), 0),
      'gross_profit', COALESCE((SELECT SUM(profit_gross) FROM sales_valid), 0),
      'items_count', COALESCE((SELECT SUM(qty) FROM items), 0),
      'por_dia', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT sale_date AS day, COUNT(*) AS count, SUM(net_total) AS total
        FROM sales_valid GROUP BY sale_date ORDER BY sale_date) t), '[]'::jsonb),
      'por_forma_no_ato', COALESCE((SELECT jsonb_object_agg(method, total) FROM (
        SELECT COALESCE(NULLIF(p.method,''),'outro') AS method, SUM(p.amount) AS total
        FROM payments p JOIN sales_valid sv ON sv.id = p.sale_id
        WHERE p.paid_at::date = sv.sale_date AND p.method <> 'pending'
        GROUP BY 1) x), '{}'::jsonb)
    ),
    'recebido', jsonb_build_object(
      'total', COALESCE((SELECT SUM(amount) FROM pays_valid), 0),
      'count', (SELECT COUNT(*) FROM pays_valid),
      'by_method', COALESCE((
        SELECT jsonb_object_agg(method, jsonb_build_object('amount', amount, 'count', cnt))
        FROM (SELECT COALESCE(NULLIF(method,''),'outro') AS method, SUM(amount) AS amount, COUNT(*) AS cnt
              FROM pays_valid GROUP BY 1) g), '{}'::jsonb),
      'por_dia', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT paid_at::date AS day, SUM(amount) AS total
        FROM pays_valid GROUP BY 1 ORDER BY 1) t), '[]'::jsonb),
      'ignored_count', (SELECT COUNT(*) FROM pays_ignored),
      'ignored_amount', COALESCE((SELECT SUM(amount) FROM pays_ignored), 0)
    ),
    'pendente', jsonb_build_object(
      'open_total', COALESCE((SELECT SUM(amount_pending) FROM receivables), 0),
      'open_count', (SELECT COUNT(*) FROM receivables),
      'overdue_total', COALESCE((SELECT SUM(amount_pending) FROM receivables WHERE due_date IS NOT NULL AND due_date < v_today), 0),
      'overdue_count', (SELECT COUNT(*) FROM receivables WHERE due_date IS NOT NULL AND due_date < v_today),
      'a_vencer_total', COALESCE((SELECT SUM(amount_pending) FROM receivables WHERE due_date IS NULL OR due_date >= v_today), 0),
      'settled_in_period', COALESCE((SELECT SUM(p.amount) FROM pays_valid p
        JOIN sales s ON s.id = p.sale_id WHERE s.sale_date < p_start), 0)
    ),
    'produtos_top', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
      SELECT COALESCE(MAX(product_name_snapshot), MAX(p.name), 'Produto') AS name,
             COALESCE(MAX(product_sku_snapshot), MAX(p.sku), '-') AS sku,
             COALESCE(MAX(product_category_snapshot), 'Sem categoria') AS category,
             SUM(items.qty) AS qty, SUM(items.line_total) AS revenue
      FROM items LEFT JOIN products p ON p.id = items.product_id
      GROUP BY items.product_id ORDER BY SUM(items.qty) DESC LIMIT 20) t), '[]'::jsonb),
    'funcionarios', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
      SELECT sv.created_by AS profile_id,
             COALESCE(pr.full_name, '—') AS name,
             COUNT(*) AS sales_count, SUM(sv.net_total) AS sold,
             SUM(sv.amount_paid) AS paid, SUM(sv.amount_pending) AS pending,
             COALESCE(AVG(sv.net_total),0) AS ticket_avg
      FROM sales_valid sv LEFT JOIN profiles pr ON pr.id = sv.created_by
      GROUP BY sv.created_by, pr.full_name ORDER BY SUM(sv.net_total) DESC NULLS LAST) t), '[]'::jsonb),
    'devolucoes', jsonb_build_object(
      'count', (SELECT COUNT(*) FROM rets),
      'refund_total', COALESCE((SELECT SUM(refund_amount) FROM return_items_in), 0)
    ),
    'despesas', jsonb_build_object(
      'paid_total', COALESCE((SELECT SUM(amount) FROM expenses), 0),
      'count', (SELECT COUNT(*) FROM expenses),
      'by_category', COALESCE((SELECT jsonb_object_agg(COALESCE(category,'outros'), s)
        FROM (SELECT category, SUM(amount) s FROM expenses GROUP BY category) x), '{}'::jsonb)
    ),
    'stock_purchases', jsonb_build_object(
      'total', COALESCE((SELECT SUM(COALESCE(total_amount, unit_cost * qty)) FROM stock_purch), 0),
      'count', (SELECT COUNT(*) FROM stock_purch)
    ),
    'caixa', jsonb_build_object(
      'entradas', COALESCE((SELECT SUM(amount) FROM pays_valid), 0),
      'saidas', COALESCE((SELECT SUM(amount) FROM expenses), 0)
                + COALESCE((SELECT SUM(refund_amount) FROM return_items_in), 0),
      'saldo', COALESCE((SELECT SUM(amount) FROM pays_valid), 0)
               - COALESCE((SELECT SUM(amount) FROM expenses), 0)
               - COALESCE((SELECT SUM(refund_amount) FROM return_items_in), 0)
    ),
    'alertas', jsonb_build_object(
      'vendas_retroativas', (SELECT COUNT(*) FROM sales_retroactive),
      'duplicidades_pagamentos', (SELECT COUNT(*) FROM dup_pays),
      'vendas_sem_pagamento', (SELECT COUNT(*) FROM sales_valid sv
        WHERE sv.payment_status NOT IN ('pending','partial')
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = sv.id))
    ),
    'auditoria', jsonb_build_object(
      'vendas_usadas', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, sale_date, registered_at, created_at, status, payment_status,
               net_total, amount_paid, amount_pending, customer_id, created_by,
               (sale_date < (registered_at AT TIME ZONE 'America/Sao_Paulo')::date) AS retroactive
        FROM sales_valid ORDER BY sale_date DESC, registered_at DESC) t), '[]'::jsonb),
      'pagamentos_usados', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, sale_id, method, amount, paid_at, s_sale_date, created_by
        FROM pays_valid ORDER BY paid_at DESC) t), '[]'::jsonb),
      'pagamentos_ignorados', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, sale_id, method, amount, paid_at, s_status, s_deleted_at
        FROM pays_ignored ORDER BY paid_at DESC) t), '[]'::jsonb),
      'vendas_ignoradas', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, status, deleted_at, net_total, sale_date
        FROM sales_period WHERE deleted_at IS NOT NULL OR status IN ('cancelled','refunded','returned')
        ORDER BY sale_date DESC) t), '[]'::jsonb),
      'retroativas', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, sale_date, registered_at, net_total FROM sales_retroactive ORDER BY registered_at DESC) t), '[]'::jsonb),
      'duplicidades', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM dup_pays t), '[]'::jsonb)
    )
  ) INTO v_result;
  RETURN v_result;
END; $function$;

GRANT EXECUTE ON FUNCTION public.obter_relatorio_operacional_v2(uuid,date,date,uuid,text,uuid) TO authenticated;

-- ============================================================
-- 4. get_financial_report_summary atualizado: usar sale_date
-- (mantém shape antigo para compatibilidade com Reports.tsx)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_financial_report_summary(
  p_store_id uuid, p_start date, p_end date, p_employee_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_my_store uuid := public.get_my_store_id();
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_today date;
  v_result jsonb;
BEGIN
  IF v_my_store IS NULL THEN RAISE EXCEPTION 'sem_loja'; END IF;
  IF p_store_id <> v_my_store THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN RAISE EXCEPTION 'periodo_invalido'; END IF;

  v_from_ts := (p_start::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_to_ts   := (p_end::text   || ' 23:59:59.999')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_today   := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  WITH
  sales_period AS (
    SELECT s.* FROM sales s
    WHERE s.store_id = p_store_id
      AND s.sale_date BETWEEN p_start AND p_end
      AND (p_employee_id IS NULL OR s.created_by = p_employee_id)
  ),
  sales_valid AS (SELECT * FROM sales_period WHERE deleted_at IS NULL AND status NOT IN ('cancelled','refunded','returned')),
  pays AS (
    SELECT p.*, s.deleted_at AS s_deleted_at, s.status AS s_status
    FROM payments p LEFT JOIN sales s ON s.id = p.sale_id
    WHERE p.store_id = p_store_id AND p.paid_at >= v_from_ts AND p.paid_at <= v_to_ts
      AND (p_employee_id IS NULL OR p.created_by = p_employee_id)
  ),
  pays_valid AS (SELECT * FROM pays WHERE s_deleted_at IS NULL AND (s_status IS NULL OR s_status NOT IN ('cancelled','refunded','returned')) AND method <> 'pending'),
  pays_ignored AS (SELECT * FROM pays WHERE s_deleted_at IS NOT NULL OR s_status IN ('cancelled','refunded','returned')),
  receivables AS (
    SELECT s.* FROM sales s
    WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled','refunded','returned')
      AND s.payment_status IN ('pending','partial')
  ),
  items AS (SELECT si.* FROM sale_items si JOIN sales_valid sv ON sv.id = si.sale_id),
  expenses AS (SELECT ce.* FROM cash_entries ce WHERE ce.store_id = p_store_id AND ce.entry_type = 'expense' AND ce.occurred_at >= v_from_ts AND ce.occurred_at <= v_to_ts),
  rets AS (SELECT r.* FROM returns r WHERE r.store_id = p_store_id AND r.created_at >= v_from_ts AND r.created_at <= v_to_ts),
  return_items_in AS (SELECT ri.* FROM return_items ri JOIN rets r ON r.id = ri.return_id),
  stock_purch AS (SELECT sm.* FROM stock_movements sm WHERE sm.store_id = p_store_id AND sm.movement_type = 'purchase_in' AND sm.created_at >= v_from_ts AND sm.created_at <= v_to_ts)
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_start, 'to', p_end),
    'sales', jsonb_build_object(
      'count_total', (SELECT COUNT(*) FROM sales_period),
      'count_valid', (SELECT COUNT(*) FROM sales_valid),
      'count_cancelled', (SELECT COUNT(*) FROM sales_period WHERE status IN ('cancelled','refunded','returned') OR deleted_at IS NOT NULL),
      'gross_total', COALESCE((SELECT SUM(gross_total) FROM sales_valid), 0),
      'net_total', COALESCE((SELECT SUM(net_total) FROM sales_valid), 0),
      'discount_total', COALESCE((SELECT SUM(discount_total) FROM sales_valid), 0),
      'shipping_total', COALESCE((SELECT SUM(shipping_fee) FROM sales_valid), 0),
      'cost_total', COALESCE((SELECT SUM(cost_total) FROM sales_valid), 0),
      'gross_profit', COALESCE((SELECT SUM(profit_gross) FROM sales_valid), 0)
    ),
    'received', jsonb_build_object(
      'total', COALESCE((SELECT SUM(amount) FROM pays_valid), 0),
      'count', (SELECT COUNT(*) FROM pays_valid),
      'by_method', COALESCE((SELECT jsonb_object_agg(method, jsonb_build_object('amount', amount, 'count', cnt))
        FROM (SELECT COALESCE(NULLIF(method,''),'outro') AS method, SUM(amount) AS amount, COUNT(*) AS cnt FROM pays_valid GROUP BY 1) g), '{}'::jsonb),
      'ignored_count', (SELECT COUNT(*) FROM pays_ignored),
      'ignored_amount', COALESCE((SELECT SUM(amount) FROM pays_ignored), 0)
    ),
    'receivables', jsonb_build_object(
      'open_total', COALESCE((SELECT SUM(amount_pending) FROM receivables), 0),
      'open_count', (SELECT COUNT(*) FROM receivables),
      'overdue_total', COALESCE((SELECT SUM(amount_pending) FROM receivables WHERE due_date IS NOT NULL AND due_date < v_today), 0),
      'overdue_count', (SELECT COUNT(*) FROM receivables WHERE due_date IS NOT NULL AND due_date < v_today),
      'settled_in_period', COALESCE((SELECT SUM(p.amount) FROM pays_valid p JOIN sales s ON s.id = p.sale_id WHERE s.sale_date < p_start), 0)
    ),
    'items_sold', COALESCE((SELECT SUM(qty) FROM items), 0),
    'top_products', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (
      SELECT COALESCE(MAX(product_name_snapshot), MAX(p.name), 'Produto') AS name,
             COALESCE(MAX(product_sku_snapshot), MAX(p.sku), '-') AS sku,
             COALESCE(MAX(product_category_snapshot), 'Sem categoria') AS category,
             SUM(items.qty) AS qty, SUM(items.line_total) AS revenue
      FROM items LEFT JOIN products p ON p.id = items.product_id
      GROUP BY items.product_id ORDER BY SUM(items.qty) DESC LIMIT 10) t), '[]'::jsonb),
    'expenses', jsonb_build_object(
      'paid_total', COALESCE((SELECT SUM(amount) FROM expenses), 0),
      'count', (SELECT COUNT(*) FROM expenses),
      'by_category', COALESCE((SELECT jsonb_object_agg(COALESCE(category,'outros'), s) FROM (SELECT category, SUM(amount) s FROM expenses GROUP BY category) x), '{}'::jsonb)
    ),
    'stock_purchases', jsonb_build_object(
      'total', COALESCE((SELECT SUM(COALESCE(total_amount, unit_cost * qty)) FROM stock_purch), 0),
      'count', (SELECT COUNT(*) FROM stock_purch)
    ),
    'returns', jsonb_build_object('count', (SELECT COUNT(*) FROM rets), 'refund_total', COALESCE((SELECT SUM(refund_amount) FROM return_items_in), 0)),
    'net_cash', COALESCE((SELECT SUM(amount) FROM pays_valid), 0) - COALESCE((SELECT SUM(amount) FROM expenses), 0) - COALESCE((SELECT SUM(refund_amount) FROM return_items_in), 0),
    'audit', jsonb_build_object(
      'payments_used', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT id, sale_id, method, amount, paid_at, created_by FROM pays_valid ORDER BY paid_at) t), '[]'::jsonb),
      'payments_ignored', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT id, sale_id, method, amount, paid_at, s_status, s_deleted_at FROM pays_ignored ORDER BY paid_at) t), '[]'::jsonb),
      'sales_ignored', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT id, status, deleted_at, net_total FROM sales_period WHERE deleted_at IS NOT NULL OR status IN ('cancelled','refunded','returned') ORDER BY sale_date) t), '[]'::jsonb),
      'possible_duplicates', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT sale_id, method, paid_at::date AS day, amount, COUNT(*) AS occurrences FROM pays_valid GROUP BY sale_id, method, paid_at::date, amount HAVING COUNT(*) > 1) t), '[]'::jsonb)
    )
  ) INTO v_result;
  RETURN v_result;
END; $function$;
