-- Module Audit Log Table
-- Tracks all module activation/deactivation changes

CREATE TABLE IF NOT EXISTS public.module_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES public.profiles(id),
  module_key TEXT NOT NULL CHECK (module_key IN ('core', 'connect', 'os', 'loyalty', 'pixel', 'analytics', 'mobile')),
  action TEXT NOT NULL CHECK (action IN ('activate', 'deactivate', 'expire', 'extend')),
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_module_audit_store 
  ON public.module_audit_logs(store_id);
  
CREATE INDEX IF NOT EXISTS idx_module_audit_module 
  ON public.module_audit_logs(module_key);
  
CREATE INDEX IF NOT EXISTS idx_module_audit_date 
  ON public.module_audit_logs(created_at DESC);

-- RLS
ALTER TABLE public.module_audit_logs ENABLE ROW LEVEL SECURITY;

-- Super admin full access
CREATE POLICY "audit_super_admin_access" ON public.module_audit_logs
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

-- Regular users cannot access
CREATE POLICY "audit_no_regular_access" ON public.module_audit_logs
  AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (false);

-- Trigger to log module changes
CREATE OR REPLACE FUNCTION public.log_module_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active != OLD.is_active THEN
    INSERT INTO public.module_audit_logs (
      store_id, admin_user_id, module_key, action,
      old_value, new_value, reason
    ) VALUES (
      NEW.store_id,
      NEW.activated_by,
      NEW.module_key,
      CASE WHEN NEW.is_active THEN 'activate' ELSE 'deactivate' END,
      jsonb_build_object('is_active', OLD.is_active, 'activated_at', OLD.activated_at),
      jsonb_build_object('is_active', NEW.is_active, 'activated_at', NEW.activated_at),
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to store_modules
DROP TRIGGER IF EXISTS trigger_log_module_change ON public.store_modules;
CREATE TRIGGER trigger_log_module_change
  AFTER UPDATE ON public.store_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.log_module_change();

-- Function to list audit logs
CREATE OR REPLACE FUNCTION public.list_module_audit(
  p_store_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  store_name TEXT,
  module_key TEXT,
  action TEXT,
  admin_name TEXT,
  created_at TIMESTAMPTZ,
  reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
