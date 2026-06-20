-- =====================================================================
-- Connect: Dashboard V3 — manual_reconciled + trend por período
-- =====================================================================

-- Atualiza connect_get_dashboard_kpis adicionando manual_reconciled
DROP FUNCTION IF EXISTS public.connect_get_dashboard_kpis(UUID);
CREATE OR REPLACE FUNCTION public.connect_get_dashboard_kpis(p_store_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r) FROM (
    SELECT
      -- Financeiro
      (SELECT COALESCE(SUM(bt.amount), 0)
       FROM public.bank_transactions bt
       WHERE bt.store_id = p_store_id
         AND bt.status IN ('reconciled','confirmed')
         AND bt.transaction_date = CURRENT_DATE
      ) AS received_today,

      (SELECT COALESCE(SUM(bt.amount), 0)
       FROM public.bank_transactions bt
       WHERE bt.store_id = p_store_id
         AND bt.status IN ('reconciled','confirmed')
         AND bt.transaction_date >= date_trunc('month', CURRENT_DATE)
      ) AS received_month,

      -- Conciliações automáticas (motor 3-pass: deterministic/heuristic/fuzzy)
      (SELECT COUNT(*)
       FROM public.reconciliation_matches rm
       WHERE rm.store_id = p_store_id
         AND rm.status = 'confirmed'
         AND rm.match_type IN ('deterministic','heuristic','fuzzy')
      ) AS auto_reconciled,

      -- Conciliações manuais
      (SELECT COUNT(*)
       FROM public.reconciliation_matches rm
       WHERE rm.store_id = p_store_id
         AND rm.status = 'confirmed'
         AND (rm.match_type = 'manual'
              OR rm.match_reason ILIKE '%manual%')
      ) AS manual_reconciled,

      -- Pendentes
      (SELECT COUNT(*)
       FROM public.reconciliation_matches rm
       WHERE rm.store_id = p_store_id AND rm.status = 'pending'
      ) AS pending_reconciliation,

      -- Divergências
      (SELECT COUNT(*)
       FROM public.bank_transactions bt
       WHERE bt.store_id = p_store_id AND bt.status = 'divergent'
      ) AS divergent,

      -- Bancos
      (SELECT COUNT(*)
       FROM public.bank_connections bc
       WHERE bc.store_id = p_store_id AND bc.is_active = true
      ) AS banks_connected,

      (SELECT MAX(bc.last_sync_at)
       FROM public.bank_connections bc
       WHERE bc.store_id = p_store_id AND bc.is_active = true
      ) AS last_sync,

      -- Totais
      (SELECT COUNT(*)
       FROM public.bank_transactions bt
       WHERE bt.store_id = p_store_id
      ) AS total_transactions,

      (SELECT COUNT(*)
       FROM public.bank_transactions bt
       WHERE bt.store_id = p_store_id
         AND bt.status IN ('reconciled','confirmed')
      ) AS reconciled_count,

      -- Taxa de conciliação
      CASE
        WHEN (SELECT COUNT(*) FROM public.bank_transactions bt WHERE bt.store_id = p_store_id) = 0
        THEN 0
        ELSE ROUND(
          (SELECT COUNT(*) FROM public.bank_transactions bt
           WHERE bt.store_id = p_store_id AND bt.status IN ('reconciled','confirmed'))::numeric
          / (SELECT COUNT(*) FROM public.bank_transactions bt WHERE bt.store_id = p_store_id)::numeric
          * 100, 1
        )
      END AS reconciliation_rate

    WHERE EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
    )
  ) r;
$$;

GRANT EXECUTE ON FUNCTION public.connect_get_dashboard_kpis(UUID) TO authenticated;

-- =====================================================================
-- RPC: get_reconciliation_trend_by_period
-- p_period: 'week' (7d) | 'month' (30d) | 'quarter' (90d)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_reconciliation_trend_by_period(
  p_store_id UUID,
  p_period   TEXT DEFAULT 'month'
)
RETURNS TABLE (
  date       DATE,
  reconciled INTEGER,
  divergent  INTEGER,
  pending    INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    gs.d::date AS date,
    COALESCE(SUM(CASE WHEN bt.status IN ('reconciled','confirmed') THEN 1 ELSE 0 END), 0)::int AS reconciled,
    COALESCE(SUM(CASE WHEN bt.status = 'divergent'                THEN 1 ELSE 0 END), 0)::int AS divergent,
    COALESCE(SUM(CASE WHEN bt.status = 'pending'                  THEN 1 ELSE 0 END), 0)::int AS pending
  FROM generate_series(
    CURRENT_DATE - (
      CASE p_period
        WHEN 'week'    THEN 6
        WHEN 'quarter' THEN 89
        ELSE 29
      END
    ),
    CURRENT_DATE,
    '1 day'::interval
  ) AS gs(d)
  LEFT JOIN public.bank_transactions bt
    ON bt.transaction_date = gs.d::date
   AND bt.store_id = p_store_id
   AND EXISTS (
     SELECT 1 FROM public.profiles p2
     WHERE p2.auth_user_id = auth.uid()
       AND p2.store_id = p_store_id
       AND p2.role IN ('owner','admin','manager','finance','viewer')
   )
  GROUP BY gs.d
  ORDER BY gs.d;
$$;

GRANT EXECUTE ON FUNCTION public.get_reconciliation_trend_by_period(UUID, TEXT) TO authenticated;
