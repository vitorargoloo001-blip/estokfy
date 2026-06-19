-- =====================================================================
-- Sistema de Capabilities — permissões baseadas em capability, não
-- somente em cargo. Permite cargos personalizados no futuro sem
-- alterar código (basta editar role_capabilities ou adicionar linhas
-- em profile_capability_overrides).
--
-- Tabelas:
--   role_capabilities           — mapeamento role → capability (padrão do sistema)
--   profile_capability_overrides— sobrescritas por perfil individual (futuro)
--
-- RPCs:
--   get_my_capabilities(p_store_id)  → jsonb {capability: bool}
--   log_user_action(...)             → registra ação no audit_logs existente
-- =====================================================================

-- 1. Capabilities por cargo (sistema global — sem store_id, compartilhado)
CREATE TABLE IF NOT EXISTS public.role_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  capability text NOT NULL,
  is_granted boolean NOT NULL DEFAULT true,
  UNIQUE (role, capability),
  CONSTRAINT role_cap_role_check CHECK (role IN ('owner','admin','manager','sales','stock','finance','viewer'))
);

-- 2. Sobrescritas por perfil individual (cargos personalizados, futuro)
CREATE TABLE IF NOT EXISTS public.profile_capability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability text NOT NULL,
  is_granted boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_profile_cap_overrides_profile ON public.profile_capability_overrides(profile_id);

-- RLS
ALTER TABLE public.role_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_cap_read" ON public.role_capabilities;
CREATE POLICY "role_cap_read" ON public.role_capabilities FOR SELECT USING (true);

DROP POLICY IF EXISTS "role_cap_write" ON public.role_capabilities;
CREATE POLICY "role_cap_write" ON public.role_capabilities FOR ALL
  USING (public.is_super_admin());

