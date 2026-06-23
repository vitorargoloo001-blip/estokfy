-- =====================================================================
-- Block 11 — Correção crítica: métricas por funcionário
--
-- CAUSA RAIZ IDENTIFICADA:
--   profiles.id (PK gerado) != profiles.auth_user_id (FK auth.users)
--   sales.created_by referencia profiles.id
--   get_employee_performance juntava por p.auth_user_id → nunca batia → zeros
--
-- FIX: trocar join de p.auth_user_id → p.id em get_employee_performance
-- NOVO: get_employee_performance_summary(p_store_id, p_start_date, p_end_date)
--   retorna métricas completas por funcionário (para relatórios externos)
-- =====================================================================

-- ============================================================
-- 1. CORRIGIR get_employee_performance (join errado → zeros)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_employee_performance(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  profile_id       uuid,
  auth_user_id     uuid,
  full_name        text,
  role             text,
  is_active        boolean,
  sales_count      bigint,
  sales_revenue    numeric,
  avg_ticket       numeric,
  sales_paid       bigint,
  sales_pending    bigint,
  returns_count    bigint,
  returns_value    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT
      created_by                                                   AS profile_uid,
      count(*)                                                     AS cnt,
      coalesce(sum(net_total), 0)                                  AS revenue,
      count(*) FILTER (WHERE payment_status = 'paid')              AS paid,
      count(*) FILTER (WHERE payment_status IN ('pending','partial')) AS pending
    FROM sales
    WHERE store_id  = get_my_store_id()
      AND deleted_at IS NULL
      AND status NOT IN ('cancelled','refunded')
      AND sale_date >= (p_start AT TIME ZONE 'America/Sao_Paulo')::date
      AND sale_date <= (p_end   AT TIME ZONE 'America/Sao_Paulo')::date
    GROUP BY created_by
  ),
  r AS (
    SELECT
      r.created_by                                   AS profile_uid,
      count(DISTINCT r.id)                           AS cnt,
      coalesce(sum(ri.refund_amount), 0)             AS val
    FROM returns r
    LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE r.store_id  = get_my_store_id()
      AND r.created_at >= p_start
      AND r.created_at <  p_end
    GROUP BY r.created_by
  )
  SELECT
    p.id,
    p.auth_user_id,
    p.full_name,
    p.role,
    p.is_active,
    coalesce(s.cnt,     0),
    coalesce(s.revenue, 0),
    CASE WHEN coalesce(s.cnt, 0) > 0
         THEN s.revenue / s.cnt
         ELSE 0 END,
    coalesce(s.paid,    0),
    coalesce(s.pending, 0),
    coalesce(r.cnt,     0),
    coalesce(r.val,     0)
  FROM profiles p
  LEFT JOIN s ON s.profile_uid = p.id   -- FIX: era p.auth_user_id, deveria ser p.id
  LEFT JOIN r ON r.profile_uid = p.id   -- FIX: idem
  WHERE p.store_id = get_my_store_id()
  ORDER BY coalesce(s.revenue, 0) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_employee_performance(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employee_performance(timestamptz, timestamptz) TO authenticated;

-- ============================================================
-- 2. NOVA RPC: get_employee_performance_summary
--    Parâmetros: store_id (validado por RLS), start_date, end_date (date)
--    Retorna uma linha por funcionário com métricas completas.
--    Usada futuramente em relatórios externos e filtros avançados.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_employee_performance_summary(
  p_store_id   uuid,
  p_start_date date,
  p_end_date   date
)
RETURNS TABLE (
  profile_id       uuid,
  auth_user_id     uuid,
  full_name        text,
  role             text,
  is_active        boolean,
  sales_count      bigint,
  sales_revenue    numeric,
  avg_ticket       numeric,
  sales_paid       bigint,
  sales_pending    bigint,
  returns_count    bigint,
  returns_value    numeric,
  cancels_count    bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'sem_loja'; END IF;
  IF p_store_id <> v_store THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
    THEN RAISE EXCEPTION 'periodo_invalido'; END IF;

  RETURN QUERY
  WITH s AS (
    SELECT
      created_by                                                         AS profile_uid,
      count(*) FILTER (WHERE status NOT IN ('cancelled','refunded')
                          AND deleted_at IS NULL)                        AS cnt,
      coalesce(sum(net_total) FILTER (
        WHERE status NOT IN ('cancelled','refunded') AND deleted_at IS NULL), 0) AS revenue,
      count(*) FILTER (WHERE status NOT IN ('cancelled','refunded')
                          AND deleted_at IS NULL
                          AND payment_status = 'paid')                  AS paid,
      count(*) FILTER (WHERE status NOT IN ('cancelled','refunded')
                          AND deleted_at IS NULL
                          AND payment_status IN ('pending','partial'))   AS pending,
      count(*) FILTER (WHERE status IN ('cancelled','refunded')
                          OR  deleted_at IS NOT NULL)                   AS cancels
    FROM sales
    WHERE store_id  = p_store_id
      AND sale_date BETWEEN p_start_date AND p_end_date
    GROUP BY created_by
  ),
  r AS (
    SELECT
      r.created_by                       AS profile_uid,
      count(DISTINCT r.id)               AS cnt,
      coalesce(sum(ri.refund_amount), 0) AS val
    FROM returns r
    LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE r.store_id  = p_store_id
      AND r.created_at >= (p_start_date::text || ' 00:00:00')::timestamp
                           AT TIME ZONE 'America/Sao_Paulo'
      AND r.created_at <  ((p_end_date + 1)::text || ' 00:00:00')::timestamp
                           AT TIME ZONE 'America/Sao_Paulo'
    GROUP BY r.created_by
  )
  SELECT
    p.id,
    p.auth_user_id,
    p.full_name,
    p.role,
    p.is_active,
    coalesce(s.cnt,     0),
    coalesce(s.revenue, 0),
    CASE WHEN coalesce(s.cnt, 0) > 0
         THEN s.revenue / s.cnt
         ELSE 0 END,
    coalesce(s.paid,    0),
    coalesce(s.pending, 0),
    coalesce(r.cnt,     0),
    coalesce(r.val,     0),
    coalesce(s.cancels, 0)
  FROM profiles p
  LEFT JOIN s ON s.profile_uid = p.id
  LEFT JOIN r ON r.profile_uid = p.id
  WHERE p.store_id = p_store_id
  ORDER BY coalesce(s.revenue, 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employee_performance_summary(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employee_performance_summary(uuid, date, date) TO authenticated;
