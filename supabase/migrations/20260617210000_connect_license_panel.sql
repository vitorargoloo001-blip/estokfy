-- =====================================================================
-- Painel comercial/operacional de Licenças do Connect (Super Admin)
-- Controla o acesso ao Connect 100% por loja: ativar/suspender/cancelar
-- cada ação também liga/desliga o módulo (store_modules) => menus + rotas.
-- =====================================================================

-- 1) connect_licenses: planos por PERÍODO, expiração opcional (vitalício), observações
ALTER TABLE public.connect_licenses DROP CONSTRAINT IF EXISTS connect_licenses_plan_type_check;
ALTER TABLE public.connect_licenses
  ADD CONSTRAINT connect_licenses_plan_type_check
  CHECK (plan_type IN ('mensal','trimestral','semestral','anual','vitalicio'));
ALTER TABLE public.connect_licenses ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE public.connect_licenses ADD COLUMN IF NOT EXISTS notes text;

-- 2) Listar TODAS as lojas com o status do Connect (somente master)
CREATE OR REPLACE FUNCTION public.list_stores_with_connect()
RETURNS TABLE (
  store_id uuid,
  store_name text,
  owner_name text,
  owner_email text,
  store_plan text,
  connect_status text,
  connect_active boolean,
  plan_type text,
  amount_paid numeric,
  contracted_at timestamptz,
  expires_at timestamptz,
  notes text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.id,
    COALESCE(s.trade_name, s.name),
    op.full_name,
    ou.email,
    s.plan,
    COALESCE(cl.status, 'none'),
    public.has_module(s.id, 'connect'),
    cl.plan_type,
    cl.amount_paid,
    cl.contracted_at,
    cl.expires_at,
    cl.notes
  FROM public.stores s
  LEFT JOIN LATERAL (
    SELECT full_name, auth_user_id FROM public.profiles
    WHERE store_id = s.id AND role = 'owner' ORDER BY created_at LIMIT 1
  ) op ON true
  LEFT JOIN auth.users ou ON ou.id = op.auth_user_id
  LEFT JOIN public.connect_licenses cl ON cl.store_id = s.id
  WHERE public.is_super_admin()
  ORDER BY COALESCE(s.trade_name, s.name);
$$;

-- 3) Ativar/renovar Connect para uma loja (cria/atualiza licença + libera módulo)
CREATE OR REPLACE FUNCTION public.activate_connect_for_store(
  p_store_id uuid,
  p_plan_type text,
  p_amount numeric,
  p_starts_at timestamptz DEFAULT now(),
  p_expires_at timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'apenas_master'; END IF;
  IF p_plan_type NOT IN ('mensal','trimestral','semestral','anual','vitalicio') THEN RAISE EXCEPTION 'plano_invalido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN RAISE EXCEPTION 'loja_nao_encontrada'; END IF;
  SELECT * INTO v_ctx FROM public.current_profile();

  INSERT INTO public.connect_licenses(
    store_id, plan_type, status, contracted_at, expires_at, amount_paid, notes, auto_renew
  ) VALUES (
    p_store_id, p_plan_type, 'active', COALESCE(p_starts_at, now()),
    CASE WHEN p_plan_type = 'vitalicio' THEN NULL ELSE p_expires_at END,
    COALESCE(p_amount, 0), p_notes, (p_plan_type <> 'vitalicio')
  )
  ON CONFLICT (store_id) DO UPDATE SET
    plan_type = EXCLUDED.plan_type,
    status = 'active',
    contracted_at = EXCLUDED.contracted_at,
    expires_at = EXCLUDED.expires_at,
    amount_paid = EXCLUDED.amount_paid,
    notes = EXCLUDED.notes,
    suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL,
    cancelled_at = NULL, cancelled_by = NULL, cancellation_reason = NULL,
    auto_renew = (EXCLUDED.plan_type <> 'vitalicio'),
    updated_at = now()
  RETURNING id INTO v_id;

  -- libera o módulo => menus e rotas do Connect
  PERFORM public.toggle_store_module(p_store_id, 'connect', true, NULL);

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'connect_license_activate', 'connect_license', v_id,
    jsonb_build_object('plan', p_plan_type, 'amount', p_amount, 'starts_at', p_starts_at,
                       'expires_at', p_expires_at, 'notes', p_notes));

  RETURN jsonb_build_object('license_id', v_id, 'status', 'active');
END;
$$;

-- 4) Suspender Connect (mantém histórico, bloqueia acesso)
CREATE OR REPLACE FUNCTION public.suspend_connect_for_store(p_store_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ctx record;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'apenas_master'; END IF;
  SELECT * INTO v_ctx FROM public.current_profile();

  UPDATE public.connect_licenses
    SET status = 'suspended', suspended_at = now(), suspended_by = auth.uid(),
        suspension_reason = p_reason, updated_at = now()
    WHERE store_id = p_store_id;

  PERFORM public.toggle_store_module(p_store_id, 'connect', false, NULL);

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'connect_license_suspend', 'connect_license', p_store_id,
    jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('status', 'suspended');
END;
$$;

-- 5) Cancelar Connect (mantém histórico, bloqueia acesso)
CREATE OR REPLACE FUNCTION public.cancel_connect_for_store(p_store_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ctx record;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'apenas_master'; END IF;
  SELECT * INTO v_ctx FROM public.current_profile();

  UPDATE public.connect_licenses
    SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
        cancellation_reason = p_reason, auto_renew = false, updated_at = now()
    WHERE store_id = p_store_id;

  PERFORM public.toggle_store_module(p_store_id, 'connect', false, NULL);

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'connect_license_cancel', 'connect_license', p_store_id,
    jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('status', 'cancelled');
END;
$$;

-- 6) Histórico da licença de uma loja
CREATE OR REPLACE FUNCTION public.connect_license_history(p_store_id uuid)
RETURNS TABLE (action text, details jsonb, actor text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT al.action, al.after_json,
         COALESCE(p.full_name, 'Sistema'),
         al.created_at
  FROM public.audit_logs al
  LEFT JOIN public.profiles p ON p.id = al.actor_profile_id
  WHERE al.store_id = p_store_id
    AND al.entity = 'connect_license'
    AND public.is_super_admin()
  ORDER BY al.created_at DESC
  LIMIT 100;
$$;

-- 7) KPIs do painel
CREATE OR REPLACE FUNCTION public.get_connect_panel_stats()
RETURNS TABLE (
  total_stores bigint,
  active_count bigint,
  suspended_count bigint,
  cancelled_count bigint,
  recurring_revenue numeric,
  total_revenue numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.stores),
    (SELECT count(*) FROM public.connect_licenses WHERE status = 'active'),
    (SELECT count(*) FROM public.connect_licenses WHERE status = 'suspended'),
    (SELECT count(*) FROM public.connect_licenses WHERE status = 'cancelled'),
    (SELECT COALESCE(sum(amount_paid), 0) FROM public.connect_licenses WHERE status = 'active'),
    (SELECT COALESCE(sum(amount_paid), 0) FROM public.connect_licenses)
  WHERE public.is_super_admin();
$$;

GRANT EXECUTE ON FUNCTION public.list_stores_with_connect() TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_connect_for_store(uuid, text, numeric, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suspend_connect_for_store(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_connect_for_store(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.connect_license_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_connect_panel_stats() TO authenticated;