ALTER TABLE public.profile_capability_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pco_read_own" ON public.profile_capability_overrides;
CREATE POLICY "pco_read_own" ON public.profile_capability_overrides FOR SELECT
  USING (
    profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
    OR profile_id IN (
      SELECT p2.id FROM public.profiles p2
      JOIN public.profiles me ON me.store_id = p2.store_id AND me.auth_user_id = auth.uid()
      WHERE me.role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS "pco_manage" ON public.profile_capability_overrides;
CREATE POLICY "pco_manage" ON public.profile_capability_overrides FOR ALL
  USING (
    public.is_super_admin()
    OR profile_id IN (
      SELECT p2.id FROM public.profiles p2
      JOIN public.profiles me ON me.store_id = p2.store_id AND me.auth_user_id = auth.uid()
      WHERE me.role IN ('owner','admin')
    )
  );

-- =====================================================================
-- 3. Seed: capabilities padrão por cargo
--    Capabilities definidas:
--      can_create_sales, can_edit_own_day_sales, can_receive_payments,
--      can_partial_payments, can_manage_customers, can_view_customer_history,
--      can_manage_receivables, can_create_returns, can_create_exchanges,
--      can_standalone_exchange, can_generate_customer_credit,
--      can_credit_against_debt, can_cash_refund, can_view_loyalty,
--      can_use_loyalty, can_generate_loyalty, can_manage_os,
--      can_update_os_status, can_deliver_os, can_manual_stock_adjustment,
--      can_view_cost_price, can_manage_employees, can_manage_products,
--      can_delete_products, can_view_advanced_reports, can_system_settings,
--      can_view_financials, can_manage_connect, can_create_owner_or_admin
-- =====================================================================

INSERT INTO public.role_capabilities (role, capability, is_granted) VALUES
-- ======= owner (acesso completo) =======
('owner','can_create_sales',true),
('owner','can_edit_own_day_sales',true),
('owner','can_receive_payments',true),
('owner','can_partial_payments',true),
('owner','can_manage_customers',true),
('owner','can_view_customer_history',true),
('owner','can_manage_receivables',true),
('owner','can_create_returns',true),
('owner','can_create_exchanges',true),
('owner','can_standalone_exchange',true),
('owner','can_generate_customer_credit',true),
('owner','can_credit_against_debt',true),
('owner','can_cash_refund',true),
('owner','can_view_loyalty',true),
('owner','can_use_loyalty',true),
('owner','can_generate_loyalty',true),
('owner','can_manage_os',true),
('owner','can_update_os_status',true),
('owner','can_deliver_os',true),
('owner','can_manual_stock_adjustment',true),
('owner','can_view_cost_price',true),
('owner','can_manage_employees',true),
('owner','can_manage_products',true),
('owner','can_delete_products',true),
('owner','can_view_advanced_reports',true),
('owner','can_system_settings',true),
('owner','can_view_financials',true),
('owner','can_manage_connect',true),
('owner','can_create_owner_or_admin',true),
-- ======= admin (igual owner menos criar owner) =======
('admin','can_create_sales',true),
('admin','can_edit_own_day_sales',true),
('admin','can_receive_payments',true),
('admin','can_partial_payments',true),
('admin','can_manage_customers',true),
('admin','can_view_customer_history',true),
('admin','can_manage_receivables',true),
('admin','can_create_returns',true),
('admin','can_create_exchanges',true),
('admin','can_standalone_exchange',true),
('admin','can_generate_customer_credit',true),
('admin','can_credit_against_debt',true),
('admin','can_cash_refund',true),
('admin','can_view_loyalty',true),
('admin','can_use_loyalty',true),
('admin','can_generate_loyalty',true),
('admin','can_manage_os',true),
('admin','can_update_os_status',true),
('admin','can_deliver_os',true),
('admin','can_manual_stock_adjustment',true),
('admin','can_view_cost_price',true),
('admin','can_manage_employees',true),
('admin','can_manage_products',true),
('admin','can_delete_products',true),
('admin','can_view_advanced_reports',true),
('admin','can_system_settings',true),
('admin','can_view_financials',true),
('admin','can_manage_connect',true),
('admin','can_create_owner_or_admin',false),
-- ======= manager (operacional + equipe, sem criar owner/admin) =======
('manager','can_create_sales',true),
('manager','can_edit_own_day_sales',true),
('manager','can_receive_payments',true),
('manager','can_partial_payments',true),
('manager','can_manage_customers',true),
('manager','can_view_customer_history',true),
('manager','can_manage_receivables',true),
('manager','can_create_returns',true),
('manager','can_create_exchanges',true),
('manager','can_standalone_exchange',true),
('manager','can_generate_customer_credit',true),
('manager','can_credit_against_debt',true),
('manager','can_cash_refund',true),
('manager','can_view_loyalty',true),
('manager','can_use_loyalty',true),
('manager','can_generate_loyalty',true),
('manager','can_manage_os',true),
('manager','can_update_os_status',true),
('manager','can_deliver_os',true),
('manager','can_manual_stock_adjustment',true),
('manager','can_view_cost_price',true),
('manager','can_manage_employees',true),
('manager','can_manage_products',true),
('manager','can_delete_products',true),
('manager','can_view_advanced_reports',true),
('manager','can_system_settings',false),
('manager','can_view_financials',true),
('manager','can_manage_connect',true),
('manager','can_create_owner_or_admin',false),
-- ======= sales (vendedor) — opera loja inteira, sem admin/estoque/config =======
('sales','can_create_sales',true),
('sales','can_edit_own_day_sales',true),
('sales','can_receive_payments',true),
('sales','can_partial_payments',true),
('sales','can_manage_customers',true),
('sales','can_view_customer_history',true),
('sales','can_manage_receivables',true),
('sales','can_create_returns',true),
('sales','can_create_exchanges',true),
('sales','can_standalone_exchange',true),
('sales','can_generate_customer_credit',true),
('sales','can_credit_against_debt',true),
('sales','can_cash_refund',true),
('sales','can_view_loyalty',true),
('sales','can_use_loyalty',true),
('sales','can_generate_loyalty',true),
('sales','can_manage_os',true),
('sales','can_update_os_status',true),
('sales','can_deliver_os',true),
('sales','can_manual_stock_adjustment',false),
('sales','can_view_cost_price',false),
('sales','can_manage_employees',false),
('sales','can_manage_products',false),
('sales','can_delete_products',false),
('sales','can_view_advanced_reports',false),
('sales','can_system_settings',false),
('sales','can_view_financials',false),
('sales','can_manage_connect',false),
('sales','can_create_owner_or_admin',false),
-- ======= stock (gestão de estoque + OS, sem vendas/financeiro) =======
('stock','can_create_sales',false),
('stock','can_edit_own_day_sales',false),
('stock','can_receive_payments',false),
('stock','can_partial_payments',false),
('stock','can_manage_customers',false),
('stock','can_view_customer_history',false),
('stock','can_manage_receivables',false),
('stock','can_create_returns',false),
('stock','can_create_exchanges',false),
('stock','can_standalone_exchange',false),
('stock','can_generate_customer_credit',false),
('stock','can_credit_against_debt',false),
('stock','can_cash_refund',false),
('stock','can_view_loyalty',false),
('stock','can_use_loyalty',false),
('stock','can_generate_loyalty',false),
('stock','can_manage_os',true),
('stock','can_update_os_status',true),
('stock','can_deliver_os',true),
('stock','can_manual_stock_adjustment',true),
('stock','can_view_cost_price',true),
('stock','can_manage_employees',false),
('stock','can_manage_products',true),
('stock','can_delete_products',false),
('stock','can_view_advanced_reports',false),
('stock','can_system_settings',false),
('stock','can_view_financials',false),
('stock','can_manage_connect',false),
('stock','can_create_owner_or_admin',false),
-- ======= finance (contas a receber/pagar, relatórios, financeiro) =======
('finance','can_create_sales',false),
('finance','can_edit_own_day_sales',false),
('finance','can_receive_payments',true),
('finance','can_partial_payments',true),
('finance','can_manage_customers',true),
('finance','can_view_customer_history',true),
('finance','can_manage_receivables',true),
('finance','can_create_returns',false),
('finance','can_create_exchanges',false),
('finance','can_standalone_exchange',false),
('finance','can_generate_customer_credit',false),
('finance','can_credit_against_debt',true),
('finance','can_cash_refund',false),
('finance','can_view_loyalty',true),
('finance','can_use_loyalty',false),
('finance','can_generate_loyalty',false),
('finance','can_manage_os',false),
('finance','can_update_os_status',false),
('finance','can_deliver_os',false),
('finance','can_manual_stock_adjustment',false),
('finance','can_view_cost_price',false),
('finance','can_manage_employees',false),
('finance','can_manage_products',false),
('finance','can_delete_products',false),
('finance','can_view_advanced_reports',true),
('finance','can_system_settings',false),
('finance','can_view_financials',true),
('finance','can_manage_connect',true),
('finance','can_create_owner_or_admin',false),
-- ======= viewer (visualização mínima) =======
('viewer','can_create_sales',false),
('viewer','can_edit_own_day_sales',false),
('viewer','can_receive_payments',false),
('viewer','can_partial_payments',false),
('viewer','can_manage_customers',false),
('viewer','can_view_customer_history',false),
('viewer','can_manage_receivables',false),
('viewer','can_create_returns',false),
('viewer','can_create_exchanges',false),
('viewer','can_standalone_exchange',false),
('viewer','can_generate_customer_credit',false),
('viewer','can_credit_against_debt',false),
('viewer','can_cash_refund',false),
('viewer','can_view_loyalty',false),
('viewer','can_use_loyalty',false),
('viewer','can_generate_loyalty',false),
('viewer','can_manage_os',false),
('viewer','can_update_os_status',false),
('viewer','can_deliver_os',false),
('viewer','can_manual_stock_adjustment',false),
('viewer','can_view_cost_price',false),
('viewer','can_manage_employees',false),
('viewer','can_manage_products',false),
('viewer','can_delete_products',false),
('viewer','can_view_advanced_reports',false),
('viewer','can_system_settings',false),
('viewer','can_view_financials',false),
('viewer','can_manage_connect',false),
('viewer','can_create_owner_or_admin',false)
ON CONFLICT (role, capability) DO NOTHING;

-- =====================================================================
-- 4. RPC: get_my_capabilities
--    Retorna jsonb {capability: bool} para o usuário autenticado.
--    Mescla role_capabilities (padrão do cargo) com
--    profile_capability_overrides (sobrescritas individuais, prioridade maior).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_my_capabilities(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile_id uuid;
  v_role       text;
  v_caps       jsonb;
BEGIN
  SELECT p.id, p.role
    INTO v_profile_id, v_role
    FROM profiles p
   WHERE p.auth_user_id = auth.uid()
     AND p.store_id     = p_store_id
     AND p.is_active    = true;

  IF v_profile_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Mescla defaults do cargo com sobrescritas individuais
  -- ROW_NUMBER garante que override (priority=1) vence default (priority=0)
  SELECT jsonb_object_agg(capability, is_granted) INTO v_caps
    FROM (
      SELECT capability, is_granted,
             ROW_NUMBER() OVER (PARTITION BY capability ORDER BY override_priority DESC) AS rn
        FROM (
          SELECT rc.capability, rc.is_granted, 0 AS override_priority
            FROM role_capabilities rc
           WHERE rc.role = v_role
          UNION ALL
          SELECT pco.capability, pco.is_granted, 1 AS override_priority
            FROM profile_capability_overrides pco
           WHERE pco.profile_id = v_profile_id
        ) all_caps
    ) ranked
   WHERE rn = 1;

  RETURN COALESCE(v_caps, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_capabilities(uuid) TO authenticated;

-- =====================================================================
-- 5. RPC: log_user_action
--    Helper para o frontend registrar ações no audit_logs existente.
--    Resolve profile_id automaticamente pelo auth.uid().
-- =====================================================================

CREATE OR REPLACE FUNCTION public.log_user_action(
  p_store_id  uuid,
  p_action    text,
  p_entity    text,
  p_entity_id uuid    DEFAULT NULL,
  p_details   jsonb   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile_id uuid;
  v_log_id     uuid;
BEGIN
  SELECT id INTO v_profile_id
    FROM profiles
   WHERE auth_user_id = auth.uid()
     AND store_id     = p_store_id;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'perfil_nao_encontrado';
  END IF;

  INSERT INTO audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_profile_id, p_action, p_entity, p_entity_id, p_details)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_user_action(uuid, text, text, uuid, jsonb) TO authenticated;
