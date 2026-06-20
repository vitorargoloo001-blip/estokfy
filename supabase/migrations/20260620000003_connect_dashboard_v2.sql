-- =====================================================================
-- Connect: Dashboard V2 — trend chart + method breakdown
-- =====================================================================

-- get_reconciliation_trend: série diária dos últimos N dias
CREATE OR REPLACE FUNCTION public.get_reconciliation_trend(
  p_store_id UUID,
  p_days     INTEGER DEFAULT 30
)
RETURNS TABLE (
  date       DATE,
  reconciled BIGINT,
  divergent  BIGINT,
  pending    BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (p_days - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::date AS d
  ),
  daily AS (
    SELECT
      transaction_date                                    AS d,
      COUNT(*) FILTER (WHERE status = 'reconciled')       AS reconciled,
      COUNT(*) FILTER (WHERE status = 'divergent')        AS divergent,
      COUNT(*) FILTER (WHERE status IN ('pending','ignored')) AS pending
    FROM public.bank_transactions
    WHERE store_id = p_store_id
      AND transaction_date >= CURRENT_DATE - (p_days - 1)
      AND EXISTS (
        SELECT 1 FROM public.profiles p2
        WHERE p2.auth_user_id = auth.uid()
          AND p2.store_id = p_store_id
          AND p2.role IN ('owner','admin','manager','finance','viewer')
      )
    GROUP BY transaction_date
  )
  SELECT
    ds.d,
    COALESCE(dc.reconciled, 0),
    COALESCE(dc.divergent,  0),
    COALESCE(dc.pending,    0)
  FROM date_series ds
  LEFT JOIN daily dc ON dc.d = ds.d
  ORDER BY ds.d;
$$;

GRANT EXECUTE ON FUNCTION public.get_reconciliation_trend(UUID, INTEGER) TO authenticated;

-- get_reconciliation_by_method: breakdown por método de pagamento
CREATE OR REPLACE FUNCTION public.get_reconciliation_by_method(
  p_store_id    UUID,
  p_period_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  method             TEXT,
  total_count        BIGINT,
  reconciled_count   BIGINT,
  total_amount       NUMERIC,
  reconciled_amount  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(method, 'other')                                                           AS method,
    COUNT(*)                                                                            AS total_count,
    COUNT(*) FILTER (WHERE status = 'reconciled')                                      AS reconciled_count,
    COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'credit'), 0)                AS total_amount,
    COALESCE(SUM(amount) FILTER (WHERE status = 'reconciled' AND transaction_type = 'credit'), 0) AS reconciled_amount
  FROM public.bank_transactions
  WHERE store_id = p_store_id
    AND transaction_date >= CURRENT_DATE - p_period_days
    AND EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.auth_user_id = auth.uid()
        AND p2.store_id = p_store_id
        AND p2.role IN ('owner','admin','manager','finance','viewer')
    )
  GROUP BY COALESCE(method, 'other')
  ORDER BY total_amount DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_reconciliation_by_method(UUID, INTEGER) TO authenticated;
