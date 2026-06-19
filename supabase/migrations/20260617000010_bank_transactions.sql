-- Bank Transactions Management

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  bank_connection_id UUID NOT NULL REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  
  -- Transaction Details
  transaction_date DATE NOT NULL,
  transaction_time TIME,
  amount NUMERIC(15,2) NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('debit', 'credit')),
  description TEXT,
  
  -- Bank Info
  bank_name TEXT NOT NULL,
  bank_code TEXT,
  origin_account TEXT,
  destination_account TEXT,
  
  -- Classification
  method TEXT CHECK (method IN ('pix', 'ted', 'doc', 'cheque', 'boleto', 'other')),
  category TEXT,
  
  -- Reconciliation Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled', 'divergent', 'ignored')),
  
  -- Reconciliation Link
  -- FK to reconciliation_matches is added in the reconciliation_matches migration
  -- (both tables reference each other — circular dependency resolved via late ALTER).
  reconciliation_id UUID,
  sale_id UUID REFERENCES public.sales(id),
  
  -- Metadata
  bank_reference TEXT UNIQUE,
  external_id TEXT,
  sync_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bank_transactions_store 
  ON public.bank_transactions(store_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_connection 
  ON public.bank_transactions(bank_connection_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date 
  ON public.bank_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status 
  ON public.bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_amount 
  ON public.bank_transactions(amount);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_reconciliation 
  ON public.bank_transactions(reconciliation_id);

-- RLS
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_transactions" ON public.bank_transactions
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = bank_transactions.store_id
        AND p.role IN ('owner', 'admin', 'manager', 'finance')
    )
  );

-- Functions

-- List transactions with filters
CREATE OR REPLACE FUNCTION public.list_bank_transactions(
  p_store_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_bank_connection_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_min_amount NUMERIC DEFAULT NULL,
  p_max_amount NUMERIC DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  transaction_date DATE,
  transaction_time TIME,
  amount NUMERIC,
  transaction_type TEXT,
  description TEXT,
  bank_name TEXT,
  method TEXT,
  status TEXT,
  origin_account TEXT,
  destination_account TEXT,
  category TEXT,
  reconciled_with TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT
    bt.id,
    bt.transaction_date,
    bt.transaction_time,
    bt.amount,
    bt.transaction_type,
    bt.description,
    bt.bank_name,
    bt.method,
    bt.status,
    bt.origin_account,
    bt.destination_account,
    bt.category,
    COALESCE(s.id::text, 'unmatched'::text),
    bt.created_at
  FROM public.bank_transactions bt
  LEFT JOIN public.sales s ON bt.sale_id = s.id
  WHERE bt.store_id = p_store_id
    AND (p_start_date IS NULL OR bt.transaction_date >= p_start_date)
    AND (p_end_date IS NULL OR bt.transaction_date <= p_end_date)
    AND (p_bank_connection_id IS NULL OR bt.bank_connection_id = p_bank_connection_id)
    AND (p_status IS NULL OR bt.status = p_status)
    AND (p_min_amount IS NULL OR bt.amount >= p_min_amount)
    AND (p_max_amount IS NULL OR bt.amount <= p_max_amount)
  ORDER BY bt.transaction_date DESC
  LIMIT p_limit;
$FUNC$;

-- Get transaction summary
CREATE OR REPLACE FUNCTION public.get_transaction_summary(p_store_id UUID)
RETURNS TABLE (
  total_count BIGINT,
  total_amount NUMERIC,
  pending_count BIGINT,
  pending_amount NUMERIC,
  reconciled_count BIGINT,
  reconciled_amount NUMERIC,
  divergent_count BIGINT,
  divergent_amount NUMERIC,
  ignored_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT
    COUNT(*) as total_count,
    COALESCE(SUM(amount), 0) as total_amount,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
    COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) as pending_amount,
    COUNT(*) FILTER (WHERE status = 'reconciled') as reconciled_count,
    COALESCE(SUM(amount) FILTER (WHERE status = 'reconciled'), 0) as reconciled_amount,
    COUNT(*) FILTER (WHERE status = 'divergent') as divergent_count,
    COALESCE(SUM(amount) FILTER (WHERE status = 'divergent'), 0) as divergent_amount,
    COUNT(*) FILTER (WHERE status = 'ignored') as ignored_count
  FROM public.bank_transactions
  WHERE store_id = p_store_id;
$FUNC$;

-- Update transaction status
CREATE OR REPLACE FUNCTION public.update_transaction_status(
  p_transaction_id UUID,
  p_new_status TEXT
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
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF NOT EXISTS (
    SELECT 1 FROM public.bank_transactions bt
    JOIN public.profiles p ON p.store_id = bt.store_id
    WHERE p.auth_user_id = v_user_id
      AND bt.id = p_transaction_id
      AND p.role IN ('owner', 'admin', 'manager')
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied';
    RETURN;
  END IF;
  
  UPDATE public.bank_transactions
  SET status = p_new_status, updated_at = now()
  WHERE id = p_transaction_id;
  
  RETURN QUERY SELECT true, 'Status updated successfully';
END;
$FUNC$;
