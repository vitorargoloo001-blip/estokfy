-- Block 6: Dashboard IA Super Admin — comparação e ranking entre lojas

-- ── Comparação por loja ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_master_ia_comparison()
RETURNS TABLE (
  store_id              UUID,
  store_name            TEXT,
  month_revenue         NUMERIC,
  prev_month_revenue    NUMERIC,
  revenue_growth_pct    NUMERIC,
  month_sales_count     BIGINT,
  delinquency_rate      NUMERIC,
  overdue_amount        NUMERIC,
  reconciliation_rate   NUMERIC,
  divergent_count       BIGINT,
  auto_rate             NUMERIC,
  health_score          INTEGER,
  active_connect        BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH
  is_admin AS (
    SELECT is_super_admin() AS ok
  ),
  month_start      AS (SELECT date_trunc('month', CURRENT_DATE)::date AS d),
  prev_month_start AS (SELECT date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date AS d),
  -- Bank revenue per store
  bank_month AS (
    SELECT store_id, COALESCE(SUM(amount), 0) AS rev
    FROM bank_transactions
    WHERE transaction_date >= (SELECT d FROM month_start)
    GROUP BY store_id
  ),
  bank_prev AS (
    SELECT store_id, COALESCE(SUM(amount), 0) AS rev
    FROM bank_transactions
    WHERE transaction_date >= (SELECT d FROM prev_month_start)
      AND transaction_date <  (SELECT d FROM month_start)
    GROUP BY store_id
  ),
  -- Sales count per store
  sales_month AS (
    SELECT store_id, COUNT(*) AS cnt
    FROM sales
    WHERE deleted_at IS NULL
      AND created_at >= (SELECT d FROM month_start)
    GROUP BY store_id
  ),
  -- Delinquency per store
  delinquency AS (
    SELECT
      store_id,
      COALESCE(SUM(amount_pending) FILTER (WHERE due_date < CURRENT_DATE), 0) AS overdue_amt,
      COALESCE(SUM(amount_pending), 0) AS total_pending_amt
    FROM sales
    WHERE deleted_at IS NULL AND payment_status IN ('pending','partial')
    GROUP BY store_id
  ),
  -- Reconciliation per store
  recon AS (
    SELECT
      store_id,
      COUNT(*) FILTER (WHERE status = 'confirmed')::NUMERIC AS reconciled,
      COUNT(*)::NUMERIC AS total,
      COUNT(*) FILTER (WHERE status = 'confirmed' AND match_type = 'automatic')::NUMERIC AS auto_confirmed
    FROM reconciliation_matches
    WHERE created_at >= (SELECT d FROM month_start)
    GROUP BY store_id
  ),
  -- Divergences per store
  diverg AS (
    SELECT store_id, COUNT(*) AS cnt
    FROM bank_transactions
    WHERE status = 'divergent'
      AND transaction_date >= (SELECT d FROM month_start)
    GROUP BY store_id
  ),
  -- Bank sync health per store
  sync_health AS (
    SELECT
      store_id,
      AVG(EXTRACT(EPOCH FROM (NOW() - last_sync_at)) / 3600.0) AS avg_gap_hours,
      COUNT(*) FILTER (WHERE last_sync_at >= NOW() - INTERVAL '24 hours') AS synced_24h,
      COUNT(*) AS total_banks
    FROM bank_connections
    WHERE is_active = true
    GROUP BY store_id
  )
SELECT
  s.id                                                                              AS store_id,
  s.name                                                                            AS store_name,
  COALESCE(bm.rev, 0)                                                               AS month_revenue,
  COALESCE(bp.rev, 0)                                                               AS prev_month_revenue,
  CASE WHEN COALESCE(bp.rev, 0) > 0
    THEN ROUND(((COALESCE(bm.rev, 0) - bp.rev) / bp.rev * 100)::NUMERIC, 1)
    ELSE NULL
  END                                                                               AS revenue_growth_pct,
  COALESCE(sm.cnt, 0)                                                               AS month_sales_count,
  CASE WHEN COALESCE(dlq.total_pending_amt, 0) > 0
    THEN ROUND((dlq.overdue_amt / dlq.total_pending_amt * 100)::NUMERIC, 1)
    ELSE 0
  END                                                                               AS delinquency_rate,
  COALESCE(dlq.overdue_amt, 0)                                                      AS overdue_amount,
  CASE WHEN COALESCE(r.total, 0) > 0
    THEN ROUND((r.reconciled / r.total * 100)::NUMERIC, 1)
    ELSE 0
  END                                                                               AS reconciliation_rate,
  COALESCE(dv.cnt, 0)                                                               AS divergent_count,
  CASE WHEN COALESCE(r.reconciled, 0) > 0
    THEN ROUND((r.auto_confirmed / r.reconciled * 100)::NUMERIC, 1)
    ELSE 0
  END                                                                               AS auto_rate,
  -- Composite health score (0-100)
  LEAST(100, GREATEST(0,
    CASE WHEN COALESCE(r.total, 0) = 0 THEN 20
         WHEN r.reconciled / r.total >= 0.90 THEN 40
         WHEN r.reconciled / r.total >= 0.70 THEN 25
         WHEN r.reconciled / r.total >= 0.50 THEN 12
         ELSE 0 END +
    CASE WHEN COALESCE(sh.avg_gap_hours, 999) <= 24 THEN 30
         WHEN COALESCE(sh.avg_gap_hours, 999) <= 48 THEN 15
         WHEN COALESCE(sh.avg_gap_hours, 999) <= 72 THEN 7
         ELSE 0 END +
    CASE WHEN COALESCE(dv.cnt, 0) = 0 THEN 30
         WHEN COALESCE(dv.cnt, 0) <= 3 THEN 20
         WHEN COALESCE(dv.cnt, 0) <= 10 THEN 10
         ELSE 0 END
  ))::INTEGER                                                                       AS health_score,
  EXISTS(
    SELECT 1 FROM pluggy_items pi
    WHERE pi.store_id = s.id AND pi.status IN ('UPDATED','UPDATING','PENDING')
  )                                                                                 AS active_connect
FROM stores s
CROSS JOIN is_admin
LEFT JOIN bank_month  bm  ON bm.store_id  = s.id
LEFT JOIN bank_prev   bp  ON bp.store_id  = s.id
LEFT JOIN sales_month sm  ON sm.store_id  = s.id
LEFT JOIN delinquency dlq ON dlq.store_id = s.id
LEFT JOIN recon       r   ON r.store_id   = s.id
LEFT JOIN diverg      dv  ON dv.store_id  = s.id
LEFT JOIN sync_health sh  ON sh.store_id  = s.id
WHERE is_admin.ok = true
ORDER BY COALESCE(bm.rev, 0) DESC;
$$;

REVOKE ALL ON FUNCTION get_master_ia_comparison() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_master_ia_comparison() TO authenticated;

-- ── Ranking entre lojas ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_master_ia_ranking(p_top INTEGER DEFAULT 5)
RETURNS TABLE (
  category      TEXT,
  rank_position INTEGER,
  store_id      UUID,
  store_name    TEXT,
  metric_value  NUMERIC,
  metric_label  TEXT,
  is_best       BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH
  is_admin AS (SELECT is_super_admin() AS ok),
  month_start AS (SELECT date_trunc('month', CURRENT_DATE)::date AS d),
  prev_month_start AS (SELECT date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date AS d),
  base AS (
    SELECT * FROM get_master_ia_comparison()
  ),
  faturamento AS (
    SELECT 'maior_faturamento' AS cat,
      ROW_NUMBER() OVER (ORDER BY month_revenue DESC NULLS LAST)::INTEGER AS rnk,
      store_id, store_name, month_revenue AS val, 'Faturamento (R$)' AS lbl, true AS best
    FROM base WHERE month_revenue > 0
  ),
  crescimento AS (
    SELECT 'maior_crescimento' AS cat,
      ROW_NUMBER() OVER (ORDER BY revenue_growth_pct DESC NULLS LAST)::INTEGER AS rnk,
      store_id, store_name, revenue_growth_pct AS val, 'Crescimento (%)' AS lbl, true AS best
    FROM base WHERE revenue_growth_pct IS NOT NULL
  ),
  inadimplencia AS (
    SELECT 'maior_inadimplencia' AS cat,
      ROW_NUMBER() OVER (ORDER BY delinquency_rate DESC NULLS LAST)::INTEGER AS rnk,
      store_id, store_name, delinquency_rate AS val, 'Inadimplência (%)' AS lbl, false AS best
    FROM base
  ),
  divergencias AS (
    SELECT 'mais_divergencias' AS cat,
      ROW_NUMBER() OVER (ORDER BY divergent_count DESC NULLS LAST)::INTEGER AS rnk,
      store_id, store_name, divergent_count AS val, 'Divergências no mês' AS lbl, false AS best
    FROM base WHERE divergent_count > 0
  ),
  conciliacao AS (
    SELECT 'melhor_conciliacao' AS cat,
      ROW_NUMBER() OVER (ORDER BY reconciliation_rate DESC NULLS LAST)::INTEGER AS rnk,
      store_id, store_name, reconciliation_rate AS val, 'Taxa conciliação (%)' AS lbl, true AS best
    FROM base
  ),
  all_ranked AS (
    SELECT cat, rnk, store_id, store_name, val, lbl, best FROM faturamento
    UNION ALL
    SELECT cat, rnk, store_id, store_name, val, lbl, best FROM crescimento
    UNION ALL
    SELECT cat, rnk, store_id, store_name, val, lbl, best FROM inadimplencia
    UNION ALL
    SELECT cat, rnk, store_id, store_name, val, lbl, best FROM divergencias
    UNION ALL
    SELECT cat, rnk, store_id, store_name, val, lbl, best FROM conciliacao
  )
SELECT cat AS category, rnk AS rank_position, store_id, store_name, val AS metric_value, lbl AS metric_label, best AS is_best
FROM all_ranked
CROSS JOIN is_admin
WHERE is_admin.ok = true AND rnk <= p_top
ORDER BY cat, rnk;
$$;

REVOKE ALL ON FUNCTION get_master_ia_ranking(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_master_ia_ranking(INTEGER) TO authenticated;

-- Grants para service_role (chamadas de edge functions)
GRANT EXECUTE ON FUNCTION get_master_ia_comparison()       TO service_role;
GRANT EXECUTE ON FUNCTION get_master_ia_ranking(INTEGER)   TO service_role;
GRANT EXECUTE ON FUNCTION answer_financial_question(UUID, TEXT) TO service_role;
