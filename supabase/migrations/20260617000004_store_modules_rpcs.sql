-- Module Licensing System - RPC Functions
-- Provides secure functions to check and control module access

-- Function: check_connect_enabled()
-- Updated version that checks store_modules table
CREATE OR REPLACE FUNCTION public.check_connect_enabled(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Check if store exists and is active, AND Connect module is active
  SELECT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = p_store_id
      AND s.access_enabled = true
  )
  AND EXISTS (
    SELECT 1 FROM public.store_modules sm
    WHERE sm.store_id = p_store_id
      AND sm.module_key = 'connect'
      AND sm.is_active = true
      AND (sm.deactivation_scheduled_at IS NULL 
           OR sm.deactivation_scheduled_at > now())
  );
$$;

-- Function: has_module()
-- Generic module access check for any module
CREATE OR REPLACE FUNCTION public.has_module(p_store_id uuid, p_module_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_modules sm
    WHERE sm.store_id = p_store_id
      AND sm.module_key = p_module_key
      AND sm.is_active = true
      AND (sm.deactivation_scheduled_at IS NULL 
           OR sm.deactivation_scheduled_at > now())
  );
$$;

-- Function: get_store_modules()
-- Return all modules for a store with their status
CREATE OR REPLACE FUNCTION public.get_store_modules(p_store_id uuid)
RETURNS TABLE (
  module_key TEXT,
  is_active BOOLEAN,
  activated_at TIMESTAMPTZ,
  deactivation_scheduled_at TIMESTAMPTZ,
  deactivation_requested_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    sm.module_key,
    sm.is_active,
    sm.activated_at,
    sm.deactivation_scheduled_at,
    sm.deactivation_requested_at
  FROM public.store_modules sm
  WHERE sm.store_id = p_store_id
  ORDER BY sm.module_key;
$$;

-- Function: toggle_store_module()
-- Activate or deactivate a module for a store
CREATE OR REPLACE FUNCTION public.toggle_store_module(
  p_store_id uuid,
  p_module_key text,
  p_is_active boolean,
  p_deactivation_delay_minutes integer DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  deactivation_scheduled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_profile_id uuid;
  v_scheduled_at timestamptz;
  v_current_active boolean;
BEGIN
  -- SECURITY: only the master super admin (vitorargoloo001@gmail.com via system_admins)
  -- may activate/deactivate modules for ANY store. SECURITY DEFINER bypasses RLS, so
  -- the gate MUST live here.
  IF NOT public.is_super_admin() THEN
    RETURN QUERY SELECT false, 'Apenas o administrador master pode gerenciar módulos'::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- Resolve the acting user's profile id (activated_by references profiles(id), not auth.uid())
  SELECT id INTO v_actor_profile_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  -- Check: Store must exist
  IF NOT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = p_store_id
  ) THEN
    RETURN QUERY SELECT false, 'Store not found'::text, NULL::timestamptz;
    RETURN;
  END IF;
  
  -- Safety: Core module cannot be deactivated
  IF p_module_key = 'core' AND NOT p_is_active THEN
    RETURN QUERY SELECT false, 'Core module cannot be deactivated'::text, NULL::timestamptz;
    RETURN;
  END IF;
  
  -- Get current state
  SELECT sm.is_active INTO v_current_active
  FROM public.store_modules sm
  WHERE sm.store_id = p_store_id AND sm.module_key = p_module_key;
  
  -- Calculate scheduled deactivation time if delay provided and deactivating
  v_scheduled_at := CASE 
    WHEN NOT p_is_active AND p_deactivation_delay_minutes IS NOT NULL
    THEN now() + (p_deactivation_delay_minutes || ' minutes')::interval
    WHEN NOT p_is_active THEN now()  -- Immediate if no delay
    ELSE NULL  -- NULL if activating
  END;
  
  -- Upsert store_modules
  INSERT INTO public.store_modules (
    store_id, module_key, is_active, activated_by, activated_at,
    deactivation_requested_at, deactivation_delay_minutes, deactivation_scheduled_at
  )
  VALUES (
    p_store_id,
    p_module_key,
    p_is_active,
    v_actor_profile_id,
    now(),
    CASE WHEN NOT p_is_active THEN now() ELSE NULL END,
    p_deactivation_delay_minutes,
    v_scheduled_at
  )
  ON CONFLICT (store_id, module_key) DO UPDATE SET
    is_active = EXCLUDED.is_active,
    activated_by = EXCLUDED.activated_by,
    activated_at = EXCLUDED.activated_at,
    deactivation_requested_at = CASE 
      WHEN NOT EXCLUDED.is_active THEN now()
      ELSE NULL
    END,
    deactivation_delay_minutes = EXCLUDED.deactivation_delay_minutes,
    deactivation_scheduled_at = EXCLUDED.deactivation_scheduled_at,
    updated_at = now();
  
  RETURN QUERY SELECT true, 'Module toggled successfully'::text, v_scheduled_at;
END;
$$;

-- Function: list_module_audit_log()
-- Return audit trail for module changes (if audit table created)
CREATE OR REPLACE FUNCTION public.list_module_audit_log(
  p_store_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  module_key TEXT,
  action TEXT,
  admin_email TEXT,
  changed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    'core'::text as module_key,
    'system'::text as action,
    'system@estokfy.com'::text as admin_email,
    now() as changed_at
  LIMIT 0;  -- Placeholder: will integrate with audit table when created
$$;
