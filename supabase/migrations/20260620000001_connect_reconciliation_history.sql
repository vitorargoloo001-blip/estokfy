-- =====================================================================
-- Connect: Histórico de conciliações + reabrir ignoradas
-- =====================================================================

-- get_reconciliation_history: confirmed + ignored matches com contexto completo
CREATE OR REPLACE FUNCTION public.get_reconciliation_history(
  p_store_id   UUID,
  p_status     TEXT    DEFAULT NULL,
  p_start_date DATE    DEFAULT NULL,
  p_end_date   DATE    DEFAULT NULL,
  p_limit      INTEGER DEFAULT 100,
  p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE (
  id                   UUID,
  bank_transaction_id  UUID,
  transaction_date     DATE,
  transaction_amount   NUMERIC,
  transaction_description TEXT,
  bank_name            TEXT,
  method               TEXT,
  sale_id              UUID,
  sale_date            DATE,
  sale_amount          NUMERIC,
  customer_name        TEXT,
  confidence_score     NUMERIC,
  match_type           TEXT,
  amount_difference    NUMERIC,
  date_difference_days INTEGER,
  match_reason         TEXT,
  match_status         TEXT,
  confirmed_at         TIMESTAMPTZ,
  confirmed_by_email   TEXT,
  updated_at           TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rm.id,
    rm.bank_transaction_id,
    bt.transaction_date,
    bt.amount               AS transaction_amount,
    bt.description          AS transaction_description,
    bt.bank_name,
    bt.method,
    rm.sale_id,
    s.sale_date::date       AS sale_date,
    s.net_total             AS sale_amount,
    COALESCE(c.name, 'Sem cliente') AS customer_name,
    rm.confidence_score,
    rm.match_type,
    rm.amount_difference,
    rm.date_difference_days,
    rm.match_reason,
    rm.status               AS match_status,
    rm.confirmed_at,
    u.email                 AS confirmed_by_email,
    rm.updated_at
  FROM public.reconciliation_matches rm
  JOIN public.bank_transactions bt ON bt.id = rm.bank_transaction_id
  LEFT JOIN public.sales s ON s.id = rm.sale_id
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.profiles pr ON pr.id = rm.confirmed_by
  LEFT JOIN auth.users u ON u.id = pr.auth_user_id
  WHERE rm.store_id = p_store_id
    AND rm.status IN ('confirmed', 'ignored')
    AND (p_status IS NULL OR rm.status = p_status)
    AND (p_start_date IS NULL OR bt.transaction_date >= p_start_date)
    AND (p_end_date IS NULL OR bt.transaction_date <= p_end_date)
    AND EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.auth_user_id = auth.uid()
        AND p2.store_id = p_store_id
        AND p2.role IN ('owner','admin','manager','finance','viewer')
    )
  ORDER BY rm.updated_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.get_reconciliation_history(UUID, TEXT, DATE, DATE, INTEGER, INTEGER) TO authenticated;

-- reopen_reconciliation: reverte ignored → pending para nova revisão
CREATE OR REPLACE FUNCTION public.reopen_reconciliation(p_reconciliation_id UUID)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_store_id       UUID;
  v_transaction_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.bank_transaction_id
  INTO v_store_id, v_transaction_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_reconciliation_id AND rm.status = 'ignored';

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Conciliação não encontrada ou não está ignorada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.reconciliation_matches
  SET status = 'pending', updated_at = now()
  WHERE id = p_reconciliation_id;

  UPDATE public.bank_transactions
  SET status = 'pending', updated_at = now()
  WHERE id = v_transaction_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    'Conciliação reaberta para revisão',
    'reconciliation',
    'reconciliation_match', p_reconciliation_id,
    jsonb_build_object('transaction_id', v_transaction_id),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, 'Conciliação reaberta com sucesso';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_reconciliation(UUID) TO authenticated;
