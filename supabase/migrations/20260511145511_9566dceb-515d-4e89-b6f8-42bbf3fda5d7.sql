ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE OR REPLACE FUNCTION public.update_employee_role(p_profile_id uuid, p_new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store uuid := get_my_store_id(); v_my_role text := get_my_role(); v_target_role text; v_owner_count int;
BEGIN
  IF v_my_role NOT IN ('owner','admin','manager') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF p_new_role NOT IN ('owner','admin','manager','sales','stock','finance','viewer') THEN RAISE EXCEPTION 'Função inválida'; END IF;
  SELECT role INTO v_target_role FROM profiles WHERE id = p_profile_id AND store_id = v_store;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Funcionário não encontrado'; END IF;
  IF v_target_role = 'owner' AND p_new_role <> 'owner' THEN
    SELECT count(*) INTO v_owner_count FROM profiles WHERE store_id = v_store AND role = 'owner' AND is_active = true;
    IF v_owner_count <= 1 THEN RAISE EXCEPTION 'Não é possível remover o último proprietário'; END IF;
  END IF;
  IF p_new_role IN ('owner','admin') AND v_my_role <> 'owner' THEN RAISE EXCEPTION 'Apenas o proprietário pode definir essa função'; END IF;
  UPDATE profiles SET role = p_new_role WHERE id = p_profile_id AND store_id = v_store;
END;$$;

CREATE OR REPLACE FUNCTION public.set_employee_active(p_profile_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store uuid := get_my_store_id(); v_my_role text := get_my_role(); v_target_role text; v_owner_count int;
BEGIN
  IF v_my_role NOT IN ('owner','admin','manager') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT role INTO v_target_role FROM profiles WHERE id = p_profile_id AND store_id = v_store;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Funcionário não encontrado'; END IF;
  IF v_target_role = 'owner' AND p_active = false THEN
    SELECT count(*) INTO v_owner_count FROM profiles WHERE store_id = v_store AND role = 'owner' AND is_active = true;
    IF v_owner_count <= 1 THEN RAISE EXCEPTION 'Não é possível desativar o último proprietário'; END IF;
  END IF;
  UPDATE profiles SET is_active = p_active WHERE id = p_profile_id AND store_id = v_store;
END;$$;

CREATE OR REPLACE FUNCTION public.get_employee_performance(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (profile_id uuid, auth_user_id uuid, full_name text, role text, is_active boolean,
  sales_count bigint, sales_revenue numeric, avg_ticket numeric, sales_paid bigint, sales_pending bigint,
  returns_count bigint, returns_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT created_by AS auth_uid, count(*) AS cnt, coalesce(sum(net_total),0) AS revenue,
           count(*) FILTER (WHERE payment_status = 'paid') AS paid,
           count(*) FILTER (WHERE payment_status IN ('pending','partial')) AS pending
    FROM sales WHERE store_id = get_my_store_id() AND deleted_at IS NULL
      AND created_at >= p_start AND created_at < p_end
    GROUP BY created_by
  ),
  r AS (
    SELECT r.created_by AS auth_uid, count(DISTINCT r.id) AS cnt, coalesce(sum(ri.refund_amount),0) AS val
    FROM returns r LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE r.store_id = get_my_store_id() AND r.created_at >= p_start AND r.created_at < p_end
    GROUP BY r.created_by
  )
  SELECT p.id, p.auth_user_id, p.full_name, p.role, p.is_active,
         coalesce(s.cnt,0), coalesce(s.revenue,0),
         CASE WHEN coalesce(s.cnt,0) > 0 THEN s.revenue / s.cnt ELSE 0 END,
         coalesce(s.paid,0), coalesce(s.pending,0),
         coalesce(r.cnt,0), coalesce(r.val,0)
  FROM profiles p
  LEFT JOIN s ON s.auth_uid = p.auth_user_id
  LEFT JOIN r ON r.auth_uid = p.auth_user_id
  WHERE p.store_id = get_my_store_id()
  ORDER BY coalesce(s.revenue,0) DESC;
$$;

CREATE OR REPLACE FUNCTION public.list_employees()
RETURNS TABLE (profile_id uuid, auth_user_id uuid, full_name text, email text, role text,
  is_active boolean, created_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.auth_user_id, p.full_name, u.email::text, p.role, p.is_active, p.created_at, u.last_sign_in_at
  FROM profiles p LEFT JOIN auth.users u ON u.id = p.auth_user_id
  WHERE p.store_id = get_my_store_id() ORDER BY p.created_at ASC;
$$;