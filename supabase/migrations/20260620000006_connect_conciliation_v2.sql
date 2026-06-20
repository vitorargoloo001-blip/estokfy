-- =====================================================================
-- Connect: Conciliação V2 — notes, undo, search estendida
-- =====================================================================

-- Coluna notes em reconciliation_matches
ALTER TABLE public.reconciliation_matches
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- =====================================================================
-- RPC: add_reconciliation_note
-- =====================================================================
CREATE OR REPLACE FUNCTION public.add_reconciliation_note(
  p_match_id UUID,
  p_note     TEXT
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
  v_old_note TEXT;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.notes
  INTO v_store_id, v_old_note
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_match_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Conciliação não encontrada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.reconciliation_matches
  SET notes = p_note, updated_at = now()
  WHERE id = p_match_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    'Observação adicionada à conciliação',
    'update',
    'reconciliation_match', p_match_id,
    jsonb_build_object(
      'before', jsonb_build_object('notes', v_old_note),
      'after',  jsonb_build_object('notes', p_note)
    ),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, 'Observação salva com sucesso';
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_reconciliation_note(UUID, TEXT) TO authenticated;

-- =====================================================================
-- RPC: undo_reconciliation — reverte confirmed → pending (com before/after)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.undo_reconciliation(p_match_id UUID)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_store_id   UUID;
  v_tx_id      UUID;
  v_old_status TEXT;
  v_sale_id    UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.bank_transaction_id, rm.status, rm.sale_id
  INTO v_store_id, v_tx_id, v_old_status, v_sale_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_match_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Conciliação não encontrada';
    RETURN;
  END IF;

  IF v_old_status != 'confirmed' THEN
    RETURN QUERY SELECT false, 'Somente conciliações confirmadas podem ser desfeitas';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.reconciliation_matches
  SET status       = 'pending',
      confirmed_at = NULL,
      confirmed_by = NULL,
      updated_at   = now()
  WHERE id = p_match_id;

  UPDATE public.bank_transactions
  SET status = 'pending', updated_at = now()
  WHERE id = v_tx_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details, created_at_date
  ) VALUES (
    v_store_id, auth.uid(),
    'Conciliação desfeita (revertida para pendente)',
    'reconciliation',
    'reconciliation_match', p_match_id,
    jsonb_build_object(
      'before', jsonb_build_object('status', 'confirmed', 'sale_id', v_sale_id),
      'after',  jsonb_build_object('status', 'pending'),
      'transaction_id', v_tx_id
    ),
    CURRENT_DATE
  );

  RETURN QUERY SELECT true, 'Conciliação desfeita com sucesso';
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_reconciliation(UUID) TO authenticated;

-- =====================================================================
-- RPC: search_sales_for_match_v2 — busca estendida + compatibility_score
-- =====================================================================
CREATE OR REPLACE FUNCTION public.search_sales_for_match_v2(
  p_store_id UUID,
  p_amount   NUMERIC DEFAULT NULL,
  p_date     DATE    DEFAULT NULL,
  p_name     TEXT    DEFAULT NULL,
  p_phone    TEXT    DEFAULT NULL,
  p_product  TEXT    DEFAULT NULL,
  p_obs      TEXT    DEFAULT NULL,
  p_limit    INTEGER DEFAULT 20
)
RETURNS TABLE (
  id                  UUID,
  sale_number         TEXT,
  sale_date           DATE,
  net_total           NUMERIC,
  customer_name       TEXT,
  customer_phone      TEXT,
  payment_status      TEXT,
  amount_diff         NUMERIC,
  compatibility_score INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.id::text                                    AS sale_number,
    s.sale_date::date                             AS sale_date,
    s.net_total,
    COALESCE(c.name, 'Cliente não identificado') AS customer_name,
    COALESCE(c.phone, '')                         AS customer_phone,
    s.payment_status,
    CASE WHEN p_amount IS NOT NULL
         THEN ABS(s.net_total - p_amount)
         ELSE NULL END                            AS amount_diff,
    -- score 0-100: penaliza desvio de valor e data, bonifica match de phone/nome
    GREATEST(0, LEAST(100,
      100
      - CASE WHEN p_amount IS NOT NULL AND s.net_total > 0
          THEN LEAST(50, (ABS(s.net_total - p_amount) / GREATEST(s.net_total, 0.01) * 100)::int)
          ELSE 0 END
      - CASE WHEN p_date IS NOT NULL
          THEN LEAST(30, ABS(s.sale_date::date - p_date) * 3)
          ELSE 0 END
      + CASE WHEN p_phone IS NOT NULL AND c.phone IS NOT NULL
               AND c.phone ILIKE '%' || p_phone || '%' THEN 15 ELSE 0 END
      + CASE WHEN p_name IS NOT NULL AND c.name IS NOT NULL
               AND c.name ILIKE '%' || p_name || '%' THEN 10 ELSE 0 END
    ))::INTEGER                                   AS compatibility_score
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  WHERE s.store_id = p_store_id
    AND s.payment_status NOT IN ('cancelled')
    -- filtros opcionais
    AND (p_amount IS NULL OR ABS(s.net_total - p_amount) <= 500)
    AND (p_date IS NULL OR ABS(s.sale_date::date - p_date) <= 30)
    AND (p_name IS NULL
         OR c.name  ILIKE '%' || p_name || '%'
         OR s.notes ILIKE '%' || p_name || '%')
    AND (p_phone IS NULL OR c.phone ILIKE '%' || p_phone || '%')
    AND (p_obs IS NULL OR s.notes ILIKE '%' || p_obs || '%')
    AND (p_product IS NULL OR EXISTS (
      SELECT 1 FROM public.sale_items si
      JOIN public.products pr ON pr.id = si.product_id
      WHERE si.sale_id = s.id
        AND pr.name ILIKE '%' || p_product || '%'
    ))
    AND EXISTS (
      SELECT 1 FROM public.profiles p2
      WHERE p2.auth_user_id = auth.uid()
        AND p2.store_id = p_store_id
        AND p2.role IN ('owner','admin','manager','finance','viewer')
    )
  ORDER BY
    compatibility_score DESC,
    ABS(s.net_total - COALESCE(p_amount, s.net_total)) ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_sales_for_match_v2(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
