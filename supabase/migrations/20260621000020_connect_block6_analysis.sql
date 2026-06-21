-- Block 6: Análise financeira avançada
-- RPCs: get_sales_trend, get_payment_behavior, get_debt_analysis,
--        get_connect_health_analysis, get_customer_ranking, get_store_financial_summary

-- ── 1. Tendência de vendas ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_sales_trend(
  p_store_id UUID,
  p_days     INTEGER DEFAULT 30
)
RETURNS TABLE (
  sale_date     DATE,
  total_count   BIGINT,
  total_amount  NUMERIC,
  pix_amount    NUMERIC,
  card_amount   NUMERIC,
  cash_amount   NUMERIC,
  other_amount  NUMERIC,
  pending_count BIGINT,
  paid_count    BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH date_series AS (
  SELECT generate_series(
    CURRENT_DATE - (p_days - 1),
    CURRENT_DATE,
    '1 day'::interval
  )::date AS d
),
daily_sales AS (
  SELECT
    DATE(created_at)                 AS sale_date,
    COUNT(*)                         AS total_count,
    COALESCE(SUM(net_total), 0)      AS total_amount,
    COUNT(*) FILTER (WHERE payment_status IN ('pending','partial')) AS pending_count,
    COUNT(*) FILTER (WHERE payment_status = 'paid')                AS paid_count
  FROM sales
  WHERE store_id   = p_store_id
    AND deleted_at IS NULL
    AND created_at >= CURRENT_DATE - p_days
  GROUP BY DATE(created_at)
),
daily_payments AS (
  SELECT
    DATE(s.created_at)                                                                         AS sale_date,
    COALESCE(SUM(CASE WHEN p.method = 'pix'                                THEN p.amount ELSE 0 END), 0) AS pix_amount,
    COALESCE(SUM(CASE WHEN p.method IN ('credit_card','debit_card','card') THEN p.amount ELSE 0 END), 0) AS card_amount,
    COALESCE(SUM(CASE WHEN p.method = 'money'                              THEN p.amount ELSE 0 END), 0) AS cash_amount,
    COALESCE(SUM(CASE WHEN p.method NOT IN ('pix','credit_card','debit_card','card','money') THEN p.amount ELSE 0 END), 0) AS other_amount
  FROM payments p
  JOIN sales s ON s.id = p.sale_id AND s.store_id = p_store_id AND s.deleted_at IS NULL
  WHERE s.created_at >= CURRENT_DATE - p_days
  GROUP BY DATE(s.created_at)
)
SELECT
  ds.d               AS sale_date,
  COALESCE(sl.total_count,   0) AS total_count,
  COALESCE(sl.total_amount,  0) AS total_amount,
  COALESCE(dp.pix_amount,    0) AS pix_amount,
  COALESCE(dp.card_amount,   0) AS card_amount,
  COALESCE(dp.cash_amount,   0) AS cash_amount,
  COALESCE(dp.other_amount,  0) AS other_amount,
  COALESCE(sl.pending_count, 0) AS pending_count,
  COALESCE(sl.paid_count,    0) AS paid_count
FROM date_series ds
LEFT JOIN daily_sales    sl ON sl.sale_date = ds.d
LEFT JOIN daily_payments dp ON dp.sale_date = ds.d
ORDER BY ds.d;
$$;

REVOKE ALL ON FUNCTION get_sales_trend(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_sales_trend(UUID, INTEGER) TO authenticated;

-- ── 2. Comportamento por método de pagamento ──────────────────────────

CREATE OR REPLACE FUNCTION get_payment_behavior(
  p_store_id UUID,
  p_days     INTEGER DEFAULT 30
)
RETURNS TABLE (
  method        TEXT,
  current_count BIGINT,
  current_amount NUMERIC,
  current_pct   NUMERIC,
  prev_count    BIGINT,
  prev_amount   NUMERIC,
  prev_pct      NUMERIC,
  change_pct    NUMERIC,
  trend         TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH
current_period AS (
  SELECT p.method, COUNT(*) AS cnt, COALESCE(SUM(p.amount), 0) AS amt
  FROM payments p
  JOIN sales s ON s.id = p.sale_id AND s.store_id = p_store_id AND s.deleted_at IS NULL
  WHERE s.created_at >= CURRENT_DATE - p_days
  GROUP BY p.method
),
prev_period AS (
  SELECT p.method, COUNT(*) AS cnt, COALESCE(SUM(p.amount), 0) AS amt
  FROM payments p
  JOIN sales s ON s.id = p.sale_id AND s.store_id = p_store_id AND s.deleted_at IS NULL
  WHERE s.created_at >= CURRENT_DATE - (p_days * 2)
    AND s.created_at <  CURRENT_DATE - p_days
  GROUP BY p.method
),
total_curr AS (SELECT COALESCE(SUM(amt), 0) AS t FROM current_period),
total_prev AS (SELECT COALESCE(SUM(amt), 0) AS t FROM prev_period)
SELECT
  c.method,
  c.cnt                                                                                      AS current_count,
  c.amt                                                                                      AS current_amount,
  ROUND((c.amt / NULLIF((SELECT t FROM total_curr), 0) * 100)::NUMERIC, 1)                  AS current_pct,
  COALESCE(pr.cnt, 0)                                                                        AS prev_count,
  COALESCE(pr.amt, 0)                                                                        AS prev_amount,
  ROUND((COALESCE(pr.amt, 0) / NULLIF((SELECT t FROM total_prev), 0) * 100)::NUMERIC, 1)    AS prev_pct,
  CASE WHEN COALESCE(pr.amt, 0) > 0
    THEN ROUND(((c.amt - pr.amt) / pr.amt * 100)::NUMERIC, 1)
    ELSE NULL
  END                                                                                        AS change_pct,
  CASE
    WHEN COALESCE(pr.amt, 0) = 0       THEN 'new'
    WHEN c.amt > pr.amt * 1.05         THEN 'up'
    WHEN c.amt < pr.amt * 0.95         THEN 'down'
    ELSE                                    'stable'
  END                                                                                        AS trend
FROM current_period c
LEFT JOIN prev_period pr ON pr.method = c.method
ORDER BY c.amt DESC;
$$;

REVOKE ALL ON FUNCTION get_payment_behavior(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_payment_behavior(UUID, INTEGER) TO authenticated;

-- ── 3. Análise de inadimplência ───────────────────────────────────────

CREATE OR REPLACE FUNCTION get_debt_analysis(p_store_id UUID)
RETURNS TABLE (
  total_pending_sales    BIGINT,
  total_pending_amount   NUMERIC,
  overdue_count          BIGINT,
  overdue_amount         NUMERIC,
  overdue_30d_count      BIGINT,
  overdue_30d_amount     NUMERIC,
  overdue_60d_count      BIGINT,
  overdue_60d_amount     NUMERIC,
  overdue_90d_plus_count BIGINT,
  overdue_90d_plus_amount NUMERIC,
  delinquency_rate       NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH pending AS (
  SELECT
    id, amount_pending, due_date,
    CASE
      WHEN due_date IS NULL         THEN NULL
      WHEN due_date >= CURRENT_DATE THEN 'current'
      WHEN due_date >= CURRENT_DATE - 30 THEN '30d'
      WHEN due_date >= CURRENT_DATE - 60 THEN '60d'
      ELSE '90d_plus'
    END AS bucket
  FROM sales
  WHERE store_id     = p_store_id
    AND deleted_at   IS NULL
    AND payment_status IN ('pending', 'partial')
    AND amount_pending > 0
)
SELECT
  COUNT(*)                                                                                    AS total_pending_sales,
  COALESCE(SUM(amount_pending), 0)                                                            AS total_pending_amount,
  COUNT(*)     FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE)               AS overdue_count,
  COALESCE(SUM(amount_pending) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE), 0) AS overdue_amount,
  COUNT(*)     FILTER (WHERE bucket = '30d')                                                  AS overdue_30d_count,
  COALESCE(SUM(amount_pending) FILTER (WHERE bucket = '30d'), 0)                              AS overdue_30d_amount,
  COUNT(*)     FILTER (WHERE bucket = '60d')                                                  AS overdue_60d_count,
  COALESCE(SUM(amount_pending) FILTER (WHERE bucket = '60d'), 0)                              AS overdue_60d_amount,
  COUNT(*)     FILTER (WHERE bucket = '90d_plus')                                             AS overdue_90d_plus_count,
  COALESCE(SUM(amount_pending) FILTER (WHERE bucket = '90d_plus'), 0)                         AS overdue_90d_plus_amount,
  CASE WHEN SUM(amount_pending) > 0
    THEN ROUND((SUM(amount_pending) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE)
         / SUM(amount_pending) * 100)::NUMERIC, 1)
    ELSE 0
  END                                                                                         AS delinquency_rate
FROM pending;
$$;

REVOKE ALL ON FUNCTION get_debt_analysis(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_debt_analysis(UUID) TO authenticated;

-- ── 4. Análise de saúde do Connect ────────────────────────────────────

CREATE OR REPLACE FUNCTION get_connect_health_analysis(p_store_id UUID)
RETURNS TABLE (
  total_bank_txs          BIGINT,
  reconciled_count        BIGINT,
  divergent_count         BIGINT,
  pending_match_count     BIGINT,
  reconciliation_rate     NUMERIC,
  auto_reconciled_count   BIGINT,
  manual_reconciled_count BIGINT,
  auto_rate               NUMERIC,
  banks_connected         INTEGER,
  banks_synced_24h        INTEGER,
  last_sync_at            TIMESTAMPTZ,
  avg_sync_gap_hours      NUMERIC,
  open_divergences_7d_plus BIGINT,
  health_score            INTEGER
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH
bank_stats AS (
  SELECT
    COUNT(*)                               AS total_bank_txs,
    COUNT(*) FILTER (WHERE status = 'reconciled')  AS reconciled_count,
    COUNT(*) FILTER (WHERE status = 'divergent')   AS divergent_count,
    COUNT(*) FILTER (WHERE status = 'pending')     AS pending_count
  FROM bank_transactions
  WHERE store_id = p_store_id
),
match_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE status = 'confirmed' AND match_type = 'automatic') AS auto_reconciled,
    COUNT(*) FILTER (WHERE status = 'confirmed' AND match_type = 'manual')    AS manual_reconciled,
    COUNT(*) FILTER (WHERE status = 'pending')                                AS pending_matches
  FROM reconciliation_matches
  WHERE store_id = p_store_id
),
bank_conns AS (
  SELECT
    COUNT(*)                                                                   AS banks_connected,
    COUNT(*) FILTER (WHERE last_sync_at >= NOW() - INTERVAL '24 hours')       AS banks_synced_24h,
    MAX(last_sync_at)                                                          AS last_sync_at,
    COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - last_sync_at)) / 3600.0), 0)     AS avg_sync_gap_hours
  FROM bank_connections
  WHERE store_id = p_store_id AND is_active = true
),
div_old AS (
  SELECT COUNT(*) AS old_divs
  FROM bank_transactions
  WHERE store_id = p_store_id
    AND status = 'divergent'
    AND transaction_date <= CURRENT_DATE - 7
)
SELECT
  bs.total_bank_txs,
  bs.reconciled_count,
  bs.divergent_count,
  ms.pending_matches                                                            AS pending_match_count,
  CASE WHEN bs.total_bank_txs > 0
    THEN ROUND((bs.reconciled_count::NUMERIC / bs.total_bank_txs * 100), 1)
    ELSE 0
  END                                                                           AS reconciliation_rate,
  ms.auto_reconciled                                                            AS auto_reconciled_count,
  ms.manual_reconciled                                                          AS manual_reconciled_count,
  CASE WHEN (ms.auto_reconciled + ms.manual_reconciled) > 0
    THEN ROUND((ms.auto_reconciled::NUMERIC / (ms.auto_reconciled + ms.manual_reconciled) * 100), 1)
    ELSE 0
  END                                                                           AS auto_rate,
  bc.banks_connected::INTEGER,
  bc.banks_synced_24h::INTEGER,
  bc.last_sync_at,
  ROUND(bc.avg_sync_gap_hours::NUMERIC, 1)                                     AS avg_sync_gap_hours,
  dv.old_divs                                                                   AS open_divergences_7d_plus,
  -- Health score 0-100
  LEAST(100, GREATEST(0,
    -- Reconciliation component (0-40)
    CASE WHEN bs.total_bank_txs = 0 THEN 20
         WHEN bs.reconciled_count::NUMERIC / bs.total_bank_txs >= 0.90 THEN 40
         WHEN bs.reconciled_count::NUMERIC / bs.total_bank_txs >= 0.70 THEN 28
         WHEN bs.reconciled_count::NUMERIC / bs.total_bank_txs >= 0.50 THEN 15
         ELSE 0
    END +
    -- Sync freshness (0-30)
    CASE WHEN bc.banks_connected = 0 THEN 15
         WHEN bc.avg_sync_gap_hours <= 24  THEN 30
         WHEN bc.avg_sync_gap_hours <= 48  THEN 18
         WHEN bc.avg_sync_gap_hours <= 72  THEN 8
         ELSE 0
    END +
    -- Old divergences (0-30)
    CASE WHEN dv.old_divs = 0 THEN 30
         WHEN dv.old_divs <= 3 THEN 20
         WHEN dv.old_divs <= 10 THEN 10
         ELSE 0
    END
  ))::INTEGER                                                                   AS health_score
