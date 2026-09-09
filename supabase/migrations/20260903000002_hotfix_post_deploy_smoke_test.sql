-- =====================================================================
-- HOTFIX pós-deploy do pacote de segurança v2 (20260903000001).
--
-- Um smoke test real (chamando as 26 funções guardadas via simulação de
-- JWT — admin e usuário de loja — logo após aplicar em produção)
-- encontrou 5 funções quebradas. 2 são regressão da conversão
-- LANGUAGE sql -> plpgsql feita no pacote de segurança; 3 já estavam
-- quebradas ANTES desta auditoria (confirmado comparando com o corpo
-- original extraído de produção antes de qualquer edição) e só ficaram
-- visíveis agora porque `RETURN QUERY` valida tipo/estrutura de forma
-- mais estrita que `LANGUAGE sql`.
--
-- 1) list_master_clients — REGRESSÃO NOSSA. RETURNS TABLE(..., status
--    text, ...) cria uma variável implícita `status` no escopo da
--    função; duas subqueries EXISTS referenciavam
--    `master_contracts.status` sem qualificar, viraram ambíguas contra
--    essa variável. Fix: qualificar com alias `mc2`.
--
-- 2) get_connect_health_analysis — REGRESSÃO NOSSA. Mesmo padrão: a CTE
--    `bank_conns` referenciava `last_sync_at` (de bank_connections) sem
--    qualificar, colidindo com a coluna de saída `last_sync_at` do
--    RETURNS TABLE. Fix: qualificar com alias `bc2`.
--
-- 3) get_connect_license — JÁ QUEBRADA ANTES (confirmado: corpo idêntico
--    ao extraído de produção no início da auditoria, já era
--    `LANGUAGE plpgsql`). Alias errado: SELECT usava `spu.email` mas o
--    JOIN declarava `sp` (`LEFT JOIN auth.users sp ON ...`). Função sem
--    nenhum chamador no frontend — por isso nunca deu erro pra ninguém.
--    Fix: corrige o alias.
--
-- 4) get_expiring_licenses — JÁ QUEBRADA ANTES. `u.email` é
--    `character varying` (tipo real de auth.users.email), mas
--    RETURNS TABLE declara `owner_email text` — RETURN QUERY exige tipo
--    exato, LANGUAGE sql tolerava a diferença. CHAMADA PELO FRONTEND
--    (Super Admin) — pode já estar quebrada em produção há tempo, sem
--    relação com esta auditoria. Fix: `u.email::text`.
--
-- 5) list_connect_licenses — mesmo bug de (4), mesmo motivo, também
--    chamada pelo frontend. Fix: `u.email::text`.
--
-- Todas as 5 verificadas com smoke test real (JWT simulado via
-- set_config + SET LOCAL ROLE, dentro de transação com ROLLBACK) antes
-- de escrever este arquivo — ver conversa da auditoria para o resultado
-- completo (26 funções testadas, 21 OK de primeira, 5 corrigidas aqui).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.list_master_clients()
 RETURNS TABLE(id uuid, name text, email text, phone text, city text, active_stores bigint, total_contracted numeric, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY
  SELECT
    mc.id,
    mc.name,
    mc.email,
    mc.phone,
    mc.city,
    (SELECT COUNT(*) FROM master_contracts mc2 WHERE mc2.client_id = mc.id AND mc2.status != 'canceled'),
    (SELECT COALESCE(SUM(value_total), 0) FROM master_contracts mc2 WHERE mc2.client_id = mc.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM master_contracts mc2 WHERE mc2.client_id = mc.id AND mc2.status = 'canceled') THEN 'inactive'
      WHEN EXISTS (SELECT 1 FROM master_contracts mc2 WHERE mc2.client_id = mc.id AND mc2.status IN ('sold', 'in_implementation')) THEN 'active'
      ELSE 'pending'
    END as status
  FROM public.master_clients mc
  ORDER BY mc.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_connect_health_analysis(p_store_id uuid)
 RETURNS TABLE(total_bank_txs bigint, reconciled_count bigint, divergent_count bigint, pending_match_count bigint, reconciliation_rate numeric, auto_reconciled_count bigint, manual_reconciled_count bigint, auto_rate numeric, banks_connected integer, banks_synced_24h integer, last_sync_at timestamp with time zone, avg_sync_gap_hours numeric, open_divergences_7d_plus bigint, health_score integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
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
      COUNT(*) FILTER (WHERE bc2.last_sync_at >= NOW() - INTERVAL '24 hours')    AS banks_synced_24h,
      MAX(bc2.last_sync_at)                                                      AS last_sync_at,
      COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - bc2.last_sync_at)) / 3600.0), 0)  AS avg_sync_gap_hours
    FROM bank_connections bc2
    WHERE bc2.store_id = p_store_id AND bc2.is_active = true
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
    LEAST(100, GREATEST(0,
      CASE WHEN bs.total_bank_txs = 0 THEN 20
           WHEN bs.reconciled_count::NUMERIC / bs.total_bank_txs >= 0.90 THEN 40
           WHEN bs.reconciled_count::NUMERIC / bs.total_bank_txs >= 0.70 THEN 28
           WHEN bs.reconciled_count::NUMERIC / bs.total_bank_txs >= 0.50 THEN 15
           ELSE 0
      END +
      CASE WHEN bc.banks_connected = 0 THEN 15
           WHEN bc.avg_sync_gap_hours <= 24  THEN 30
           WHEN bc.avg_sync_gap_hours <= 48  THEN 18
           WHEN bc.avg_sync_gap_hours <= 72  THEN 8
           ELSE 0
      END +
      CASE WHEN dv.old_divs = 0 THEN 30
           WHEN dv.old_divs <= 3 THEN 20
           WHEN dv.old_divs <= 10 THEN 10
           ELSE 0
      END
    ))::INTEGER                                                                   AS health_score
  FROM bank_stats bs, match_stats ms, bank_conns bc, div_old dv;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_connect_license(p_store_id uuid)
 RETURNS TABLE(id uuid, store_id uuid, store_name text, owner_email text, plan_type text, status text, contracted_at timestamp with time zone, expires_at timestamp with time zone, amount_paid numeric, currency text, suspended_at timestamp with time zone, suspended_by text, suspension_reason text, cancelled_at timestamp with time zone, cancelled_by text, cancellation_reason text, auto_renew boolean, days_until_expiry integer, is_expired boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY
  SELECT
    cl.id,
    cl.store_id,
    COALESCE(s.trade_name, s.name),
    pu.email::text,
    cl.plan_type,
    cl.status,
    cl.contracted_at,
    cl.expires_at,
    cl.amount_paid,
    cl.currency,
    cl.suspended_at,
    sp.email::text,
    cl.suspension_reason,
    cl.cancelled_at,
    cp.email::text,
    cl.cancellation_reason,
    cl.auto_renew,
    EXTRACT(DAY FROM (cl.expires_at - now()))::INT,
    cl.expires_at < now(),
    cl.created_at
  FROM connect_licenses cl
  LEFT JOIN stores s ON cl.store_id = s.id
  LEFT JOIN profiles p ON p.store_id = s.id AND p.role = 'owner'
  LEFT JOIN auth.users pu ON pu.id = p.auth_user_id
  LEFT JOIN auth.users sp ON cl.suspended_by = sp.id
  LEFT JOIN auth.users cp ON cl.cancelled_by = cp.id
  WHERE cl.store_id = p_store_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_expiring_licenses(p_days integer DEFAULT 7)
 RETURNS TABLE(id uuid, store_id uuid, store_name text, owner_email text, plan_type text, expires_at timestamp with time zone, days_until_expiry integer, amount_paid numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY
  SELECT
    cl.id,
    cl.store_id,
    COALESCE(s.trade_name, s.name),
    u.email::text,
    cl.plan_type,
    cl.expires_at,
    EXTRACT(DAY FROM (cl.expires_at - now()))::INT,
    cl.amount_paid
  FROM connect_licenses cl
  LEFT JOIN stores s ON cl.store_id = s.id
  LEFT JOIN profiles p ON p.store_id = s.id AND p.role = 'owner'
  LEFT JOIN auth.users u ON p.auth_user_id = u.id
  WHERE cl.status = 'active'
    AND cl.expires_at > now()
    AND cl.expires_at <= now() + (p_days || ' days')::INTERVAL
  ORDER BY cl.expires_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_connect_licenses(p_status text DEFAULT NULL::text, p_plan_type text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, store_id uuid, store_name text, owner_email text, plan_type text, status text, contracted_at timestamp with time zone, expires_at timestamp with time zone, amount_paid numeric, currency text, suspended_at timestamp with time zone, cancelled_at timestamp with time zone, auto_renew boolean, days_until_expiry integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY
  SELECT
    cl.id,
    cl.store_id,
    COALESCE(s.trade_name, s.name),
    u.email::text,
    cl.plan_type,
    cl.status,
    cl.contracted_at,
    cl.expires_at,
    cl.amount_paid,
    cl.currency,
    cl.suspended_at,
    cl.cancelled_at,
    cl.auto_renew,
    EXTRACT(DAY FROM (cl.expires_at - now()))::INT,
    cl.created_at
  FROM connect_licenses cl
  LEFT JOIN stores s ON cl.store_id = s.id
  LEFT JOIN profiles p ON p.store_id = s.id AND p.role = 'owner'
  LEFT JOIN auth.users u ON p.auth_user_id = u.id
  WHERE (p_status IS NULL OR cl.status = p_status)
    AND (p_plan_type IS NULL OR cl.plan_type = p_plan_type)
  ORDER BY cl.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;
