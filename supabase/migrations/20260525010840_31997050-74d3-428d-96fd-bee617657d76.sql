
-- ============================================================
-- get_financial_report_summary
-- Fonte ÚNICA da verdade para todos os números financeiros.
-- Recebido = payments.paid_at no período (NÃO sales.amount_paid).
-- Vendas válidas = não deletadas, status NOT IN ('cancelled','refunded','returned').
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_financial_report_summary(
  p_store_id uuid,
  p_start date,
  p_end date,
  p_employee_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_store uuid;
  v_role text;
  v_from_ts timestamptz;
  v_to_ts   timestamptz;
  v_today   date;
  v_result  jsonb;
BEGIN
  v_my_store := public.get_my_store_id();
  v_role     := public.get_my_role();

  IF v_my_store IS NULL THEN
    RAISE EXCEPTION 'sem_loja';
  END IF;
  IF p_store_id <> v_my_store THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'periodo_invalido';
  END IF;

  v_from_ts := (p_start::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_to_ts   := (p_end::text   || ' 23:59:59.999')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_today   := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  WITH
  -- Vendas criadas no período (todas, antes de filtrar validade)
  sales_period AS (
    SELECT s.*
    FROM sales s
    WHERE s.store_id = p_store_id
      AND s.created_at >= v_from_ts AND s.created_at <= v_to_ts
      AND (p_employee_id IS NULL OR s.created_by = p_employee_id)
  ),
  -- Vendas válidas (não canceladas, não estornadas, não deletadas)
  sales_valid AS (
    SELECT * FROM sales_period
    WHERE deleted_at IS NULL
      AND status NOT IN ('cancelled','refunded','returned')
  ),
  -- Pagamentos recebidos no período (ÚNICA fonte de "recebido")
  pays AS (
    SELECT p.*, s.deleted_at AS s_deleted_at, s.status AS s_status
    FROM payments p
    LEFT JOIN sales s ON s.id = p.sale_id
    WHERE p.store_id = p_store_id
      AND p.paid_at >= v_from_ts AND p.paid_at <= v_to_ts
      AND (p_employee_id IS NULL OR p.created_by = p_employee_id)
  ),
  pays_valid AS (
    SELECT * FROM pays
    WHERE s_deleted_at IS NULL
      AND (s_status IS NULL OR s_status NOT IN ('cancelled','refunded','returned'))
  ),
  pays_ignored AS (
    SELECT * FROM pays
    WHERE s_deleted_at IS NOT NULL
       OR s_status IN ('cancelled','refunded','returned')
  ),
  -- Contas a receber: estado atual de vendas a prazo (independente de período de criação)
  receivables AS (
    SELECT s.*
    FROM sales s
    WHERE s.store_id = p_store_id
      AND s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled','refunded','returned')
      AND s.payment_status IN ('pending','partial')
  ),
  -- Itens vendidos válidos
  items AS (
    SELECT si.*
    FROM sale_items si
    JOIN sales_valid sv ON sv.id = si.sale_id
  ),
  -- Despesas pagas no período (cash_entries entry_type=expense)
  expenses AS (
    SELECT ce.*
    FROM cash_entries ce
    WHERE ce.store_id = p_store_id
      AND ce.entry_type = 'expense'
      AND ce.occurred_at >= v_from_ts AND ce.occurred_at <= v_to_ts
  ),
  -- Devoluções no período
  rets AS (
    SELECT r.*
    FROM returns r
    WHERE r.store_id = p_store_id
      AND r.created_at >= v_from_ts AND r.created_at <= v_to_ts
  ),
  return_items_in AS (
    SELECT ri.*
    FROM return_items ri
    JOIN rets r ON r.id = ri.return_id
  ),
  -- Compras de estoque pagas no período
  stock_purch AS (
    SELECT sm.*
    FROM stock_movements sm
    WHERE sm.store_id = p_store_id
      AND sm.movement_type = 'purchase_in'
      AND sm.created_at >= v_from_ts AND sm.created_at <= v_to_ts
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_start, 'to', p_end),
    'sales', jsonb_build_object(
      'count_total',     (SELECT COUNT(*) FROM sales_period),
      'count_valid',     (SELECT COUNT(*) FROM sales_valid),
      'count_cancelled', (SELECT COUNT(*) FROM sales_period WHERE status IN ('cancelled','refunded','returned') OR deleted_at IS NOT NULL),
      'gross_total',     COALESCE((SELECT SUM(gross_total) FROM sales_valid), 0),
      'net_total',       COALESCE((SELECT SUM(net_total) FROM sales_valid), 0),
      'discount_total',  COALESCE((SELECT SUM(discount_total) FROM sales_valid), 0),
      'shipping_total',  COALESCE((SELECT SUM(shipping_fee) FROM sales_valid), 0),
      'cost_total',      COALESCE((SELECT SUM(cost_total) FROM sales_valid), 0),
      'gross_profit',    COALESCE((SELECT SUM(profit_gross) FROM sales_valid), 0)
    ),
    -- Recebido REAL: SÓ payments.paid_at, excluindo vendas canceladas/deletadas
    'received', jsonb_build_object(
      'total',  COALESCE((SELECT SUM(amount) FROM pays_valid), 0),
      'count',  (SELECT COUNT(*) FROM pays_valid),
      'by_method', COALESCE((
        SELECT jsonb_object_agg(method, jsonb_build_object('amount', amount, 'count', cnt))
        FROM (
          SELECT COALESCE(NULLIF(method,''),'outro') AS method,
                 SUM(amount) AS amount,
                 COUNT(*)    AS cnt
          FROM pays_valid
          GROUP BY 1
        ) g
      ), '{}'::jsonb),
      'ignored_count',  (SELECT COUNT(*) FROM pays_ignored),
      'ignored_amount', COALESCE((SELECT SUM(amount) FROM pays_ignored), 0)
    ),
    'receivables', jsonb_build_object(
      'open_total',     COALESCE((SELECT SUM(amount_pending) FROM receivables), 0),
      'open_count',     (SELECT COUNT(*) FROM receivables),
      'overdue_total',  COALESCE((SELECT SUM(amount_pending) FROM receivables WHERE due_date IS NOT NULL AND due_date < v_today), 0),
      'overdue_count',  (SELECT COUNT(*) FROM receivables WHERE due_date IS NOT NULL AND due_date < v_today),
      'settled_in_period', COALESCE((
        SELECT SUM(p.amount) FROM pays_valid p
        JOIN sales s ON s.id = p.sale_id
        WHERE s.created_at < v_from_ts -- pagamento de venda anterior ao período
      ), 0)
    ),
    'items_sold',  COALESCE((SELECT SUM(qty) FROM items), 0),
    'top_products', COALESCE((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT
          COALESCE(MAX(product_name_snapshot), MAX(p.name), 'Produto') AS name,
          COALESCE(MAX(product_sku_snapshot), MAX(p.sku), '-')         AS sku,
          COALESCE(MAX(product_category_snapshot), 'Sem categoria')    AS category,
          SUM(items.qty)        AS qty,
          SUM(items.line_total) AS revenue
        FROM items
        LEFT JOIN products p ON p.id = items.product_id
        GROUP BY items.product_id
        ORDER BY SUM(items.qty) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'expenses', jsonb_build_object(
      'paid_total',  COALESCE((SELECT SUM(amount) FROM expenses), 0),
      'count',       (SELECT COUNT(*) FROM expenses),
      'by_category', COALESCE((
        SELECT jsonb_object_agg(COALESCE(category,'outros'), s)
        FROM (SELECT category, SUM(amount) s FROM expenses GROUP BY category) x
      ), '{}'::jsonb)
    ),
    'stock_purchases', jsonb_build_object(
      'total', COALESCE((SELECT SUM(COALESCE(total_amount, unit_cost * qty)) FROM stock_purch), 0),
      'count', (SELECT COUNT(*) FROM stock_purch)
    ),
    'returns', jsonb_build_object(
      'count', (SELECT COUNT(*) FROM rets),
      'refund_total', COALESCE((SELECT SUM(refund_amount) FROM return_items_in), 0)
    ),
    'net_cash', COALESCE((SELECT SUM(amount) FROM pays_valid), 0)
                - COALESCE((SELECT SUM(amount) FROM expenses), 0)
                - COALESCE((SELECT SUM(refund_amount) FROM return_items_in), 0),
    -- AUDITORIA: lista de pagamentos usados (para conferência tela-a-tela)
    'audit', jsonb_build_object(
      'payments_used', COALESCE((
        SELECT jsonb_agg(row_to_json(t)) FROM (
          SELECT id, sale_id, method, amount, paid_at, created_by
          FROM pays_valid
          ORDER BY paid_at
        ) t
      ), '[]'::jsonb),
      'payments_ignored', COALESCE((
        SELECT jsonb_agg(row_to_json(t)) FROM (
          SELECT id, sale_id, method, amount, paid_at, s_status, s_deleted_at
          FROM pays_ignored
          ORDER BY paid_at
        ) t
      ), '[]'::jsonb),
      'sales_ignored', COALESCE((
        SELECT jsonb_agg(row_to_json(t)) FROM (
          SELECT id, status, deleted_at, net_total
          FROM sales_period
          WHERE deleted_at IS NOT NULL OR status IN ('cancelled','refunded','returned')
          ORDER BY created_at
        ) t
      ), '[]'::jsonb),
      'possible_duplicates', COALESCE((
        SELECT jsonb_agg(row_to_json(t)) FROM (
          SELECT sale_id, method, paid_at::date AS day, amount, COUNT(*) AS occurrences
          FROM pays_valid
          GROUP BY sale_id, method, paid_at::date, amount
          HAVING COUNT(*) > 1
        ) t
      ), '[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_financial_report_summary(uuid, date, date, uuid) TO authenticated;

-- Índices úteis para performance da RPC
CREATE INDEX IF NOT EXISTS idx_payments_store_paid_at ON public.payments (store_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_sales_store_created_at ON public.sales (store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_cash_entries_store_occurred_at ON public.cash_entries (store_id, occurred_at);
