-- Reporting consistency audit (2026-10-02). Definitions based on the live database.
-- No historical sales/payments are changed. Cash outflows are counted once;
-- noncash settlements and cancelled returns are excluded, seller/date filters
-- are consistent, and reconciliation summaries agree on incoming amounts.

CREATE OR REPLACE FUNCTION public.get_financial_report_summary(p_store_id uuid, p_start date, p_end date, p_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  v_to_ts   := ((p_end + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
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
    WHERE p.store_id = p_store_id AND p.paid_at >= v_from_ts AND p.paid_at < v_to_ts
      AND (p_employee_id IS NULL OR COALESCE(s.created_by,p.created_by) = p_employee_id)
  ),
  pays_valid AS (SELECT * FROM pays WHERE s_deleted_at IS NULL AND (s_status IS NULL OR s_status NOT IN ('cancelled','refunded','returned')) AND COALESCE(method,'') NOT IN ('pending','a_prazo','credit','return_offset')),
  pays_ignored AS (SELECT * FROM pays WHERE s_deleted_at IS NOT NULL OR s_status IN ('cancelled','refunded','returned') OR COALESCE(method,'') IN ('pending','a_prazo','credit','return_offset')),
  receivables AS (
    SELECT s.* FROM sales s
    WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled','refunded','returned')
      AND s.payment_status IN ('pending','partial')
      AND (p_employee_id IS NULL OR s.created_by = p_employee_id)
  ),
  items AS (SELECT si.* FROM sale_items si JOIN sales_valid sv ON sv.id = si.sale_id),
  other_income AS (
    SELECT ce.* FROM cash_entries ce
    WHERE ce.store_id = p_store_id AND ce.entry_type = 'income'
      AND ce.occurred_at >= v_from_ts AND ce.occurred_at < v_to_ts
      AND ce.payment_id IS NULL
      AND COALESCE(ce.reference_type,'') NOT IN ('sale','sale_payment','payment')
      AND (p_employee_id IS NULL OR ce.created_by = p_employee_id)
  ),
  expenses AS (SELECT ce.* FROM cash_entries ce WHERE ce.store_id = p_store_id AND ce.entry_type = 'expense' AND ce.occurred_at >= v_from_ts AND ce.occurred_at < v_to_ts AND (p_employee_id IS NULL OR ce.created_by = p_employee_id)),
  rets AS (SELECT r.* FROM returns r WHERE r.store_id = p_store_id AND r.created_at >= v_from_ts AND r.created_at < v_to_ts AND r.status <> 'cancelled' AND (p_employee_id IS NULL OR r.created_by = p_employee_id)),
  return_items_in AS (SELECT ri.* FROM return_items ri JOIN rets r ON r.id = ri.return_id),
  stock_purch AS (SELECT sm.* FROM stock_movements sm WHERE sm.store_id = p_store_id AND sm.movement_type = 'purchase_in' AND sm.created_at >= v_from_ts AND sm.created_at < v_to_ts AND (p_employee_id IS NULL OR sm.created_by = p_employee_id))
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
    'net_cash', COALESCE((SELECT SUM(amount) FROM pays_valid), 0) + COALESCE((SELECT SUM(amount) FROM other_income), 0) - COALESCE((SELECT SUM(amount) FROM expenses), 0),
    'audit', jsonb_build_object(
      'payments_used', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT id, sale_id, method, amount, paid_at, created_by FROM pays_valid ORDER BY paid_at) t), '[]'::jsonb),
      'payments_ignored', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT id, sale_id, method, amount, paid_at, s_status, s_deleted_at FROM pays_ignored ORDER BY paid_at) t), '[]'::jsonb),
      'sales_ignored', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT id, status, deleted_at, net_total FROM sales_period WHERE deleted_at IS NOT NULL OR status IN ('cancelled','refunded','returned') ORDER BY sale_date) t), '[]'::jsonb),
      'possible_duplicates', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT sale_id, method, (paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, amount, COUNT(*) AS occurrences FROM pays_valid GROUP BY sale_id, method, (paid_at AT TIME ZONE 'America/Sao_Paulo')::date, amount HAVING COUNT(*) > 1) t), '[]'::jsonb)
    )
  ) INTO v_result;
  RETURN v_result;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.get_financial_report_summary(uuid,date,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_report_summary(uuid,date,date,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.obter_relatorio_operacional_v2(p_store_id uuid, p_start date, p_end date, p_employee_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT NULL::text, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  v_to_ts   := ((p_end + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
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
      AND p.paid_at >= v_from_ts AND p.paid_at < v_to_ts
      AND (p_employee_id IS NULL OR COALESCE(s.created_by,p.created_by) = p_employee_id)
      AND (p_payment_method IS NULL OR p.method = p_payment_method)
      AND (p_customer_id IS NULL OR s.customer_id = p_customer_id)
  ),
  pays_valid AS (
    SELECT * FROM pays
    WHERE s_deleted_at IS NULL
      AND (s_status IS NULL OR s_status NOT IN ('cancelled','refunded','returned'))
      AND COALESCE(method,'') NOT IN ('pending','a_prazo','credit','return_offset')
  ),
  pays_ignored AS (
    SELECT * FROM pays
    WHERE s_deleted_at IS NOT NULL OR s_status IN ('cancelled','refunded','returned') OR COALESCE(method,'') IN ('pending','a_prazo','credit','return_offset')
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
  other_income AS (
    SELECT ce.* FROM cash_entries ce
    WHERE ce.store_id = p_store_id AND ce.entry_type = 'income'
      AND ce.occurred_at >= v_from_ts AND ce.occurred_at < v_to_ts
      AND ce.payment_id IS NULL
      AND COALESCE(ce.reference_type,'') NOT IN ('sale','sale_payment','payment')
      AND (p_employee_id IS NULL OR ce.created_by = p_employee_id)
  ),
  expenses AS (
    SELECT ce.* FROM cash_entries ce
    WHERE ce.store_id = p_store_id AND ce.entry_type = 'expense'
      AND ce.occurred_at >= v_from_ts AND ce.occurred_at < v_to_ts AND (p_employee_id IS NULL OR ce.created_by = p_employee_id)
  ),
  -- Devoluções
  rets AS (
    SELECT r.* FROM returns r
    WHERE r.store_id = p_store_id
      AND r.created_at >= v_from_ts AND r.created_at < v_to_ts AND r.status <> 'cancelled' AND (p_employee_id IS NULL OR r.created_by = p_employee_id)
  ),
  return_items_in AS (SELECT ri.* FROM return_items ri JOIN rets r ON r.id = ri.return_id),
  -- Compras de estoque
  stock_purch AS (
    SELECT sm.* FROM stock_movements sm
    WHERE sm.store_id = p_store_id AND sm.movement_type = 'purchase_in'
      AND sm.created_at >= v_from_ts AND sm.created_at < v_to_ts AND (p_employee_id IS NULL OR sm.created_by = p_employee_id)
  ),
  -- Duplicidades potenciais
  dup_pays AS (
    SELECT sale_id, method, (paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, amount, COUNT(*) AS occurrences
    FROM pays_valid
    GROUP BY sale_id, method, (paid_at AT TIME ZONE 'America/Sao_Paulo')::date, amount HAVING COUNT(*) > 1
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
        WHERE (p.paid_at AT TIME ZONE 'America/Sao_Paulo')::date = sv.sale_date AND COALESCE(p.method,'') NOT IN ('pending','a_prazo','credit','return_offset')
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
        SELECT (paid_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, SUM(amount) AS total
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
      'entradas', COALESCE((SELECT SUM(amount) FROM pays_valid), 0) + COALESCE((SELECT SUM(amount) FROM other_income), 0),
      'saidas', COALESCE((SELECT SUM(amount) FROM expenses), 0),
      'saldo', COALESCE((SELECT SUM(amount) FROM pays_valid), 0) + COALESCE((SELECT SUM(amount) FROM other_income), 0) - COALESCE((SELECT SUM(amount) FROM expenses), 0)
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

REVOKE EXECUTE ON FUNCTION public.obter_relatorio_operacional_v2(uuid,date,date,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obter_relatorio_operacional_v2(uuid,date,date,uuid,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_reconciliation_report(p_store_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summary jsonb;
  v_txns    jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.is_active
      AND p.role IN ('owner','admin','manager','finance','viewer')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN RAISE EXCEPTION 'periodo_invalido'; END IF;

  SELECT jsonb_build_object(
    'period_start',         p_start_date,
    'period_end',           p_end_date,
    'total_transactions',   COUNT(*),
    'total_amount',         COALESCE(SUM(bt.amount) FILTER (WHERE bt.transaction_type = 'credit'), 0),
    'reconciled_count',     COUNT(*) FILTER (WHERE bt.status IN ('reconciled','confirmed')),
    'reconciled_amount',    COALESCE(SUM(bt.amount) FILTER (WHERE bt.status IN ('reconciled','confirmed') AND bt.transaction_type = 'credit'), 0),
    'divergent_count',      COUNT(*) FILTER (WHERE bt.status = 'divergent'),
    'divergent_amount',     COALESCE(SUM(bt.amount) FILTER (WHERE bt.status = 'divergent' AND bt.transaction_type = 'credit'), 0),
    'pending_count',        COUNT(*) FILTER (WHERE bt.status = 'pending'),
    'pending_amount',       COALESCE(SUM(bt.amount) FILTER (WHERE bt.status = 'pending' AND bt.transaction_type = 'credit'), 0),
    'ignored_count',        COUNT(*) FILTER (WHERE bt.status = 'ignored'),
    'reconciliation_rate',  CASE
      WHEN COUNT(*) FILTER (WHERE bt.transaction_type = 'credit') > 0
        THEN round(
          COUNT(*) FILTER (WHERE bt.status IN ('reconciled','confirmed') AND bt.transaction_type = 'credit')::numeric
          / COUNT(*) FILTER (WHERE bt.transaction_type = 'credit') * 100
        , 1)
      ELSE 0
    END
  )
  INTO v_summary
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND bt.transaction_date BETWEEN p_start_date AND p_end_date;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                 bt.id,
        'transaction_date',   bt.transaction_date,
        'amount',             bt.amount,
        'method',             COALESCE(bt.method, 'other'),
        'description',        COALESCE(bt.description, '—'),
        'bank_name',          COALESCE(bt.bank_name, '—'),
        'status',             CASE WHEN bt.status = 'confirmed' THEN 'reconciled' ELSE bt.status END,
        'transaction_type',   bt.transaction_type,
        'sale_id',            COALESCE(rm.sale_id, bt.sale_id),
        'customer_name',      COALESCE(c.name, '—'),
        'match_type',         COALESCE(rm.match_type, '—'),
        'confidence_score',   rm.confidence_score,
        'confirmed_at',       rm.confirmed_at,
        'confirmed_by_email', u.email
      )
      ORDER BY bt.transaction_date DESC, bt.amount DESC
    ),
    '[]'::jsonb
  )
  INTO v_txns
  FROM public.bank_transactions bt
  LEFT JOIN LATERAL (SELECT match.* FROM public.reconciliation_matches match
    WHERE match.bank_transaction_id = bt.id AND match.status = 'confirmed'
    ORDER BY match.confirmed_at DESC NULLS LAST, match.id DESC LIMIT 1) rm ON true
  LEFT JOIN public.sales s ON s.id = COALESCE(rm.sale_id, bt.sale_id)
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.profiles pr ON pr.id = rm.confirmed_by
  LEFT JOIN auth.users u ON u.id = pr.auth_user_id
  WHERE bt.store_id = p_store_id
    AND bt.transaction_date BETWEEN p_start_date AND p_end_date;

  RETURN jsonb_build_object(
    'summary',      v_summary,
    'transactions', v_txns
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_reconciliation_report(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reconciliation_report(uuid,date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_reconciliation_by_method(p_store_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS TABLE(method text, total_count integer, total_amount numeric, reconciled_count integer, reconciled_amount numeric, divergent_count integer, pending_count integer, reconciliation_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id AND p.is_active AND p.role IN ('owner','admin','manager','finance','viewer')) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL AND p_end_date < p_start_date THEN RAISE EXCEPTION 'periodo_invalido'; END IF;
  RETURN QUERY SELECT
    COALESCE(bt.method,'other')::text AS method,
    COUNT(*)::int                                              AS total_count,
    COALESCE(SUM(bt.amount) FILTER (WHERE bt.transaction_type = 'credit'), 0)                               AS total_amount,
    COUNT(*) FILTER (WHERE bt.status IN ('reconciled','confirmed'))::int AS reconciled_count,
    COALESCE(SUM(bt.amount) FILTER (WHERE bt.status IN ('reconciled','confirmed') AND bt.transaction_type = 'credit'), 0) AS reconciled_amount,
    COUNT(*) FILTER (WHERE bt.status = 'divergent')::int      AS divergent_count,
    COUNT(*) FILTER (WHERE bt.status = 'pending')::int        AS pending_count,
    CASE WHEN COUNT(*) FILTER (WHERE bt.transaction_type = 'credit') = 0 THEN 0
         ELSE ROUND(
           COUNT(*) FILTER (WHERE bt.status IN ('reconciled','confirmed') AND bt.transaction_type = 'credit')::numeric
           / (COUNT(*) FILTER (WHERE bt.transaction_type = 'credit'))::numeric * 100, 1
         )
    END                                                        AS reconciliation_rate
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND (p_start_date IS NULL OR bt.transaction_date >= p_start_date)
    AND (p_end_date   IS NULL OR bt.transaction_date <= p_end_date)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
    )
  GROUP BY COALESCE(bt.method,'other')
  ORDER BY 3 DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_reconciliation_by_method(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reconciliation_by_method(uuid,date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_monthly_comparison(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id AND p.is_active AND p.role IN ('owner','admin','manager','finance','viewer')) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  SELECT to_jsonb(r) INTO result FROM (
    SELECT
      -- Mês atual
      COALESCE(SUM(bt.amount) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
          AND bt.status IN ('reconciled','confirmed')
      ), 0) AS current_month_reconciled,

      COALESCE(SUM(bt.amount) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
      ), 0) AS current_month_total,

      COUNT(*) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
          AND bt.status = 'divergent'
      )::int AS current_month_divergent,

      -- Mês anterior
      COALESCE(SUM(bt.amount) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 month')
          AND bt.transaction_date <  date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
          AND bt.status IN ('reconciled','confirmed')
      ), 0) AS prev_month_reconciled,

      COALESCE(SUM(bt.amount) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 month')
          AND bt.transaction_date <  date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
      ), 0) AS prev_month_total,

      COUNT(*) FILTER (
        WHERE bt.transaction_date >= date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 month')
          AND bt.transaction_date <  date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
          AND bt.status = 'divergent'
      )::int AS prev_month_divergent

    FROM public.bank_transactions bt
    WHERE bt.store_id = p_store_id
      AND bt.transaction_type = 'credit'
      AND bt.transaction_date < (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '1 month')::date
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
      )
  ) r;
  RETURN result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_monthly_comparison(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_comparison(uuid) TO authenticated, service_role;
