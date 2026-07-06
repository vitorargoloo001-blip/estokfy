-- =====================================================================
-- Feature: importação manual de extrato bancário (OFX/CSV) como
-- alternativa à Pluggy — sem dependência de provedor externo. Reaproveita
-- 100% da engine de conciliação (connect_run_matching) já existente.
--
-- bank_connections.provider já existia ('pluggy' default, sem CHECK) —
-- conexões manuais usam provider = 'manual'. get_bank_connections_with_pluggy
-- é atualizado para expor essa coluna ao frontend.
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_bank_connections_with_pluggy(UUID);

CREATE FUNCTION public.get_bank_connections_with_pluggy(p_store_id UUID)
RETURNS TABLE(
  id               UUID,
  bank_name        TEXT,
  bank_code        TEXT,
  agency           TEXT,
  account_number   TEXT,
  account_type     TEXT,
  status           TEXT,
  last_sync_at     TIMESTAMPTZ,
  last_sync_status TEXT,
  total_transactions BIGINT,
  is_active        BOOLEAN,
  pluggy_item_id   UUID,
  pluggy_external_item_id TEXT,
  pluggy_account_id TEXT,
  pluggy_status    TEXT,
  institution_name TEXT,
  last_synced_at   TIMESTAMPTZ,
  provider         TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bc.id,
    bc.bank_name,
    bc.bank_code,
    bc.agency,
    bc.account_number,
    bc.account_type,
    bc.status,
    bc.last_sync_at,
    bc.last_sync_status,
    bc.total_transactions,
    bc.is_active,
    bc.pluggy_item_id,
    pi.pluggy_item_id   AS pluggy_external_item_id,
    bc.pluggy_account_id,
    pi.status           AS pluggy_status,
    pi.institution_name,
    pi.last_synced_at,
    bc.provider
  FROM public.bank_connections bc
  LEFT JOIN public.pluggy_items pi ON pi.id = bc.pluggy_item_id
  WHERE bc.store_id = p_store_id
    AND bc.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
    )
  ORDER BY bc.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_bank_connections_with_pluggy(UUID) TO authenticated;

-- ── Criar conexão manual (sem Pluggy) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_manual_bank_connection(
  p_store_id UUID,
  p_bank_name TEXT,
  p_account_number TEXT,
  p_account_type TEXT,
  p_agency TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  IF p_bank_name IS NULL OR length(btrim(p_bank_name)) = 0 THEN
    RAISE EXCEPTION 'nome_banco_obrigatorio';
  END IF;
  IF p_account_number IS NULL OR length(btrim(p_account_number)) = 0 THEN
    RAISE EXCEPTION 'numero_conta_obrigatorio';
  END IF;
  IF p_account_type NOT IN ('checking','savings','other') THEN
    RAISE EXCEPTION 'tipo_conta_invalido';
  END IF;

  INSERT INTO public.bank_connections (
    store_id, bank_name, account_number, account_type, agency,
    status, provider, is_active
  ) VALUES (
    p_store_id, btrim(p_bank_name), btrim(p_account_number), p_account_type, p_agency,
    'connected', 'manual', true
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_manual_bank_connection(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ── Importar transações de um extrato (OFX/CSV parseado no frontend) ──
CREATE OR REPLACE FUNCTION public.import_bank_statement(
  p_store_id UUID,
  p_bank_connection_id UUID,
  p_transactions JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn RECORD;
  v_tx JSONB;
  v_ref TEXT;
  v_date DATE;
  v_amount NUMERIC;
  v_type TEXT;
  v_imported INT := 0;
  v_duplicates INT := 0;
  v_skipped INT := 0;
  v_match_result JSONB := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  SELECT * INTO v_conn FROM public.bank_connections
   WHERE id = p_bank_connection_id AND store_id = p_store_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conexao_invalida'; END IF;

  IF p_transactions IS NULL OR jsonb_typeof(p_transactions) <> 'array' THEN
    RAISE EXCEPTION 'transacoes_invalidas';
  END IF;

  FOR v_tx IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    v_ref    := v_tx->>'external_ref';
    v_date   := NULLIF(v_tx->>'date','')::date;
    v_amount := ABS(NULLIF(v_tx->>'amount','')::numeric);
    v_type   := v_tx->>'type';

    IF v_ref IS NULL OR v_date IS NULL OR v_amount IS NULL OR v_amount <= 0
       OR v_type NOT IN ('debit','credit') THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.bank_transactions WHERE bank_reference = v_ref) THEN
      v_duplicates := v_duplicates + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount, transaction_type,
      method, description, bank_name, status, bank_reference, sync_at
    ) VALUES (
      p_store_id, p_bank_connection_id, v_date, v_amount, v_type,
      COALESCE(NULLIF(v_tx->>'method',''), 'other'),
      NULLIF(v_tx->>'description',''), v_conn.bank_name,
      'pending', v_ref, now()
    );
    v_imported := v_imported + 1;
  END LOOP;

  UPDATE public.bank_connections
     SET last_sync_at = now(),
         last_sync_status = 'success',
         total_transactions = COALESCE(total_transactions,0) + v_imported,
         status = 'connected'
   WHERE id = p_bank_connection_id;

  IF v_imported > 0 THEN
    v_match_result := public.connect_run_matching(p_store_id);
  END IF;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'duplicates', v_duplicates,
    'skipped', v_skipped,
    'match_result', v_match_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_bank_statement(UUID, UUID, JSONB) TO authenticated;
