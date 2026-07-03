-- Block 5: Super Admin Master Dashboard for Connect (all stores overview)
-- Backfilled 2026-07-01: applied directly in production on 2026-06-21, never committed
-- to git. Reconstructed from the live schema AFTER a live bugfix applied during the
-- Connect production audit (2026-07-01): both functions originally referenced a
-- non-existent table `public.module_licenses`, causing PGRST202/42P01 errors and a
-- blank Master Dashboard page. Corrected here to use `public.store_modules` (the real
-- single source of truth for module activation, matching useConnectModuleAccess on the
-- frontend), including its `deactivation_scheduled_at` column instead of the
-- module_licenses-only `expires_at`. This version matches what is now live in production.

CREATE OR REPLACE FUNCTION public.get_master_connect_dashboard()
RETURNS TABLE(store_id uuid, store_name text, banks_connected bigint, total_transactions bigint, total_received numeric, divergent_count bigint, pending_matches bigint, reconciliation_rate numeric, last_sync_at timestamp with time zone, days_without_sync integer, active_connect boolean, critical_alerts bigint, ai_insights_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Acesso restrito ao Super Admin';
  END IF;

  RETURN QUERY
  SELECT
    st.id AS store_id,
    st.name AS store_name,
    (SELECT COUNT(DISTINCT bc2.id) FROM public.bank_connections bc2 WHERE bc2.store_id = st.id AND bc2.is_active = TRUE)::BIGINT AS banks_connected,
    (SELECT COUNT(*) FROM public.bank_transactions bt2 WHERE bt2.store_id = st.id)::BIGINT AS total_transactions,
    COALESCE((SELECT SUM(bt3.amount) FROM public.bank_transactions bt3 WHERE bt3.store_id = st.id AND bt3.transaction_type = 'credit' AND bt3.status = 'reconciled'), 0) AS total_received,
    (SELECT COUNT(*) FROM public.bank_transactions bt4 WHERE bt4.store_id = st.id AND bt4.status = 'divergent')::BIGINT AS divergent_count,
    (SELECT COUNT(*) FROM public.reconciliation_matches rm2 WHERE rm2.store_id = st.id AND rm2.status = 'pending')::BIGINT AS pending_matches,
    CASE
      WHEN (SELECT COUNT(*) FROM public.bank_transactions bt5 WHERE bt5.store_id = st.id) = 0
      THEN 0
      ELSE ROUND((SELECT COUNT(*) FROM public.bank_transactions bt6 WHERE bt6.store_id = st.id AND bt6.status = 'reconciled')::NUMERIC / (SELECT COUNT(*) FROM public.bank_transactions bt7 WHERE bt7.store_id = st.id) * 100, 1)
    END AS reconciliation_rate,
    (SELECT MAX(pi2.last_synced_at) FROM public.pluggy_items pi2 WHERE pi2.store_id = st.id) AS last_sync_at,
    EXTRACT(DAY FROM NOW() - (SELECT MAX(pi3.last_synced_at) FROM public.pluggy_items pi3 WHERE pi3.store_id = st.id))::INTEGER AS days_without_sync,
    EXISTS (
      SELECT 1 FROM public.store_modules sm
      WHERE sm.store_id = st.id
        AND sm.module_key = 'connect'
        AND sm.is_active = TRUE
        AND (sm.deactivation_scheduled_at IS NULL OR sm.deactivation_scheduled_at > NOW())
    ) AS active_connect,
    (SELECT COUNT(*) FROM public.connect_alerts ca2 WHERE ca2.store_id = st.id AND ca2.severity = 'error' AND ca2.dismissed_at IS NULL)::BIGINT AS critical_alerts,
    (SELECT COUNT(*) FROM public.connect_ai_insights ai2 WHERE ai2.store_id = st.id AND ai2.is_dismissed = FALSE AND (ai2.expires_at IS NULL OR ai2.expires_at > NOW()))::BIGINT AS ai_insights_count
  FROM public.stores st
  WHERE EXISTS (SELECT 1 FROM public.bank_connections bc WHERE bc.store_id = st.id)
  ORDER BY total_transactions DESC, st.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_master_connect_summary()
RETURNS TABLE(total_stores bigint, stores_with_banks bigint, stores_active_connect bigint, total_banks_connected bigint, total_transactions bigint, total_received numeric, total_divergent bigint, stores_without_sync bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Acesso restrito ao Super Admin';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.stores)::BIGINT,
    (SELECT COUNT(DISTINCT store_id) FROM public.bank_connections WHERE is_active = TRUE)::BIGINT,
    (SELECT COUNT(DISTINCT store_id) FROM public.store_modules
     WHERE module_key = 'connect' AND is_active = TRUE
       AND (deactivation_scheduled_at IS NULL OR deactivation_scheduled_at > NOW()))::BIGINT,
    (SELECT COUNT(*) FROM public.bank_connections WHERE is_active = TRUE)::BIGINT,
    (SELECT COUNT(*) FROM public.bank_transactions)::BIGINT,
    COALESCE((SELECT SUM(amount) FROM public.bank_transactions WHERE transaction_type = 'credit' AND status = 'reconciled'), 0),
    (SELECT COUNT(*) FROM public.bank_transactions WHERE status = 'divergent')::BIGINT,
    (SELECT COUNT(DISTINCT pi.store_id) FROM public.pluggy_items pi WHERE pi.last_synced_at < NOW() - INTERVAL '48 hours' OR pi.last_synced_at IS NULL)::BIGINT;
END;
$function$;
