-- =====================================================================
-- Connect: Central de Divergências
-- =====================================================================

-- Colunas de classificação em bank_transactions
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS divergence_type TEXT,
  ADD COLUMN IF NOT EXISTS divergence_reason TEXT;

-- CHECK constraint (separado para não falhar se coluna já existia sem constraint)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'bank_transactions_divergence_type_check'
      AND table_name = 'bank_transactions'
  ) THEN
    ALTER TABLE public.bank_transactions
      ADD CONSTRAINT bank_transactions_divergence_type_check
      CHECK (divergence_type IN (
        'amount_different', 'date_different', 'customer_not_found',
        'duplicate_payment', 'receipt_without_sale', 'sale_without_receipt'
      ));
  END IF;
END;
$$;

-- Expandir alert_type de connect_alerts para incluir novos tipos
DO $$
BEGIN
  ALTER TABLE public.connect_alerts DROP CONSTRAINT IF EXISTS connect_alerts_alert_type_check;
  ALTER TABLE public.connect_alerts
    ADD CONSTRAINT connect_alerts_alert_type_check
    CHECK (alert_type IN (
      'divergent_transaction', 'low_reconciliation_rate', 'bank_connection_error',
      'sync_failed', 'pending_too_long', 'demo',
      'duplicate_payment', 'suspicious_receipt'
    ));
END;
$$;

-- Índice para queries de divergências
CREATE INDEX IF NOT EXISTS idx_bank_tx_divergence
  ON public.bank_transactions(store_id, divergence_type)
  WHERE status = 'divergent';

