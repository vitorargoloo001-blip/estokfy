-- Estokfy Connect Setup Progress Tracking

CREATE TABLE IF NOT EXISTS public.connect_setup_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  
  -- Setup completion steps
  module_activated BOOLEAN DEFAULT false,
  module_activated_at TIMESTAMPTZ,
  
  bank_connected BOOLEAN DEFAULT false,
  bank_connected_at TIMESTAMPTZ,
  
  account_selected BOOLEAN DEFAULT false,
  account_selected_at TIMESTAMPTZ,
  
  sync_enabled BOOLEAN DEFAULT false,
  sync_enabled_at TIMESTAMPTZ,
  
  reconciliation_enabled BOOLEAN DEFAULT false,
  reconciliation_enabled_at TIMESTAMPTZ,
  
  audit_enabled BOOLEAN DEFAULT false,
  audit_enabled_at TIMESTAMPTZ,
  
  -- Overall status
  setup_completed BOOLEAN DEFAULT false,
  setup_completed_at TIMESTAMPTZ,
  current_step INTEGER DEFAULT 1,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_setup_store 
  ON public.connect_setup_progress(store_id);

-- RLS
ALTER TABLE public.connect_setup_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_setup" ON public.connect_setup_progress
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = connect_setup_progress.store_id
        AND p.role IN ('owner', 'admin', 'manager')
    )
  );

CREATE POLICY "users_update_own_setup" ON public.connect_setup_progress
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = connect_setup_progress.store_id
        AND p.role IN ('owner', 'admin', 'manager')
    )
  );

-- Function: get_connect_setup_progress()
CREATE OR REPLACE FUNCTION public.get_connect_setup_progress(p_store_id UUID)
RETURNS TABLE (
  id UUID,
  module_activated BOOLEAN,
  bank_connected BOOLEAN,
  account_selected BOOLEAN,
  sync_enabled BOOLEAN,
  reconciliation_enabled BOOLEAN,
  audit_enabled BOOLEAN,
  setup_completed BOOLEAN,
  current_step INTEGER,
  completion_percent INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT
    csp.id,
    csp.module_activated,
    csp.bank_connected,
    csp.account_selected,
    csp.sync_enabled,
    csp.reconciliation_enabled,
    csp.audit_enabled,
    csp.setup_completed,
    csp.current_step,
    CASE
      WHEN csp.setup_completed THEN 100
      ELSE (
        (CASE WHEN csp.module_activated THEN 1 ELSE 0 END) +
        (CASE WHEN csp.bank_connected THEN 1 ELSE 0 END) +
        (CASE WHEN csp.account_selected THEN 1 ELSE 0 END) +
        (CASE WHEN csp.sync_enabled THEN 1 ELSE 0 END) +
        (CASE WHEN csp.reconciliation_enabled THEN 1 ELSE 0 END) +
        (CASE WHEN csp.audit_enabled THEN 1 ELSE 0 END)
      ) * 100 / 6
    END as completion_percent
  FROM public.connect_setup_progress csp
  WHERE csp.store_id = p_store_id;
$FUNC$;

-- Function: update_connect_setup_step()
CREATE OR REPLACE FUNCTION public.update_connect_setup_step(
  p_store_id UUID,
  p_step_name TEXT,
  p_completed BOOLEAN
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  completion_percent INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FUNC$
DECLARE
  v_user_id UUID;
  v_current_step INTEGER;
  v_next_step INTEGER;
  v_all_completed BOOLEAN;
  v_completion_percent INTEGER;
BEGIN
  v_user_id := auth.uid();
  
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.store_id = p_store_id
      AND p.role IN ('owner', 'admin', 'manager')
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied'::TEXT, 0::INTEGER;
    RETURN;
  END IF;
  
  -- Ensure setup record exists
  INSERT INTO public.connect_setup_progress (store_id, updated_by)
  VALUES (p_store_id, v_user_id)
  ON CONFLICT (store_id) DO NOTHING;
  
  -- Update specific step
  UPDATE public.connect_setup_progress
  SET
    module_activated = CASE WHEN p_step_name = 'module_activated' THEN p_completed ELSE module_activated END,
    module_activated_at = CASE WHEN p_step_name = 'module_activated' AND p_completed THEN now() ELSE module_activated_at END,
    bank_connected = CASE WHEN p_step_name = 'bank_connected' THEN p_completed ELSE bank_connected END,
    bank_connected_at = CASE WHEN p_step_name = 'bank_connected' AND p_completed THEN now() ELSE bank_connected_at END,
    account_selected = CASE WHEN p_step_name = 'account_selected' THEN p_completed ELSE account_selected END,
    account_selected_at = CASE WHEN p_step_name = 'account_selected' AND p_completed THEN now() ELSE account_selected_at END,
    sync_enabled = CASE WHEN p_step_name = 'sync_enabled' THEN p_completed ELSE sync_enabled END,
    sync_enabled_at = CASE WHEN p_step_name = 'sync_enabled' AND p_completed THEN now() ELSE sync_enabled_at END,
    reconciliation_enabled = CASE WHEN p_step_name = 'reconciliation_enabled' THEN p_completed ELSE reconciliation_enabled END,
    reconciliation_enabled_at = CASE WHEN p_step_name = 'reconciliation_enabled' AND p_completed THEN now() ELSE reconciliation_enabled_at END,
    audit_enabled = CASE WHEN p_step_name = 'audit_enabled' THEN p_completed ELSE audit_enabled END,
    audit_enabled_at = CASE WHEN p_step_name = 'audit_enabled' AND p_completed THEN now() ELSE audit_enabled_at END,
    updated_at = now(),
    updated_by = v_user_id,
    setup_completed = CASE
      WHEN p_step_name = 'audit_enabled' AND p_completed THEN true
      ELSE setup_completed
    END,
    setup_completed_at = CASE
      WHEN p_step_name = 'audit_enabled' AND p_completed THEN now()
      ELSE setup_completed_at
    END
  WHERE store_id = p_store_id;
  
  -- Calculate completion percent
  SELECT
    (CASE WHEN module_activated THEN 1 ELSE 0 END) +
    (CASE WHEN bank_connected THEN 1 ELSE 0 END) +
    (CASE WHEN account_selected THEN 1 ELSE 0 END) +
    (CASE WHEN sync_enabled THEN 1 ELSE 0 END) +
    (CASE WHEN reconciliation_enabled THEN 1 ELSE 0 END) +
    (CASE WHEN audit_enabled THEN 1 ELSE 0 END)
  INTO v_completion_percent
  FROM public.connect_setup_progress
  WHERE store_id = p_store_id;
  
  v_completion_percent := (v_completion_percent * 100) / 6;
  
  RETURN QUERY SELECT true, 'Step updated successfully'::TEXT, v_completion_percent::INTEGER;
END;
$FUNC$;
