-- =====================================================================
-- Connect Block 4 — Pluggy V2: schema + service_role RPCs
-- Ativa integração bancária real via Pluggy
-- =====================================================================

-- ── 1. Enriquecer pluggy_items ────────────────────────────────────────
ALTER TABLE public.pluggy_items
  ADD COLUMN IF NOT EXISTS last_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounts_json   JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS webhook_url     TEXT;

-- ── 2. Enriquecer bank_connections com referência Pluggy ──────────────
ALTER TABLE public.bank_connections
  ADD COLUMN IF NOT EXISTS pluggy_item_id  UUID REFERENCES public.pluggy_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pluggy_account_id TEXT; -- Pluggy account ID externo

CREATE INDEX IF NOT EXISTS idx_bank_connections_pluggy_item
  ON public.bank_connections(pluggy_item_id) WHERE pluggy_item_id IS NOT NULL;

-- ── 3. RPC: register_pluggy_item_auth ─────────────────────────────────
-- Chamado pelo frontend após callback do widget Pluggy.
-- Cria/atualiza pluggy_items + bank_connections.
CREATE OR REPLACE FUNCTION public.register_pluggy_item_auth(
  p_store_id          UUID,
  p_pluggy_item_id    TEXT,
  p_institution_name  TEXT,
  p_connector_id      INTEGER DEFAULT NULL,
  p_connector_name    TEXT    DEFAULT NULL,
  p_accounts          JSONB   DEFAULT '[]'
  -- p_accounts: [{id, name, number, agency, type, subtype, balance}]
)
RETURNS TABLE(
  pluggy_item_db_id UUID,
  bank_connection_ids UUID[],
  is_new BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id  UUID;
  v_is_new   BOOLEAN := false;
  v_conn_ids UUID[]  := '{}';
  v_account  JSONB;
  v_conn_id  UUID;
  v_acct_type TEXT;
BEGIN
  -- Verificar acesso à loja
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado à loja';
  END IF;

  -- Upsert pluggy_items
  INSERT INTO public.pluggy_items (
    store_id, pluggy_item_id, institution_name,
    connector_id, connector_name,
    pluggy_account_ids, accounts_json,
    status, last_updated_at
  ) VALUES (
    p_store_id, p_pluggy_item_id, p_institution_name,
    p_connector_id, p_connector_name,
    ARRAY(SELECT jsonb_array_elements(p_accounts) ->> 'id'),
    p_accounts,
    'updated', now()
  )
  ON CONFLICT (store_id, pluggy_item_id) DO UPDATE SET
    institution_name   = EXCLUDED.institution_name,
    connector_id       = COALESCE(EXCLUDED.connector_id, public.pluggy_items.connector_id),
    connector_name     = COALESCE(EXCLUDED.connector_name, public.pluggy_items.connector_name),
    pluggy_account_ids = EXCLUDED.pluggy_account_ids,
    accounts_json      = EXCLUDED.accounts_json,
    status             = 'updated',
    last_updated_at    = now(),
    updated_at         = now()
  RETURNING id, (xmax = 0) INTO v_item_id, v_is_new;

  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id
    FROM public.pluggy_items
    WHERE store_id = p_store_id AND pluggy_item_id = p_pluggy_item_id;
    v_is_new := false;
  END IF;

  -- Criar/atualizar bank_connections para cada conta Pluggy
  FOR v_account IN SELECT * FROM jsonb_array_elements(p_accounts) LOOP
    -- Mapear tipo de conta
    v_acct_type := CASE
      WHEN (v_account->>'type') = 'CREDIT' THEN 'other'
      WHEN (v_account->>'subtype') IN ('SAVINGS_ACCOUNT') THEN 'savings'
      ELSE 'checking'
    END;

    -- Upsert banco por pluggy_account_id externo
    INSERT INTO public.bank_connections (
      store_id, bank_name, bank_code, agency, account_number,
      account_type, status, is_active,
      pluggy_item_id, pluggy_account_id
    ) VALUES (
      p_store_id,
      p_institution_name,
      NULL,
      v_account->>'routingNumber',
      COALESCE(v_account->>'number', v_account->>'id'),
      v_acct_type,
      'connected',
      true,
      v_item_id,
      v_account->>'id'
    )
    ON CONFLICT (store_id, pluggy_item_id, (COALESCE(pluggy_account_id, 'NULL')))
      DO NOTHING;  -- handled below via update

    SELECT id INTO v_conn_id
    FROM public.bank_connections
    WHERE store_id = p_store_id AND pluggy_account_id = (v_account->>'id')
    LIMIT 1;

    IF v_conn_id IS NOT NULL THEN
      UPDATE public.bank_connections
      SET status = 'connected', is_active = true, pluggy_item_id = v_item_id, updated_at = now()
      WHERE id = v_conn_id;

      v_conn_ids := v_conn_ids || v_conn_id;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_item_id, v_conn_ids, v_is_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_pluggy_item_auth(UUID,TEXT,TEXT,INTEGER,TEXT,JSONB) TO authenticated;

-- ── 4. RPC: upsert_bank_transaction_pluggy (service_role) ─────────────
-- Insere transação do Pluggy de forma idempotente.
-- Usa bank_reference (= Pluggy TX ID) como chave de idempotência.
CREATE OR REPLACE FUNCTION public.upsert_bank_transaction_pluggy(
  p_store_id           UUID,
  p_bank_connection_id UUID,
  p_external_id        TEXT,    -- Pluggy transaction ID
  p_transaction_date   DATE,
  p_amount             NUMERIC, -- sempre positivo
  p_transaction_type   TEXT,    -- 'credit' | 'debit'
  p_description        TEXT,
  p_method             TEXT,    -- pix | ted | doc | boleto | credit_card | debit_card | money | other
  p_bank_name          TEXT,
  p_raw_data           JSONB DEFAULT NULL
)
RETURNS TABLE(
  transaction_id UUID,
  is_new         BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id  UUID;
  v_is_new BOOLEAN := false;
BEGIN
  -- Idempotência por (store_id, bank_reference)
  SELECT id INTO v_tx_id
  FROM public.bank_transactions
  WHERE store_id = p_store_id AND bank_reference = p_external_id
  LIMIT 1;

  IF v_tx_id IS NULL THEN
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, method, bank_name,
      bank_reference, status
    ) VALUES (
      p_store_id, p_bank_connection_id, p_transaction_date, ABS(p_amount),
      p_transaction_type, p_description, p_method, p_bank_name,
      p_external_id, 'pending'
    )
    RETURNING id INTO v_tx_id;
    v_is_new := true;
  END IF;

  RETURN QUERY SELECT v_tx_id, v_is_new;
END;
$$;

-- Só service_role pode inserir transações via Pluggy
GRANT EXECUTE ON FUNCTION public.upsert_bank_transaction_pluggy(UUID,UUID,TEXT,DATE,NUMERIC,TEXT,TEXT,TEXT,TEXT,JSONB) TO service_role;

-- ── 5. RPC: update_bank_connection_sync_status (service_role) ─────────
CREATE OR REPLACE FUNCTION public.update_bank_connection_sync_status(
  p_bank_connection_id UUID,
  p_status             TEXT,   -- 'success' | 'failed' | 'partial'
  p_error_message      TEXT DEFAULT NULL,
  p_total_transactions BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.bank_connections
  SET
    status             = CASE WHEN p_status = 'failed' THEN 'error' ELSE 'connected' END,
    last_sync_at       = now(),
    last_sync_status   = p_status,
    error_message      = p_error_message,
    total_transactions = COALESCE(p_total_transactions, total_transactions),
    updated_at         = now()
  WHERE id = p_bank_connection_id;
$$;

GRANT EXECUTE ON FUNCTION public.update_bank_connection_sync_status(UUID,TEXT,TEXT,BIGINT) TO service_role;

-- ── 6. RPC: mark_pluggy_item_synced (service_role) ────────────────────
CREATE OR REPLACE FUNCTION public.mark_pluggy_item_synced(
  p_pluggy_item_id TEXT,
  p_synced_at      TIMESTAMPTZ DEFAULT now()
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pluggy_items
  SET last_synced_at = p_synced_at, updated_at = now()
  WHERE pluggy_item_id = p_pluggy_item_id;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pluggy_item_synced(TEXT, TIMESTAMPTZ) TO service_role;

-- ── 7. RPC: update_pluggy_item_status (service_role) ──────────────────
CREATE OR REPLACE FUNCTION public.update_pluggy_item_status(
  p_pluggy_item_id TEXT,
  p_status         TEXT,
  p_error_code     TEXT DEFAULT NULL,
  p_error_message  TEXT DEFAULT NULL,
  p_accounts_json  JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pluggy_items
  SET
    status          = p_status,
    error_code      = p_error_code,
    error_message   = p_error_message,
    last_updated_at = now(),
    accounts_json   = COALESCE(p_accounts_json, accounts_json),
    updated_at      = now()
  WHERE pluggy_item_id = p_pluggy_item_id;
$$;

GRANT EXECUTE ON FUNCTION public.update_pluggy_item_status(TEXT,TEXT,TEXT,TEXT,JSONB) TO service_role;

-- ── 8. Grant connect_run_matching ao service_role ─────────────────────
-- Necessário para que as Edge Functions disparem o motor de conciliação
-- após importar transações.
GRANT EXECUTE ON FUNCTION public.connect_run_matching(UUID) TO service_role;

-- ── 9. RPC: get_pluggy_items_for_sync (service_role) ──────────────────
-- Retorna todos os items ativos de uma loja para sincronização.
CREATE OR REPLACE FUNCTION public.get_pluggy_items_for_sync(p_store_id UUID)
RETURNS TABLE(
  id               UUID,
  pluggy_item_id   TEXT,
  institution_name TEXT,
  accounts_json    JSONB,
  last_synced_at   TIMESTAMPTZ,
  bank_connection_ids UUID[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pi.id,
    pi.pluggy_item_id,
    pi.institution_name,
    pi.accounts_json,
    pi.last_synced_at,
    ARRAY(
      SELECT bc.id FROM public.bank_connections bc
      WHERE bc.pluggy_item_id = pi.id AND bc.is_active = true
    ) AS bank_connection_ids
  FROM public.pluggy_items pi
  WHERE pi.store_id = p_store_id
    AND pi.status NOT IN ('login_error', 'error')
  ORDER BY pi.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pluggy_items_for_sync(UUID) TO service_role, authenticated;

-- ── 10. RPC: disconnect_pluggy_item (authenticated) ───────────────────
CREATE OR REPLACE FUNCTION public.disconnect_pluggy_item(
  p_store_id     UUID,
  p_pluggy_item_db_id UUID
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RETURN QUERY SELECT false, 'Acesso negado';
    RETURN;
  END IF;

  -- Desativar bank_connections vinculadas
  UPDATE public.bank_connections
  SET status = 'disconnected', is_active = false, updated_at = now()
  WHERE pluggy_item_id = p_pluggy_item_db_id AND store_id = p_store_id;

  -- Marcar item como desconectado
  UPDATE public.pluggy_items
  SET status = 'outdated', updated_at = now()
  WHERE id = p_pluggy_item_db_id AND store_id = p_store_id;

  RETURN QUERY SELECT true, 'Banco desconectado com sucesso';
END;
$$;

GRANT EXECUTE ON FUNCTION public.disconnect_pluggy_item(UUID, UUID) TO authenticated;

-- ── 11. RPC: get_bank_connections_with_pluggy (authenticated) ─────────
-- Retorna conexões bancárias enriquecidas com dados Pluggy.
CREATE OR REPLACE FUNCTION public.get_bank_connections_with_pluggy(p_store_id UUID)
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
  last_synced_at   TIMESTAMPTZ
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
    pi.last_synced_at
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

-- ── 12. Índices adicionais ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_reference
  ON public.bank_transactions(store_id, bank_reference)
  WHERE bank_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pluggy_items_last_synced
  ON public.pluggy_items(store_id, last_synced_at);
