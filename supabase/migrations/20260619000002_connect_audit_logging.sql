-- =====================================================================
-- Connect: Adiciona audit logging às funções de reconciliação
-- =====================================================================

-- =====================================================================
-- confirm_reconciliation — com audit log
-- =====================================================================
CREATE OR REPLACE FUNCTION public.confirm_reconciliation(
  p_reconciliation_id UUID,
  p_sale_id           UUID DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id       UUID;
  v_store_id      UUID;
  v_transaction_id UUID;
  v_tx_amount     NUMERIC;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

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
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied';
    RETURN;
  END IF;

  SELECT bt.amount INTO v_tx_amount
  FROM public.bank_transactions bt WHERE bt.id = v_transaction_id;

  UPDATE public.reconciliation_matches
  SET
    status       = 'confirmed',
    confirmed_at = now(),
    confirmed_by = v_user_id,
    sale_id      = COALESCE(p_sale_id, sale_id),
    updated_at   = now()
  WHERE id = p_reconciliation_id;

  UPDATE public.bank_transactions
  SET
    status     = 'reconciled',
    sale_id    = COALESCE(p_sale_id, sale_id),
    updated_at = now()
  WHERE id = v_transaction_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    CASE WHEN p_sale_id IS NOT NULL THEN 'Conciliação manual confirmada' ELSE 'Conciliação automática confirmada' END,
    'reconciliation',
    'reconciliation_match', p_reconciliation_id,
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'sale_id', p_sale_id,
      'amount', v_tx_amount,
      'manual', p_sale_id IS NOT NULL
    ),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, 'Reconciliation confirmed successfully';
END;
$$;

-- =====================================================================
-- ignore_reconciliation — com audit log
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ignore_reconciliation(p_reconciliation_id UUID)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        UUID;
  v_store_id       UUID;
  v_transaction_id UUID;
  v_tx_amount      NUMERIC;
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
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied';
    RETURN;
  END IF;

  SELECT bt.amount INTO v_tx_amount
  FROM public.bank_transactions bt WHERE bt.id = v_transaction_id;

  UPDATE public.reconciliation_matches
  SET status = 'ignored', updated_at = now()
  WHERE id = p_reconciliation_id;

  UPDATE public.bank_transactions
  SET status = 'ignored', updated_at = now()
  WHERE id = v_transaction_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    'Transação ignorada na conciliação',
    'reconciliation',
    'reconciliation_match', p_reconciliation_id,
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'amount', v_tx_amount
    ),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, 'Reconciliation ignored';
END;
$$;

-- =====================================================================
-- bulk_reconcile — com audit log
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bulk_reconcile(
  p_reconciliation_ids UUID[],
  p_action             TEXT
)
RETURNS TABLE(success boolean, message text, processed_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
  v_count    INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.reconciliation_matches rm
    JOIN public.profiles p ON p.store_id = rm.store_id
    WHERE p.id = v_user_id
      AND rm.id = ANY(p_reconciliation_ids)
      AND p.role IN ('owner','admin','manager','finance')
    GROUP BY rm.store_id
    HAVING COUNT(DISTINCT rm.store_id) = 1
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied'::TEXT, 0::INTEGER;
    RETURN;
  END IF;

  SELECT rm.store_id INTO v_store_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = ANY(p_reconciliation_ids) LIMIT 1;

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

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    'Conciliação em lote: ' || p_action || ' (' || v_count || ' registros)',
    'reconciliation',
    'bulk_reconciliation', NULL,
    jsonb_build_object(
      'action', p_action,
      'count', v_count,
      'ids', to_jsonb(p_reconciliation_ids)
    ),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, (p_action || ' successful')::TEXT, v_count::INTEGER;
END;
$$;