FROM bank_stats bs, match_stats ms, bank_conns bc, div_old dv;
$$;

REVOKE ALL ON FUNCTION get_connect_health_analysis(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_connect_health_analysis(UUID) TO authenticated;

-- ── 5. Ranking de clientes ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_customer_ranking(
  p_store_id UUID,
  p_limit    INTEGER DEFAULT 10
)
RETURNS TABLE (
  customer_id        UUID,
  customer_name      TEXT,
  customer_phone     TEXT,
  total_sales        BIGINT,
  total_amount       NUMERIC,
  total_paid         NUMERIC,
  total_pending      NUMERIC,
  pending_count      BIGINT,
  last_purchase_date DATE,
  is_debtor          BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
AS $$
SELECT
  c.id                                                                          AS customer_id,
  c.name                                                                        AS customer_name,
  c.phone                                                                       AS customer_phone,
  COUNT(s.id)                                                                   AS total_sales,
  COALESCE(SUM(s.net_total), 0)                                                 AS total_amount,
  COALESCE(SUM(s.net_total - COALESCE(s.amount_pending, 0)), 0)                 AS total_paid,
  COALESCE(SUM(s.amount_pending), 0)                                            AS total_pending,
  COUNT(s.id) FILTER (WHERE s.payment_status IN ('pending','partial'))          AS pending_count,
  MAX(DATE(s.created_at))                                                        AS last_purchase_date,
  (COALESCE(SUM(s.amount_pending), 0) > 0)                                      AS is_debtor
FROM customers c
JOIN sales s ON s.customer_id = c.id
  AND s.store_id   = p_store_id
  AND s.deleted_at IS NULL
WHERE c.store_id = p_store_id
GROUP BY c.id, c.name, c.phone
ORDER BY total_amount DESC
LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION get_customer_ranking(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_customer_ranking(UUID, INTEGER) TO authenticated;

-- ── 6. Resumo financeiro executivo ────────────────────────────────────

CREATE OR REPLACE FUNCTION get_store_financial_summary(p_store_id UUID)
RETURNS TABLE (
  week_received          NUMERIC,
  week_sales_count       BIGINT,
  week_new_customers     BIGINT,
  month_received         NUMERIC,
  month_sales_count      BIGINT,
  month_divergences      BIGINT,
  month_delinquency_rate NUMERIC,
  month_reconciliation_rate NUMERIC,
  prev_month_received    NUMERIC,
  prev_month_sales_count BIGINT,
  received_growth_pct    NUMERIC,
  sales_growth_pct       NUMERIC,
  forecast_30d           NUMERIC,
  at_risk_30d            NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH
  week_start       AS (SELECT date_trunc('week', CURRENT_DATE)::date AS d),
  month_start      AS (SELECT date_trunc('month', CURRENT_DATE)::date AS d),
  prev_month_start AS (SELECT date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date AS d),
  -- Bank received this week / month / prev month
  bank_week AS (
    SELECT COALESCE(SUM(amount), 0) AS received
    FROM bank_transactions
    WHERE store_id = p_store_id
      AND transaction_date >= (SELECT d FROM week_start)
  ),
  bank_month AS (
    SELECT COALESCE(SUM(amount), 0) AS received
    FROM bank_transactions
    WHERE store_id = p_store_id
      AND transaction_date >= (SELECT d FROM month_start)
  ),
  bank_prev AS (
    SELECT COALESCE(SUM(amount), 0) AS received
    FROM bank_transactions
    WHERE store_id = p_store_id
      AND transaction_date >= (SELECT d FROM prev_month_start)
      AND transaction_date <  (SELECT d FROM month_start)
  ),
  -- Sales counts
  sales_week AS (
    SELECT COUNT(*) AS cnt
    FROM sales
    WHERE store_id   = p_store_id
      AND deleted_at IS NULL
      AND created_at >= (SELECT d FROM week_start)
  ),
  sales_month AS (
    SELECT COUNT(*) AS cnt
    FROM sales
    WHERE store_id   = p_store_id
      AND deleted_at IS NULL
      AND created_at >= (SELECT d FROM month_start)
  ),
  sales_prev AS (
    SELECT COUNT(*) AS cnt
    FROM sales
    WHERE store_id   = p_store_id
      AND deleted_at IS NULL
      AND created_at >= (SELECT d FROM prev_month_start)
      AND created_at <  (SELECT d FROM month_start)
  ),
  -- New customers this week
  cust_week AS (
    SELECT COUNT(*) AS cnt
    FROM customers
    WHERE store_id   = p_store_id
      AND created_at >= (SELECT d FROM week_start)
  ),
  -- Divergences this month
  diverg AS (
    SELECT COUNT(*) AS cnt
    FROM bank_transactions
    WHERE store_id         = p_store_id
      AND status           = 'divergent'
      AND transaction_date >= (SELECT d FROM month_start)
  ),
  -- Delinquency (overdue vs total pending)
  dlq AS (
    SELECT
      COALESCE(SUM(amount_pending) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE), 0) AS overdue_amount,
      COALESCE(SUM(amount_pending), 0) AS total_pending_amount
    FROM sales
    WHERE store_id        = p_store_id
      AND deleted_at      IS NULL
      AND payment_status  IN ('pending','partial')
  ),
  -- Reconciliation rate this month
  recon AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'confirmed')::NUMERIC AS reconciled,
      COUNT(*)::NUMERIC                                       AS total
    FROM reconciliation_matches
    WHERE store_id   = p_store_id
      AND created_at >= (SELECT d FROM month_start)
  ),
  -- Forecast: pending sales due in 30 days
  forecast AS (
    SELECT COALESCE(SUM(amount_pending), 0) AS pending_due
    FROM sales
    WHERE store_id       = p_store_id
      AND deleted_at     IS NULL
      AND payment_status IN ('pending','partial')
      AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
  ),
  at_risk AS (
    SELECT COALESCE(SUM(amount_pending), 0) AS overdue_due
    FROM sales
    WHERE store_id       = p_store_id
      AND deleted_at     IS NULL
      AND payment_status IN ('pending','partial')
      AND due_date < CURRENT_DATE
  )
SELECT
  bw.received                                                                   AS week_received,
  sw.cnt                                                                        AS week_sales_count,
  cw.cnt                                                                        AS week_new_customers,
  bm.received                                                                   AS month_received,
  sm.cnt                                                                        AS month_sales_count,
  dv.cnt                                                                        AS month_divergences,
  CASE WHEN dlq.total_pending_amount > 0
    THEN ROUND((dlq.overdue_amount / dlq.total_pending_amount * 100)::NUMERIC, 1)
    ELSE 0
  END                                                                           AS month_delinquency_rate,
  CASE WHEN r.total > 0
    THEN ROUND((r.reconciled / r.total * 100)::NUMERIC, 1)
    ELSE 0
  END                                                                           AS month_reconciliation_rate,
  bp.received                                                                   AS prev_month_received,
  sp.cnt                                                                        AS prev_month_sales_count,
  CASE WHEN bp.received > 0
    THEN ROUND(((bm.received - bp.received) / bp.received * 100)::NUMERIC, 1)
    ELSE NULL
  END                                                                           AS received_growth_pct,
  CASE WHEN sp.cnt > 0
    THEN ROUND(((sm.cnt - sp.cnt)::NUMERIC / sp.cnt * 100), 1)
    ELSE NULL
  END                                                                           AS sales_growth_pct,
  bm.received + f.pending_due                                                   AS forecast_30d,
  ar.overdue_due                                                                AS at_risk_30d
FROM bank_week bw, bank_month bm, bank_prev bp,
     sales_week sw, sales_month sm, sales_prev sp,
     cust_week cw, diverg dv, dlq, recon r, forecast f, at_risk ar;
$$;

REVOKE ALL ON FUNCTION get_store_financial_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_store_financial_summary(UUID) TO authenticated;
