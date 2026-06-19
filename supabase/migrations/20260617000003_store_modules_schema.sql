-- Store Modules Licensing System (Phase 1)
-- Creates table structure for module activation/deactivation per store

CREATE TABLE IF NOT EXISTS public.store_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL CHECK (module_key IN ('core', 'connect', 'os', 'loyalty', 'pixel', 'analytics', 'mobile')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Activation metadata
  activated_by UUID REFERENCES public.profiles(id),
  activated_at TIMESTAMPTZ,
  
  -- Deactivation metadata
  deactivation_requested_at TIMESTAMPTZ,
  deactivation_delay_minutes INTEGER,
  deactivation_scheduled_at TIMESTAMPTZ,
  
  -- Last RPC validation timestamp
  last_validated_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- CRITICAL: Core module can NEVER be deactivated
  CHECK (NOT (module_key = 'core' AND is_active = false)),
  
  -- One entry per store/module combination
  UNIQUE (store_id, module_key)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_store_modules_store_active 
  ON public.store_modules(store_id, is_active);
  
CREATE INDEX IF NOT EXISTS idx_store_modules_deactivation_scheduled 
  ON public.store_modules(deactivation_scheduled_at) 
  WHERE deactivation_requested_at IS NOT NULL;

-- Generic updated_at trigger function (not present in this database; created here, idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Updated at trigger
CREATE OR REPLACE TRIGGER trigger_store_modules_updated_at
  BEFORE UPDATE ON public.store_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Row Level Security (RLS)
ALTER TABLE public.store_modules ENABLE ROW LEVEL SECURITY;

-- Policy: Super admin (service role) can do everything
CREATE POLICY "super_admin_full_access" ON public.store_modules
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

-- Policy: Authenticated users can SELECT own store modules only
CREATE POLICY "select_own_store_modules" ON public.store_modules
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = store_modules.store_id
    )
  );

-- Policy: No UPDATE/DELETE for regular users
CREATE POLICY "no_update_for_regular_users" ON public.store_modules
  AS RESTRICTIVE FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "no_delete_for_regular_users" ON public.store_modules
  AS RESTRICTIVE FOR DELETE
  TO authenticated
  USING (false);

-- Token tracking table for OAuth connections
CREATE TABLE IF NOT EXISTS public.connect_oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  connection_id UUID,  -- Reference to bank connection (not yet created)
  token_ref TEXT NOT NULL,  -- Reference to secret in Vault
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (store_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_connect_oauth_tokens_revoked 
  ON public.connect_oauth_tokens(revoked_at) 
  WHERE revoked_at IS NULL;

-- RLS for token table
ALTER TABLE public.connect_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_token_access" ON public.connect_oauth_tokens
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true);

-- Initialize Core module for all existing stores
INSERT INTO public.store_modules (store_id, module_key, is_active, activated_at)
SELECT id, 'core', true, now()
FROM public.stores
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_modules sm
  WHERE sm.store_id = stores.id AND sm.module_key = 'core'
);