-- =====================================================================
-- RPC: get_divergences_detailed
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_divergences_detailed(
  p_store_id    UUID,
  p_type_filter TEXT    DEFAULT NULL,
  p_date_start  DATE    DEFAULT NULL,
  p_date_end    DATE    DEFAULT NULL,
  p_amount_min  NUMERIC DEFAULT NULL,
  p_amount_max  NUMERIC DEFAULT NULL,
  p_customer    TEXT    DEFAULT NULL,
  p_limit       INTEGER DEFAULT 100,
  p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE (
  id               UUID,
  transaction_date DATE,
  amount           NUMERIC,
  description      TEXT,
  method           TEXT,
  bank_name        TEXT,
  divergence_type  TEXT,
  divergence_reason TEXT,
  status           TEXT,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bt.id,
    bt.transaction_date,
    bt.amount,
    bt.description,
    bt.method,
    bt.bank_name,
    bt.divergence_type,
    bt.divergence_reason,
    bt.status,
    bt.created_at
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND bt.status = 'divergent'
    AND (p_type_filter IS NULL OR bt.divergence_type = p_type_filter)
    AND (p_date_start  IS NULL OR bt.transaction_date >= p_date_start)
    AND (p_date_end    IS NULL OR bt.transaction_date <= p_date_end)
    AND (p_amount_min  IS NULL OR bt.amount >= p_amount_min)
    AND (p_amount_max  IS NULL OR bt.amount <= p_amount_max)
    AND (p_customer    IS NULL OR bt.description ILIKE '%' || p_customer || '%')
    AND EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.auth_user_id = auth.uid()
        AND p2.store_id = p_store_id
        AND p2.role IN ('owner','admin','manager','finance','viewer')
    )
  ORDER BY bt.transaction_date DESC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.get_divergences_detailed(UUID, TEXT, DATE, DATE, NUMERIC, NUMERIC, TEXT, INTEGER, INTEGER) TO authenticated;

-- =====================================================================
-- RPC: classify_divergence — classifica o tipo da divergência
-- =====================================================================
CREATE OR REPLACE FUNCTION public.classify_divergence(
  p_tx_id  UUID,
  p_type   TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
  v_old_type TEXT;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT bt.store_id, bt.divergence_type
  INTO v_store_id, v_old_type
  FROM public.bank_transactions bt WHERE bt.id = p_tx_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Transação não encontrada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id
      AND p.store_id = v_store_id AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.bank_transactions
  SET divergence_type   = p_type,
      divergence_reason = p_reason,
      updated_at        = now()
  WHERE id = p_tx_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    'Divergência classificada: ' || p_type,
    'update',
    'bank_transaction', p_tx_id,
    jsonb_build_object(
      'before', jsonb_build_object('divergence_type', v_old_type),
      'after',  jsonb_build_object('divergence_type', p_type, 'divergence_reason', p_reason)
    ),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, 'Divergência classificada com sucesso';
END;
$$;

GRANT EXECUTE ON FUNCTION public.classify_divergence(UUID, TEXT, TEXT) TO authenticated;

-- =====================================================================
-- RPC: resolve_divergence_link — vincula a uma venda e marca reconciliada
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolve_divergence_link(
  p_tx_id   UUID,
  p_sale_id UUID
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
  v_match_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT bt.store_id INTO v_store_id
  FROM public.bank_transactions bt WHERE bt.id = p_tx_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Transação não encontrada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id
      AND p.store_id = v_store_id AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  -- Upsert: atualiza match existente ou cria novo
  SELECT id INTO v_match_id FROM public.reconciliation_matches
  WHERE bank_transaction_id = p_tx_id LIMIT 1;

  IF v_match_id IS NULL THEN
    INSERT INTO public.reconciliation_matches (
      store_id, bank_transaction_id, sale_id,
      match_type, confidence_score, status,
      confirmed_by, confirmed_at, match_reason
    ) VALUES (
      v_store_id, p_tx_id, p_sale_id,
      'manual', 100, 'confirmed',
      v_user_id, now(),
      'Vinculado manualmente via Central de Divergências'
    ) RETURNING id INTO v_match_id;
  ELSE
    UPDATE public.reconciliation_matches
    SET sale_id          = p_sale_id,
        status           = 'confirmed',
        match_type       = 'manual',
        confidence_score = 100,
        confirmed_by     = v_user_id,
        confirmed_at     = now(),
        match_reason     = 'Vinculado manualmente via Central de Divergências',
        updated_at       = now()
    WHERE id = v_match_id;
  END IF;

  -- Atualizar status da transação
  UPDATE public.bank_transactions
  SET status           = 'reconciled',
      divergence_type  = NULL,
      divergence_reason = NULL,
      updated_at       = now()
  WHERE id = p_tx_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    'Divergência resolvida por vinculação manual',
    'reconciliation',
    'bank_transaction', p_tx_id,
    jsonb_build_object(
      'before', jsonb_build_object('status', 'divergent'),
      'after',  jsonb_build_object('status', 'reconciled', 'sale_id', p_sale_id),
      'match_id', v_match_id
    ),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, 'Divergência resolvida com sucesso';
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_divergence_link(UUID, UUID) TO authenticated;

-- =====================================================================
-- RPC: ignore_divergence — ignora a transação divergente
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ignore_divergence(
  p_tx_id  UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT bt.store_id INTO v_store_id
  FROM public.bank_transactions bt WHERE bt.id = p_tx_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Transação não encontrada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id
      AND p.store_id = v_store_id AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.bank_transactions
  SET status            = 'ignored',
      divergence_reason = COALESCE(p_reason, divergence_reason),
      updated_at        = now()
  WHERE id = p_tx_id;

  -- Também atualiza qualquer match pendente
  UPDATE public.reconciliation_matches
  SET status     = 'ignored',
      updated_at = now()
  WHERE bank_transaction_id = p_tx_id
    AND status IN ('pending', 'divergent');

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    'Divergência ignorada',
    'reconciliation',
    'bank_transaction', p_tx_id,
    jsonb_build_object(
      'before',  jsonb_build_object('status', 'divergent'),
      'after',   jsonb_build_object('status', 'ignored'),
      'reason',  p_reason
    ),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, 'Divergência ignorada com sucesso';
END;
$$;

GRANT EXECUTE ON FUNCTION public.ignore_divergence(UUID, TEXT) TO authenticated;

-- =====================================================================
-- Trigger: auto-classificar divergência como 'receipt_without_sale'
-- quando não há classificação definida
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trg_auto_classify_divergence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'divergent' AND NEW.divergence_type IS NULL THEN
    NEW.divergence_type := 'receipt_without_sale';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_classify_divergence ON public.bank_transactions;
CREATE TRIGGER trg_auto_classify_divergence
  BEFORE INSERT OR UPDATE OF status
  ON public.bank_transactions
  FOR EACH ROW
  WHEN (NEW.status = 'divergent' AND NEW.divergence_type IS NULL)
  EXECUTE FUNCTION public.trg_auto_classify_divergence();
