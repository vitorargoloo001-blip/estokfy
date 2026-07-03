-- =====================================================================
-- Permissões críticas — créditos, trocas e devoluções (schema)
--
-- Restringe editar/cancelar crédito de cliente, devolução e troca a
-- owner/admin (e manager, se a loja habilitar via store_settings
-- categoria 'security' → manager_can_manage_sensitive_ops). Vendedor
-- continua podendo criar normalmente. Nada é apagado fisicamente — tudo
-- vira status='cancelled' com autoria + motivo, e fica versionado em
-- return_exchange_versions.
-- =====================================================================

-- 1) loyalty_credits: cancelamento com autoria (cancelled_at já existia)
ALTER TABLE public.loyalty_credits
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 2) returns: status 'cancelled' + autoria
ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_status_check;
ALTER TABLE public.returns
  ADD CONSTRAINT returns_status_check
  CHECK (status IN ('requested','approved','received','rejected','closed','cancelled'));
ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 3) exchanges: não tinha nenhuma coluna de status até agora
ALTER TABLE public.exchanges
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 4) payments: rastrear o pagamento de "abatimento em dívida" criado por
--    process_return_with_credit, pra permitir reverter/editar depois sem
--    depender de casar por texto do campo note.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES public.returns(id);

-- 5) Histórico de versões (edição/cancelamento) de devoluções e trocas
CREATE TABLE IF NOT EXISTS public.return_exchange_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (operation_type IN ('return','exchange')),
  operation_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('edited','cancelled')),
  actor_profile_id uuid REFERENCES public.profiles(id),
  actor_user_id uuid,
  reason text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  impacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rev_store ON public.return_exchange_versions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rev_operation ON public.return_exchange_versions(operation_type, operation_id);

ALTER TABLE public.return_exchange_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rev_select" ON public.return_exchange_versions;
CREATE POLICY "rev_select" ON public.return_exchange_versions FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());
-- Sem policy de INSERT/UPDATE/DELETE para authenticated: só as RPCs
-- SECURITY DEFINER (que já validam permissão) escrevem nesta tabela.

-- 6) Helper de permissão — usado por todas as RPCs de editar/cancelar
--    crédito, devolução e troca.
CREATE OR REPLACE FUNCTION public.can_manage_sensitive_operations(p_store_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
  v_manager_allowed boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles
   WHERE auth_user_id = auth.uid() AND store_id = p_store_id AND is_active = true
   LIMIT 1;

  IF v_role IN ('owner','admin') THEN
    RETURN true;
  END IF;

  IF v_role = 'manager' THEN
    SELECT COALESCE((settings->>'manager_can_manage_sensitive_ops')::boolean, false)
      INTO v_manager_allowed
      FROM public.store_settings
     WHERE store_id = p_store_id AND category = 'security';
    RETURN COALESCE(v_manager_allowed, false);
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_sensitive_operations(uuid) TO authenticated;
