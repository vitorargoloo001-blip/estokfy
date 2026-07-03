-- =====================================================================
-- Connect Block 5 — Dashboard Master (Super Admin) + GRANT service_role
-- =====================================================================

-- ── 1. RPC: get_master_connect_dashboard ──────────────────────────────
-- Somente Super Admin. Retorna visão agregada de todas as lojas.

CREATE OR REPLACE FUNCTION public.get_master_connect_dashboard()
RETURNS TABLE(
  store_id             UUID,
  store_name           TEXT,
  banks_connected      BIGINT,
  total_transactions   BIGINT,
  total_received       NUMERIC,
  divergent_count      BIGINT,
  pending_matches      BIGINT,
  reconciliation_rate  NUMERIC,
  last_sync_at         TIMESTAMPTZ,
  days_without_sync    INTEGER,
  active_connect       BOOLEAN,
  critical_alerts      BIGINT,
  ai_insights_count    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verificar super admin via is_super_admin()
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Acesso restrito ao Super Admin';
  END IF;

  RETURN QUERY
  SELECT
    st.id                                         AS store_id,
    st.name                                       AS store_name,
    (SELECT COUNT(DISTINCT bc2.id)
     FROM public.bank_connections bc2
     WHERE bc2.store_id = st.id AND bc2.is_active = TRUE)::BIGINT AS banks_connected,
    (SELECT COUNT(*)
     FROM public.bank_transactions bt2
     WHERE bt2.store_id = st.id)::BIGINT          AS total_transactions,
    COALESCE(
      (SELECT SUM(bt3.amount)
       FROM public.bank_transactions bt3
       WHERE bt3.store_id = st.id
         AND bt3.transaction_type = 'credit'
         AND bt3.status = 'reconciled'), 0
    )                                             AS total_received,
    (SELECT COUNT(*)
     FROM public.bank_transactions bt4
     WHERE bt4.store_id = st.id
       AND bt4.status = 'divergent')::BIGINT       AS divergent_count,
    (SELECT COUNT(*)
     FROM public.reconciliation_matches rm2
     WHERE rm2.store_id = st.id
       AND rm2.status = 'pending')::BIGINT         AS pending_matches,
    -- Taxa de conciliação
    CASE
      WHEN (SELECT COUNT(*) FROM public.bank_transactions bt5 WHERE bt5.store_id = st.id) = 0
      THEN 0
      ELSE ROUND(
        (SELECT COUNT(*) FROM public.bank_transactions bt6
         WHERE bt6.store_id = st.id AND bt6.status = 'reconciled')::NUMERIC
        / (SELECT COUNT(*) FROM public.bank_transactions bt7 WHERE bt7.store_id = st.id)
        * 100, 1
      )
    END                                           AS reconciliation_rate,
    -- Última sincronização
    (SELECT MAX(pi2.last_synced_at)
     FROM public.pluggy_items pi2
     WHERE pi2.store_id = st.id)                  AS last_sync_at,
    -- Dias sem sync
    EXTRACT(DAY FROM NOW() - (
      SELECT MAX(pi3.last_synced_at)
      FROM public.pluggy_items pi3
      WHERE pi3.store_id = st.id
    ))::INTEGER                                   AS days_without_sync,
    -- Tem licença Connect ativa?
    EXISTS (
      SELECT 1 FROM public.module_licenses ml
      WHERE ml.store_id = st.id
        AND ml.module_key = 'connect'
        AND ml.is_active = TRUE
        AND (ml.expires_at IS NULL OR ml.expires_at > NOW())
    )                                             AS active_connect,
    -- Alertas críticos não lidos
    (SELECT COUNT(*)
     FROM public.connect_alerts ca2
     WHERE ca2.store_id = st.id
       AND ca2.severity = 'error'
       AND ca2.dismissed_at IS NULL)::BIGINT       AS critical_alerts,
    -- Insights de IA ativos
    (SELECT COUNT(*)
     FROM public.connect_ai_insights ai2
     WHERE ai2.store_id = st.id
       AND ai2.is_dismissed = FALSE
       AND (ai2.expires_at IS NULL OR ai2.expires_at > NOW()))::BIGINT AS ai_insights_count
  FROM public.stores st
  WHERE EXISTS (
    SELECT 1 FROM public.bank_connections bc
    WHERE bc.store_id = st.id
  )
  ORDER BY total_transactions DESC, st.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_master_connect_dashboard() TO authenticated;

-- ── 2. RPC: get_master_connect_summary ────────────────────────────────
-- KPIs totais do Master Dashboard

CREATE OR REPLACE FUNCTION public.get_master_connect_summary()
RETURNS TABLE(
  total_stores         BIGINT,
  stores_with_banks    BIGINT,
  stores_active_connect BIGINT,
  total_banks_connected BIGINT,
  total_transactions   BIGINT,
  total_received       NUMERIC,
  total_divergent      BIGINT,
  stores_without_sync  BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Acesso restrito ao Super Admin';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.stores)::BIGINT,
    (SELECT COUNT(DISTINCT store_id) FROM public.bank_connections WHERE is_active = TRUE)::BIGINT,
    (SELECT COUNT(DISTINCT store_id) FROM public.module_licenses
     WHERE module_key = 'connect' AND is_active = TRUE
       AND (expires_at IS NULL OR expires_at > NOW()))::BIGINT,
    (SELECT COUNT(*) FROM public.bank_connections WHERE is_active = TRUE)::BIGINT,
    (SELECT COUNT(*) FROM public.bank_transactions)::BIGINT,
    COALESCE((SELECT SUM(amount) FROM public.bank_transactions
              WHERE transaction_type = 'credit' AND status = 'reconciled'), 0),
    (SELECT COUNT(*) FROM public.bank_transactions WHERE status = 'divergent')::BIGINT,
    (SELECT COUNT(DISTINCT pi.store_id)
     FROM public.pluggy_items pi
     WHERE pi.last_synced_at < NOW() - INTERVAL '48 hours'
        OR pi.last_synced_at IS NULL)::BIGINT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_master_connect_summary() TO authenticated;

-- ── 3. GRANTs service_role para RPCs de Block 5 ──────────────────────

GRANT EXECUTE ON FUNCTION public.add_connect_log(UUID, TEXT, TEXT, JSONB, UUID, UUID, TEXT)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.detect_ai_insights(UUID) TO service_role;
