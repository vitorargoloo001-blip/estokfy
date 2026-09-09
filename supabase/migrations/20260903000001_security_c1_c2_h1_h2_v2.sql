-- =====================================================================
-- PACOTE DE CORREÇÃO DE SEGURANÇA — C1 / C2 / H1 / H2 — v2
-- Auditoria Estokfy 2026-09. NÃO APLICADO — arquivo de revisão.
--
-- v2 CORRIGE UM BUG REAL ENCONTRADO NA REVISÃO PRÉ-DEPLOY DA v1: a v1
-- usava `WITH _guard AS MATERIALIZED (...)` em 17 das 26 funções
-- LANGUAGE sql, assumindo que MATERIALIZED força a avaliação do guard
-- antes de qualquer dado ser lido. TESTADO EMPIRICAMENTE contra o banco
-- de produção (sequence temporária + nextval(), reversível, sem tocar
-- dado real) e CONFIRMADO FALSO: quando o outro lado do cross join é
-- vazio por dado real (ex.: loja sem vendas), o Postgres pode nunca
-- avaliar o lado do guard — nested loop com lado externo vazio nunca
-- sonda o lado interno, MATERIALIZED ou não. Só evita recomputação em
-- múltiplas referências; não força execução antecipada incondicional.
-- Prova: mesma sequence, mesmo padrão, contra `stores` (10 linhas, nunca
-- vazia) SEMPRE disparou; contra `sales WHERE store_id=<inexistente>`
-- (0 linhas) NUNCA disparou. Harness confirmado correto pelos dois
-- resultados opostos.
--
-- v2 substitui TODAS as 26 funções guardadas (as 17 que eram LANGUAGE
-- sql + as 9 que já eram plpgsql) por um único padrão: `LANGUAGE plpgsql`
-- com `PERFORM <guard>();` como primeira instrução do corpo, seguida de
-- `RETURN QUERY <corpo original inalterado>;`. PL/pgSQL executa
-- instruções sequencialmente, de forma imperativa — não há plano de
-- consulta, otimizador ou nested loop que possa pular uma instrução
-- PERFORM. Testado empiricamente (mesma técnica, mesma tabela vazia):
-- disparou 100% das vezes. Este é o único padrão usado a partir de
-- agora — não há mistura de abordagens "seguras por acaso" dependendo
-- do formato do CTE, pra não depender de raciocínio caso-a-caso sobre
-- comportamento do planner.
--
-- Resto do pacote (Seções 1, 2, 3, 7, 8) idêntico à v1 — não afetado
-- pelo bug, já revisado e confirmado.
--
-- TRATAMENTOS (5 categorias, ver detalhe função-a-função abaixo):
--   Seção 1 — REVOKE amplo de anon/PUBLIC em TODAS as SECURITY DEFINER
--             hoje expostas a anon.
--   Seção 2 — 3 funções-helper (guard reutilizável) — auditadas em
--             detalhe separado (ver AUDITORIA_HELPER_GUARD.md).
--   Seção 3 — Fix H1: view pluggy_connection_status.
--   Seção 4 — Categoria A: 9 funções master/plataforma — guard
--             is_super_admin(), mantém `authenticated`.
--   Seção 5 — Categoria B: 15 funções por loja — guard de pertencimento
--             a store_id, mantém `authenticated`.
--   Seção 6 — Categoria C: 2 funções por conexão bancária — guard via
--             bank_connections, mantém `authenticated`.
--   Seção 7 — Fix C2 + demais: REVOKE de `authenticated` também (mantém
--             só service_role) nas 29 restantes.
--   Seção 8 — Fix M7 bônus: RLS de connect_ai_queries.
--
-- GARANTIAS:
--   - Nenhum DROP de tabela, nenhuma perda de dado.
--   - Cada corpo SELECT das 26 funções é o EXTRAÍDO ORIGINAL do banco de
--     produção via pg_get_functiondef(), sem nenhuma alteração de lógica
--     — só embrulhado em BEGIN/RETURN QUERY/END. Nenhuma linha de
--     negócio foi reescrita.
--   - Toda REVOKE é reversível (GRANT de volta) e não apaga nada.
-- =====================================================================


