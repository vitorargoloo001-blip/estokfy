-- Reconciliation Matching System

CREATE TABLE IF NOT EXISTS public.reconciliation_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  bank_transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  
  -- Match Quality
  match_type TEXT NOT NULL CHECK (match_type IN ('deterministic', 'heuristic', 'fuzzy', 'manual')),
  confidence_score NUMERIC(5,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  
  -- Match Details
  amount_difference NUMERIC(15,2),
  date_difference_days INTEGER,
  match_reason TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ignored', 'disputed')),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.profiles(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reconciliation_store 
  ON public.reconciliation_matches(store_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_transaction 
  ON public.reconciliation_matches(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status 
  ON public.reconciliation_matches(status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_confidence 
  ON public.reconciliation_matches(confidence_score DESC);

-- RLS
ALTER TABLE public.reconciliation_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_reconciliation" ON public.reconciliation_matches
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = reconciliation_matches.store_id
        AND p.role IN ('owner', 'admin', 'manager', 'finance')
    )
  );

CREATE POLICY "users_manage_own_reconciliation" ON public.reconciliation_matches
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = reconciliation_matches.store_id
        AND p.role IN ('owner', 'admin', 'manager')
    )
  );

-- Functions

-- Get pending reconciliations
CREATE OR REPLACE FUNCTION public.get_pending_reconciliations(p_store_id UUID)
RETURNS TABLE (
  id UUID,
  bank_transaction_id UUID,
  transaction_date DATE,
  transaction_amount NUMERIC,
  transaction_description TEXT,
  bank_name TEXT,
  suggested_sale_id UUID,
  sale_number TEXT,
  sale_amount NUMERIC,
  sale_date DATE,
  customer_name TEXT,
  confidence_score NUMERIC,
  match_type TEXT,
  amount_difference NUMERIC,
  date_difference_days INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT
    rm.id,
    bt.id,
    bt.transaction_date,
    bt.amount,
    bt.description,
    bt.bank_name,
    s.id,
    s.id::text,
    s.net_total,
    s.sale_date::date,
    c.name,
    rm.confidence_score,
    rm.match_type,
    rm.amount_difference,
    rm.date_difference_days
  FROM public.reconciliation_matches rm
  JOIN public.bank_transactions bt ON rm.bank_transaction_id = bt.id
  LEFT JOIN public.sales s ON rm.sale_id = s.id
  LEFT JOIN public.customers c ON s.customer_id = c.id
  WHERE rm.store_id = p_store_id
    AND rm.status = 'pending'
  ORDER BY rm.confidence_score DESC, rm.created_at DESC
  LIMIT 100;
$FUNC$;

-- Confirm reconciliation
CREATE OR REPLACE FUNCTION public.confirm_reconciliation(
  p_reconciliation_id UUID,
  p_sale_id UUID DEFAULT NULL
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
  v_store_id UUID;
  v_transaction_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  
  -- Validate user
  SELECT rm.store_id, rm.bank_transaction_id
  INTO v_store_id, v_transaction_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_reconciliation_id;
  
  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Reconciliation not found';
    RETURN;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.store_id = v_store_id
      AND p.role IN ('owner', 'admin', 'manager')
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied';
    RETURN;
  END IF;
  
  -- Update reconciliation
  UPDATE public.reconciliation_matches
  SET
    status = 'confirmed',
    confirmed_at = now(),
    confirmed_by = v_user_id,
    sale_id = COALESCE(p_sale_id, sale_id),
    updated_at = now()
  WHERE id = p_reconciliation_id;
  
  -- Update bank transaction status
  UPDATE public.bank_transactions
  SET
    status = 'reconciled',
    sale_id = COALESCE(p_sale_id, sale_id),
    updated_at = now()
  WHERE id = v_transaction_id;
  
  RETURN QUERY SELECT true, 'Reconciliation confirmed successfully';
END;
$FUNC$;

-- Ignore reconciliation
CREATE OR REPLACE FUNCTION public.ignore_reconciliation(p_reconciliation_id UUID)
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
  v_store_id UUID;
  v_transaction_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  
  SELECT rm.store_id, rm.bank_transaction_id
  INTO v_store_id, v_transaction_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_reconciliation_id;
  
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.store_id = v_store_id
      AND p.role IN ('owner', 'admin', 'manager')
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied';
    RETURN;
  END IF;
  
  UPDATE public.reconciliation_matches
  SET status = 'ignored', updated_at = now()
  WHERE id = p_reconciliation_id;
  
  UPDATE public.bank_transactions
  SET status = 'ignored', updated_at = now()
  WHERE id = v_transaction_id;
  
  RETURN QUERY SELECT true, 'Reconciliation ignored';
END;
$FUNC$;

-- Bulk reconcile
CREATE OR REPLACE FUNCTION public.bulk_reconcile(
  p_reconciliation_ids UUID[],
  p_action TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  processed_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FUNC$
DECLARE
  v_user_id UUID;
  v_count INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  
  -- Validate all belong to user's store
  IF NOT EXISTS (
    SELECT 1 FROM public.reconciliation_matches rm
    JOIN public.profiles p ON p.store_id = rm.store_id
    WHERE p.id = v_user_id
      AND rm.id = ANY(p_reconciliation_ids)
      AND p.role IN ('owner', 'admin', 'manager')
    GROUP BY rm.store_id
    HAVING COUNT(DISTINCT rm.store_id) = 1
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied'::TEXT, 0::INTEGER;
    RETURN;
  END IF;
  
  IF p_action = 'confirm' THEN
    UPDATE public.reconciliation_matches
    SET status = 'confirmed', confirmed_at = now(), confirmed_by = v_user_id, updated_at = now()
    WHERE id = ANY(p_reconciliation_ids) AND status = 'pending';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    UPDATE public.bank_transactions
    SET status = 'reconciled', updated_at = now()
    WHERE id IN (
      SELECT bank_transaction_id FROM public.reconciliation_matches
      WHERE id = ANY(p_reconciliation_ids)
    );
  ELSIF p_action = 'ignore' THEN
    UPDATE public.reconciliation_matches
    SET status = 'ignored', updated_at = now()
    WHERE id = ANY(p_reconciliation_ids) AND status = 'pending';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    UPDATE public.bank_transactions
    SET status = 'ignored', updated_at = now()
    WHERE id IN (
      SELECT bank_transaction_id FROM public.reconciliation_matches
      WHERE id = ANY(p_reconciliation_ids)
    );
  ELSE
    RETURN QUERY SELECT false, 'Invalid action'::TEXT, 0::INTEGER;
    RETURN;
  END IF;
  
  RETURN QUERY SELECT true, (p_action || ' successful')::TEXT, v_count::INTEGER;
END;
$FUNC$;

-- Cross-table FK added after both tables exist (resolves circular dependency with bank_transactions)
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_reconciliation_id_fkey
  FOREIGN KEY (reconciliation_id) REFERENCES public.reconciliation_matches(id) ON DELETE SET NULL;
