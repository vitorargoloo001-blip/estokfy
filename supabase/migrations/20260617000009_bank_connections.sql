-- Bank Connections Management

CREATE TABLE IF NOT EXISTS public.bank_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  
  -- Bank Info
  bank_name TEXT NOT NULL,
  bank_code TEXT,
  agency TEXT,
  account_number TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('checking', 'savings', 'other')),
  account_holder TEXT,
  
  -- Connection Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disconnected', 'error')),
  error_message TEXT,
  
  -- OAuth Token (reference to vault)
  oauth_token_ref TEXT,
  oauth_expires_at TIMESTAMPTZ,
  
  -- Metadata
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'partial', 'failed', NULL)),
  total_transactions BIGINT DEFAULT 0,
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Sync History
CREATE TABLE IF NOT EXISTS public.bank_sync_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_connection_id UUID NOT NULL REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  
  sync_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'partial', 'failed')),
  
  transactions_found BIGINT DEFAULT 0,
  transactions_imported BIGINT DEFAULT 0,
  transactions_skipped BIGINT DEFAULT 0,
  
  error_message TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bank_connections_store 
  ON public.bank_connections(store_id);
CREATE INDEX IF NOT EXISTS idx_bank_connections_status 
  ON public.bank_connections(status);
CREATE INDEX IF NOT EXISTS idx_bank_sync_history_connection 
  ON public.bank_sync_history(bank_connection_id);
CREATE INDEX IF NOT EXISTS idx_bank_sync_history_date 
  ON public.bank_sync_history(sync_completed_at DESC);

-- RLS
ALTER TABLE public.bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_sync_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_connections" ON public.bank_connections
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = bank_connections.store_id
        AND p.role IN ('owner', 'admin', 'manager', 'finance')
    )
  );

CREATE POLICY "users_manage_own_connections" ON public.bank_connections
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = bank_connections.store_id
        AND p.role IN ('owner', 'admin', 'manager')
    )
  );

CREATE POLICY "users_view_sync_history" ON public.bank_sync_history
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_connections bc
      JOIN public.profiles p ON p.store_id = bc.store_id
      WHERE p.auth_user_id = auth.uid()
        AND bc.id = bank_sync_history.bank_connection_id
        AND p.role IN ('owner', 'admin', 'manager', 'finance')
    )
  );

-- Functions

-- List connections
CREATE OR REPLACE FUNCTION public.list_bank_connections(p_store_id UUID)
RETURNS TABLE (
  id UUID,
  bank_name TEXT,
  agency TEXT,
  account_number TEXT,
  account_type TEXT,
  status TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  total_transactions BIGINT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
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
$FUNC$;

-- Create connection
CREATE OR REPLACE FUNCTION public.create_bank_connection(
  p_store_id UUID,
  p_bank_name TEXT,
  p_agency TEXT,
  p_account_number TEXT,
  p_account_type TEXT,
  p_account_holder TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FUNC$
DECLARE
  v_user_id UUID;
  v_new_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.store_id = p_store_id
      AND p.role IN ('owner', 'admin', 'manager')
  ) THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Permission denied';
    RETURN;
  END IF;
  
  INSERT INTO public.bank_connections (
    store_id, bank_name, agency, account_number, account_type,
    account_holder, status, created_by
  )
  VALUES (
    p_store_id, p_bank_name, p_agency, p_account_number, p_account_type,
    p_account_holder, 'pending', v_user_id
  )
  RETURNING bank_connections.id INTO v_new_id;
  
  RETURN QUERY SELECT v_new_id, true, 'Connection created successfully';
END;
$FUNC$;

-- Delete connection
CREATE OR REPLACE FUNCTION public.delete_bank_connection(p_connection_id UUID)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FUNC$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  
  IF NOT EXISTS (
    SELECT 1 FROM public.bank_connections bc
    JOIN public.profiles p ON p.store_id = bc.store_id
    WHERE p.id = v_user_id
      AND bc.id = p_connection_id
      AND p.role IN ('owner', 'admin', 'manager')
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied';
    RETURN;
  END IF;
  
  DELETE FROM public.bank_connections WHERE id = p_connection_id;
  
  RETURN QUERY SELECT true, 'Connection deleted successfully';
END;
$FUNC$;

-- Get sync history
CREATE OR REPLACE FUNCTION public.get_sync_history(p_connection_id UUID, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  id UUID,
  sync_started_at TIMESTAMPTZ,
  sync_completed_at TIMESTAMPTZ,
  status TEXT,
  transactions_found BIGINT,
  transactions_imported BIGINT,
  transactions_skipped BIGINT,
  error_message TEXT,
  duration_minutes NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
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
$FUNC$;

-- Update last sync
CREATE OR REPLACE FUNCTION public.update_bank_sync(
  p_connection_id UUID,
  p_status TEXT,
  p_found BIGINT DEFAULT 0,
  p_imported BIGINT DEFAULT 0,
  p_error TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FUNC$
DECLARE
  v_history_id UUID;
BEGIN
  -- Create history record
  INSERT INTO public.bank_sync_history (
    bank_connection_id, status, transactions_found,
    transactions_imported, error_message, sync_completed_at
  )
  VALUES (
    p_connection_id, p_status, p_found, p_imported, p_error, now()
  )
  RETURNING bank_sync_history.id INTO v_history_id;
  
  -- Update connection
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
$FUNC$;