-- =====================================================================
-- SEÇÃO 1 — REVOKE amplo (fecha o buraco anônimo imediatamente)
-- =====================================================================
DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC;', r.sig);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Seção 1: EXECUTE revogado de anon/PUBLIC em % funções SECURITY DEFINER.', v_count;
END $$;

-- Verificação (deve retornar 0):
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.prosecdef AND p.prokind='f'
--    AND has_function_privilege('anon', p.oid, 'EXECUTE');


-- =====================================================================
-- SEÇÃO 2 — Funções-helper de guard (reutilizadas nas seções 4/5/6)
-- Ver AUDITORIA_HELPER_GUARD.md para a checklist completa (owner,
-- search_path, comportamento sem profile, spoofing, etc.)
-- =====================================================================

CREATE OR REPLACE FUNCTION public._assert_store_membership(p_store_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'acesso_negado_store';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'acesso_negado_store';
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._assert_store_membership(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._assert_platform_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas_super_admin';
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._assert_platform_admin() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._assert_bank_connection_access(p_connection_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_connection_id IS NULL THEN
    RAISE EXCEPTION 'acesso_negado_conexao';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bank_connections bc
    JOIN public.profiles p ON p.store_id = bc.store_id
    WHERE bc.id = p_connection_id AND p.auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'acesso_negado_conexao';
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._assert_bank_connection_access(uuid) FROM PUBLIC, anon, authenticated;

-- Loja OU Super Admin: usada só por get_store_modules, que é chamada
-- tanto pelo dono/staff da própria loja (AuthContext no boot do app)
-- quanto pelo painel Super Admin, iterando TODAS as lojas
-- (SuperAdminModuleLicensing.tsx:50, dentro de um
-- `storesData.map(store => get_store_modules(store.id))`). Achado na
-- revisão pré-deploy: se essa função usasse _assert_store_membership
-- puro (sem bypass de admin), a tela de licenciamento do Super Admin
-- quebraria por completo — todo store.id ali é de OUTRA loja, não a do
-- admin.
CREATE OR REPLACE FUNCTION public._assert_store_membership_or_admin(p_store_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'acesso_negado_store';
  END IF;
  IF public.is_super_admin() THEN
    RETURN true;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'acesso_negado_store';
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._assert_store_membership_or_admin(uuid) FROM PUBLIC, anon, authenticated;


-- =====================================================================
-- SEÇÃO 3 — Fix H1: view pluggy_connection_status
-- =====================================================================
ALTER VIEW public.pluggy_connection_status SET (security_invoker = true);
REVOKE SELECT ON public.pluggy_connection_status FROM anon;


-- =====================================================================
-- SEÇÃO 4 — Categoria A: 9 funções master/plataforma
-- Todas LANGUAGE plpgsql, guard via PERFORM (testado, dispara sempre).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_financial_dashboard_kpis()
 RETURNS TABLE(total_revenue numeric, total_received numeric, total_pending numeric, active_clients bigint, active_stores bigint, active_modules bigint, overdue_payments bigint, ongoing_implementations bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY
  SELECT
    COALESCE(SUM(mc.value_total), 0) as total_revenue,
    COALESCE(SUM(mc.value_paid), 0) as total_received,
    COALESCE(SUM(mc.value_total - mc.value_paid), 0) as total_pending,
    (SELECT COUNT(DISTINCT client_id) FROM master_contracts WHERE status != 'canceled') as active_clients,
    (SELECT COUNT(DISTINCT store_id) FROM master_contracts WHERE status != 'canceled') as active_stores,
    (SELECT COUNT(*) FROM master_contract_modules WHERE status = 'implemented') as active_modules,
    (SELECT COUNT(*) FROM master_payments WHERE status = 'overdue') as overdue_payments,
    (SELECT COUNT(*) FROM master_installation_status WHERE status = 'in_implementation') as ongoing_implementations
  FROM public.master_contracts mc
  WHERE mc.status != 'canceled';
END;
$function$;

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
    (SELECT COUNT(*) FROM master_contracts WHERE client_id = mc.id AND status != 'canceled'),
    (SELECT COALESCE(SUM(value_total), 0) FROM master_contracts WHERE client_id = mc.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM master_contracts WHERE client_id = mc.id AND status = 'canceled') THEN 'inactive'
      WHEN EXISTS (SELECT 1 FROM master_contracts WHERE client_id = mc.id AND status IN ('sold', 'in_implementation')) THEN 'active'
      ELSE 'pending'
    END as status
  FROM public.master_clients mc
  ORDER BY mc.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_contract_details(p_contract_id uuid)
 RETURNS TABLE(contract_id uuid, client_name text, client_email text, store_name text, plan text, value_total numeric, value_paid numeric, status text, modules jsonb, payments jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY
  SELECT
    mc.id,
    mcl.name,
    mcl.email,
    COALESCE(s.trade_name, s.name),
    mc.plan,
    mc.value_total,
    mc.value_paid,
    mc.status,
    jsonb_agg(jsonb_build_object(
      'module_key', mcm.module_key,
      'value', mcm.value,
      'status', mcm.status,
      'activated_at', mcm.activated_at
    )),
    jsonb_agg(jsonb_build_object(
      'amount', mp.amount,
      'due_date', mp.due_date,
      'status', mp.status
    )),
    mc.created_at
  FROM public.master_contracts mc
  JOIN public.master_clients mcl ON mc.client_id = mcl.id
  JOIN public.stores s ON mc.store_id = s.id
  LEFT JOIN public.master_contract_modules mcm ON mc.id = mcm.contract_id
  LEFT JOIN public.master_payments mp ON mc.id = mp.contract_id
  WHERE mc.id = p_contract_id
  GROUP BY mc.id, mcl.name, mcl.email, COALESCE(s.trade_name, s.name), mc.plan, mc.value_total, mc.value_paid, mc.status, mc.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_store_by_owner_email(p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store_id uuid;
BEGIN
  PERFORM public._assert_platform_admin();
  SELECT p.store_id INTO v_store_id
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.auth_user_id
   WHERE lower(u.email) = lower(p_email)
     AND p.role = 'owner'
   LIMIT 1;
  RETURN v_store_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_module_audit(p_store_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, store_name text, module_key text, action text, admin_name text, created_at timestamp with time zone, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY
  SELECT
    mal.id,
    COALESCE(s.trade_name, s.name),
    mal.module_key,
    mal.action,
    COALESCE(p.full_name, 'System'),
    mal.created_at,
    mal.reason
  FROM public.module_audit_logs mal
  JOIN public.stores s ON mal.store_id = s.id
  LEFT JOIN public.profiles p ON mal.admin_user_id = p.id
  WHERE (p_store_id IS NULL OR mal.store_id = p_store_id)
  ORDER BY mal.created_at DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_connect_license_stats()
 RETURNS TABLE(total_licenses bigint, active_count bigint, suspended_count bigint, cancelled_count bigint, expiring_soon bigint, total_revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_platform_admin();
  RETURN QUERY
  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'active') as active,
    COUNT(*) FILTER (WHERE status = 'suspended') as suspended,
    COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
    COUNT(*) FILTER (WHERE status = 'active' AND expires_at <= now() + INTERVAL '7 days') as expiring,
    COALESCE(SUM(amount_paid) FILTER (WHERE status IN ('active', 'suspended')), 0) as revenue
  FROM connect_licenses;
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
    u.email,
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
    u.email,
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
    pu.email,
    cl.plan_type,
    cl.status,
    cl.contracted_at,
    cl.expires_at,
    cl.amount_paid,
    cl.currency,
    cl.suspended_at,
    spu.email,
    cl.suspension_reason,
    cl.cancelled_at,
    cpu.email,
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


-- =====================================================================
-- SEÇÃO 5 — Categoria B: 15 funções por loja
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_ai_query_history(p_store_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, question_key text, question_text text, answer_text text, answer_data jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
  SELECT ca.id, ca.question_key, ca.question_text, ca.answer_text, ca.answer_data, ca.created_at
  FROM connect_ai_queries ca
  WHERE ca.store_id = p_store_id
  ORDER BY ca.created_at DESC
  LIMIT p_limit;
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

CREATE OR REPLACE FUNCTION public.get_customer_ranking(p_store_id uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE(customer_id uuid, customer_name text, customer_phone text, total_sales bigint, total_amount numeric, total_paid numeric, total_pending numeric, pending_count bigint, last_purchase_date date, is_debtor boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
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
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_debt_analysis(p_store_id uuid)
 RETURNS TABLE(total_pending_sales bigint, total_pending_amount numeric, overdue_count bigint, overdue_amount numeric, overdue_30d_count bigint, overdue_30d_amount numeric, overdue_60d_count bigint, overdue_60d_amount numeric, overdue_90d_plus_count bigint, overdue_90d_plus_amount numeric, delinquency_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
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
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_payment_behavior(p_store_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(method text, current_count bigint, current_amount numeric, current_pct numeric, prev_count bigint, prev_amount numeric, prev_pct numeric, change_pct numeric, trend text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
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
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_trend(p_store_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(sale_date date, total_count bigint, total_amount numeric, pix_amount numeric, card_amount numeric, cash_amount numeric, other_amount numeric, pending_count bigint, paid_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
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
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_store_financial_summary(p_store_id uuid)
 RETURNS TABLE(week_received numeric, week_sales_count bigint, week_new_customers bigint, month_received numeric, month_sales_count bigint, month_divergences bigint, month_delinquency_rate numeric, month_reconciliation_rate numeric, prev_month_received numeric, prev_month_sales_count bigint, received_growth_pct numeric, sales_growth_pct numeric, forecast_30d numeric, at_risk_30d numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
  WITH
  week_start       AS (SELECT date_trunc('week', CURRENT_DATE)::date AS d),
  month_start      AS (SELECT date_trunc('month', CURRENT_DATE)::date AS d),
  prev_month_start AS (SELECT date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date AS d),
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
  cust_week AS (
    SELECT COUNT(*) AS cnt
    FROM customers
    WHERE store_id   = p_store_id
      AND created_at >= (SELECT d FROM week_start)
  ),
  diverg AS (
    SELECT COUNT(*) AS cnt
    FROM bank_transactions
    WHERE store_id         = p_store_id
      AND status           = 'divergent'
      AND transaction_date >= (SELECT d FROM month_start)
  ),
  dlq AS (
    SELECT
      COALESCE(SUM(amount_pending) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE), 0) AS overdue_amount,
      COALESCE(SUM(amount_pending), 0) AS total_pending_amount
    FROM sales
    WHERE store_id        = p_store_id
      AND deleted_at      IS NULL
      AND payment_status  IN ('pending','partial')
  ),
  recon AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'confirmed')::NUMERIC AS reconciled,
      COUNT(*)::NUMERIC                                       AS total
    FROM reconciliation_matches
    WHERE store_id   = p_store_id
      AND created_at >= (SELECT d FROM month_start)
  ),
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
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_store_modules(p_store_id uuid)
 RETURNS TABLE(module_key text, is_active boolean, activated_at timestamp with time zone, deactivation_scheduled_at timestamp with time zone, deactivation_requested_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_store_membership_or_admin(p_store_id);
  RETURN QUERY
  SELECT
    sm.module_key,
    sm.is_active,
    sm.activated_at,
    sm.deactivation_scheduled_at,
    sm.deactivation_requested_at
  FROM public.store_modules sm
  WHERE sm.store_id = p_store_id
  ORDER BY sm.module_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_transaction_summary(p_store_id uuid)
 RETURNS TABLE(total_count bigint, total_amount numeric, pending_count bigint, pending_amount numeric, reconciled_count bigint, reconciled_amount numeric, divergent_count bigint, divergent_amount numeric, ignored_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
  SELECT
    COUNT(*) as total_count,
    COALESCE(SUM(amount), 0) as total_amount,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
    COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) as pending_amount,
    COUNT(*) FILTER (WHERE status = 'reconciled') as reconciled_count,
    COALESCE(SUM(amount) FILTER (WHERE status = 'reconciled'), 0) as reconciled_amount,
    COUNT(*) FILTER (WHERE status = 'divergent') as divergent_count,
    COALESCE(SUM(amount) FILTER (WHERE status = 'divergent'), 0) as divergent_amount,
    COUNT(*) FILTER (WHERE status = 'ignored') as ignored_count
  FROM public.bank_transactions
  WHERE store_id = p_store_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_bank_connections(p_store_id uuid)
 RETURNS TABLE(id uuid, bank_name text, agency text, account_number text, account_type text, status text, last_sync_at timestamp with time zone, last_sync_status text, total_transactions bigint, is_active boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
  SELECT
    bc.id,
    bc.bank_name,
    bc.agency,
    bc.account_number,
    bc.account_type,
    bc.status,
    bc.last_sync_at,
    bc.last_sync_status,
    bc.total_transactions,
    bc.is_active,
    bc.created_at
  FROM public.bank_connections bc
  WHERE bc.store_id = p_store_id
  ORDER BY bc.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_bank_transactions(p_store_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_bank_connection_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_min_amount numeric DEFAULT NULL::numeric, p_max_amount numeric DEFAULT NULL::numeric, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, transaction_date date, transaction_time time without time zone, amount numeric, transaction_type text, description text, bank_name text, method text, status text, origin_account text, destination_account text, category text, reconciled_with text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
  SELECT
    bt.id,
    bt.transaction_date,
    bt.transaction_time,
    bt.amount,
    bt.transaction_type,
    bt.description,
    bt.bank_name,
    bt.method,
    bt.status,
    bt.origin_account,
    bt.destination_account,
    bt.category,
    COALESCE(s.id::text, 'unmatched'::text),
    bt.created_at
  FROM public.bank_transactions bt
  LEFT JOIN public.sales s ON bt.sale_id = s.id
  WHERE bt.store_id = p_store_id
    AND (p_start_date IS NULL OR bt.transaction_date >= p_start_date)
    AND (p_end_date IS NULL OR bt.transaction_date <= p_end_date)
    AND (p_bank_connection_id IS NULL OR bt.bank_connection_id = p_bank_connection_id)
    AND (p_status IS NULL OR bt.status = p_status)
    AND (p_min_amount IS NULL OR bt.amount >= p_min_amount)
    AND (p_max_amount IS NULL OR bt.amount <= p_max_amount)
  ORDER BY bt.transaction_date DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_audit_timeline(p_store_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(date date, login bigint, sync bigint, reconciliation bigint, update_op bigint, delete_op bigint, reprocess bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
  SELECT
    cal.created_at_date,
    COUNT(*) FILTER (WHERE cal.action_type = 'login') as login,
    COUNT(*) FILTER (WHERE cal.action_type = 'sync') as sync,
    COUNT(*) FILTER (WHERE cal.action_type = 'reconciliation') as reconciliation,
    COUNT(*) FILTER (WHERE cal.action_type = 'update') as update_op,
    COUNT(*) FILTER (WHERE cal.action_type = 'delete') as delete_op,
    COUNT(*) FILTER (WHERE cal.action_type = 'reprocess') as reprocess
  FROM connect_audit_logs cal
  WHERE cal.store_id = p_store_id
    AND cal.created_at >= now() - (p_days || ' days')::INTERVAL
  GROUP BY cal.created_at_date
  ORDER BY cal.created_at_date DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_automations_dashboard(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_active    INT;
  v_runs_today      INT;
  v_errors_today    INT;
  v_pending_approval INT;
  v_notifications   INT;
  v_next_run        TIMESTAMPTZ;
BEGIN
  PERFORM public._assert_store_membership(p_store_id);

  SELECT COUNT(*) INTO v_total_active
  FROM connect_automations WHERE store_id = p_store_id AND is_active = true;

  SELECT COUNT(*) INTO v_runs_today
  FROM connect_automation_runs r
  JOIN connect_automations a ON a.id = r.automation_id
  WHERE a.store_id = p_store_id AND r.started_at >= CURRENT_DATE;

  SELECT COUNT(*) INTO v_errors_today
  FROM connect_automation_runs r
  JOIN connect_automations a ON a.id = r.automation_id
  WHERE a.store_id = p_store_id AND r.started_at >= CURRENT_DATE AND r.status = 'error';

  SELECT COUNT(*) INTO v_pending_approval
  FROM connect_automation_runs r
  JOIN connect_automations a ON a.id = r.automation_id
  WHERE a.store_id = p_store_id AND r.status = 'pending_approval';

  SELECT COUNT(*) INTO v_notifications
  FROM connect_notifications
  WHERE store_id = p_store_id AND status IN ('pending','sent');

  SELECT MIN(next_run_at) INTO v_next_run
  FROM connect_automations
  WHERE store_id = p_store_id AND is_active = true AND next_run_at > now();

  RETURN jsonb_build_object(
    'total_active',      v_total_active,
    'runs_today',        v_runs_today,
    'errors_today',      v_errors_today,
    'pending_approval',  v_pending_approval,
    'unread_notifications', v_notifications,
    'next_run_at',       v_next_run
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_connect_audit_summary(p_store_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(action_type text, count bigint, last_occurrence timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
  SELECT
    cal.action_type,
    COUNT(*) as count,
    MAX(cal.created_at) as last_occurrence
  FROM connect_audit_logs cal
  WHERE cal.store_id = p_store_id
    AND cal.created_at >= now() - (p_days || ' days')::INTERVAL
  GROUP BY cal.action_type
  ORDER BY count DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_connect_audit_logs(p_store_id uuid, p_action_type text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, action text, action_type text, entity_type text, entity_id uuid, details jsonb, ip_address text, created_at timestamp with time zone, created_at_date date)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
  SELECT
    cal.id,
    cal.user_id,
    COALESCE(p.full_name, au.email) AS user_email,
    cal.action,
    cal.action_type,
    cal.entity_type,
    cal.entity_id,
    cal.details,
    cal.ip_address,
    cal.created_at,
    cal.created_at_date
  FROM connect_audit_logs cal
  LEFT JOIN auth.users au ON cal.user_id = au.id
  LEFT JOIN profiles p ON p.auth_user_id = cal.user_id
  WHERE cal.store_id = p_store_id
    AND (p_action_type IS NULL OR cal.action_type = p_action_type)
    AND (p_entity_type IS NULL OR cal.entity_type = p_entity_type)
    AND (p_start_date IS NULL OR cal.created_at >= p_start_date)
    AND (p_end_date IS NULL OR cal.created_at <= p_end_date)
  ORDER BY cal.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;


-- =====================================================================
-- SEÇÃO 6 — Categoria C: 2 funções por conexão bancária
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_sync_history(p_connection_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, sync_started_at timestamp with time zone, sync_completed_at timestamp with time zone, status text, transactions_found bigint, transactions_imported bigint, transactions_skipped bigint, error_message text, duration_minutes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_bank_connection_access(p_connection_id);
  RETURN QUERY
  SELECT
    bsh.id,
    bsh.sync_started_at,
    bsh.sync_completed_at,
    bsh.status,
    bsh.transactions_found,
    bsh.transactions_imported,
    bsh.transactions_skipped,
    bsh.error_message,
    EXTRACT(EPOCH FROM (bsh.sync_completed_at - bsh.sync_started_at)) / 60 as duration_minutes
  FROM public.bank_sync_history bsh
  WHERE bsh.bank_connection_id = p_connection_id
  ORDER BY bsh.sync_started_at DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_bank_sync(p_connection_id uuid, p_status text, p_found bigint DEFAULT 0, p_imported bigint DEFAULT 0, p_error text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_history_id UUID;
BEGIN
  PERFORM public._assert_bank_connection_access(p_connection_id);

  INSERT INTO public.bank_sync_history (
    bank_connection_id, status, transactions_found,
    transactions_imported, error_message, sync_completed_at
  )
  VALUES (
    p_connection_id, p_status, p_found, p_imported, p_error, now()
  )
  RETURNING bank_sync_history.id INTO v_history_id;

  UPDATE public.bank_connections
  SET
    status = CASE WHEN p_status = 'failed' THEN 'error' ELSE 'connected' END,
    last_sync_at = now(),
    last_sync_status = p_status,
    total_transactions = CASE WHEN p_status = 'success' THEN p_imported ELSE total_transactions END,
    error_message = p_error,
    updated_at = now()
  WHERE id = p_connection_id;

  RETURN QUERY SELECT true, 'Sync recorded successfully';
END;
$function$;


-- =====================================================================
-- SEÇÃO 7 — Fecha `authenticated` também (mantém só service_role)
-- =====================================================================

-- 7a — 6 helpers internos.
REVOKE EXECUTE ON FUNCTION public._allocate_payment_fifo_within_sale(uuid, uuid, numeric) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_connect_alert(uuid, text, text, text, text, text, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_connect_notification(uuid, text, text, text, text, text, uuid, uuid, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_module(uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_return_effects(uuid, uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.so_recalc_totals(uuid) FROM anon, authenticated, PUBLIC;

-- 7b — 23 usadas SOMENTE por Edge Function com service_role, incluindo
-- get_bank_connection_token (C2-adjacente — ver
-- AVALIACAO_get_bank_connection_token.md para a análise completa: os 3
-- únicos chamadores nunca ecoam o token na resposta HTTP, mas são código
-- legado morto — recomendação separada de exclusão, não coberta aqui).
REVOKE EXECUTE ON FUNCTION public.add_automation_log(uuid, uuid, text, text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_connect_log(uuid, text, text, jsonb, uuid, uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_connect_enabled(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_automation_run(uuid, text, jsonb, text, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.connect_cron_tick() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bank_connection_token(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bank_connection_with_provider(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_connect_setup_progress(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pluggy_items_for_sync(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_module_audit_log(uuid, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_webhook_events(uuid, uuid, text, boolean, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_connect_audit(uuid, uuid, text, text, text, uuid, jsonb, text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_pluggy_item_synced(text, timestamp with time zone) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_webhook_processed(uuid, boolean, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_pluggy_webhook(text, text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.store_provider_webhook(uuid, uuid, text, text, text, jsonb, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_bank_accounts_from_provider(uuid, uuid, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_bank_transactions_from_provider(uuid, uuid, uuid, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_bank_connection_sync(uuid, text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_bank_connection_sync_status(uuid, text, text, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_or_insert_bank_connection(uuid, text, text, text, timestamp with time zone, text, text, text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_pluggy_item_status(text, text, text, text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_bank_transaction_pluggy(uuid, uuid, text, date, numeric, text, text, text, text, jsonb) FROM anon, authenticated, PUBLIC;


-- =====================================================================
-- SEÇÃO 8 — Fix M7 bônus: RLS de connect_ai_queries
-- =====================================================================
DROP POLICY IF EXISTS tenant_isolation_ai_queries ON public.connect_ai_queries;
CREATE POLICY tenant_isolation_ai_queries ON public.connect_ai_queries
  USING (store_id = get_my_store_id());


-- =====================================================================
-- CHECKLIST DE VERIFICAÇÃO PÓS-APLICAÇÃO
-- =====================================================================
-- 1) anon: 0 SECURITY DEFINER executável.
-- 2) authenticated: as 26 guardadas continuam OK (smoke test manual).
-- 3) authenticated: as 29 revogadas retornam "permission denied" (ver
--    query no fim da v1 original — mesma lista).
-- 4) Guard dispara mesmo com dados vazios — testar chamando qualquer uma
--    das 15 funções de loja para uma loja SEM dados naquela tabela,
--    autenticado como usuário de OUTRA loja: deve dar acesso_negado_store,
--    não "0 linhas".
-- =====================================================================
