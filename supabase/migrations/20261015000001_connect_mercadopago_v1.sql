-- =====================================================================
-- Estokfy Connect — Mercado Pago direto (V1)
--
-- Novo provider 'mercado_pago' na mesma arquitetura de 'pluggy', 'manual'
-- e 'itau_direct': os recebimentos da conta Mercado Pago viram linhas de
-- bank_transactions e passam pelo motor de conciliação existente
-- (_connect_run_matching_core) e pela confirmação existente
-- (confirm_reconciliation / bulk_reconcile → settle_sale_payment). Nenhum
-- dos dois é alterado aqui.
--
-- Regras de negócio (detalhe em docs/connect/MERCADO_PAGO_V1.md):
--   * amount = valor BRUTO pago pelo cliente (é o que casa com payments).
--     Taxa e líquido ficam em colunas próprias; a venda nunca vira o líquido.
--   * Só pagamento que chegou a ser aprovado vira linha. Pendente/recusado
--     não é dinheiro recebido.
--   * Estorno/chargeback depois de conciliado NÃO reverte dinheiro
--     automaticamente: gera alerta para revisão manual.
--   * Idempotência física pelo UNIQUE já existente em bank_reference, com
--     bank_reference = 'mercado_pago:' || payment.id.
-- =====================================================================

-- ── 1. bank_connections ───────────────────────────────────────────────
ALTER TABLE public.bank_connections
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

-- Uma conta MP ativa só pode estar ligada a uma loja: o webhook do Mercado
-- Pago chega com o user_id da conta e é roteado por ele.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_connections_mercadopago_active
  ON public.bank_connections (provider_connection_id)
  WHERE provider = 'mercado_pago' AND is_active = true;

-- ── 2. bank_transactions — colunas genéricas de provider ──────────────
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS provider_status     TEXT,
  ADD COLUMN IF NOT EXISTS provider_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gross_amount        NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS fee_amount          NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS net_amount          NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS refunded_amount     NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS payer_name          TEXT,
  ADD COLUMN IF NOT EXISTS payer_email         TEXT,
  ADD COLUMN IF NOT EXISTS external_reference  TEXT,
  ADD COLUMN IF NOT EXISTS raw_data            JSONB;

-- ── 3. upsert_mercadopago_connection (service_role) ───────────────────
-- Chamada só pela Edge Function mercadopago-connect, depois de validar
-- usuário, papel, licença Connect e a própria credencial no Mercado Pago.
-- Reconectar uma conexão desativada reinicia o cursor em now(): a loja
-- optou por não importar histórico.
CREATE OR REPLACE FUNCTION public.upsert_mercadopago_connection(
  p_store_id    UUID,
  p_mp_user_id  TEXT,
  p_nickname    TEXT,
  p_site_id     TEXT,
  p_created_by  UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          UUID;
  v_other_store UUID;
  v_label       TEXT := COALESCE(NULLIF(btrim(p_nickname), ''), p_mp_user_id);
BEGIN
  IF p_store_id IS NULL OR p_mp_user_id IS NULL OR btrim(p_mp_user_id) = '' THEN
    RAISE EXCEPTION 'parametros_invalidos';
  END IF;

  SELECT bc.store_id INTO v_other_store
  FROM public.bank_connections bc
  WHERE bc.provider = 'mercado_pago'
    AND bc.provider_connection_id = p_mp_user_id
    AND bc.is_active = true
    AND bc.store_id <> p_store_id
  LIMIT 1;

  IF v_other_store IS NOT NULL THEN
    RAISE EXCEPTION 'conta_mp_ja_conectada_em_outra_loja';
  END IF;

  SELECT bc.id INTO v_id
  FROM public.bank_connections bc
  WHERE bc.store_id = p_store_id
    AND bc.provider = 'mercado_pago'
    AND bc.provider_connection_id = p_mp_user_id
  ORDER BY bc.is_active DESC, bc.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.bank_connections (
      store_id, bank_name, account_number, account_type,
      status, provider, provider_connection_id, is_active,
      connected_at, metadata, created_by
    ) VALUES (
      p_store_id, 'Mercado Pago', v_label, 'other',
      'connected', 'mercado_pago', p_mp_user_id, true,
      now(),
      jsonb_build_object(
        'nickname', p_nickname,
        'site_id', p_site_id,
        'credential_mode', 'env_v1',
        'sync_cursor', to_jsonb(now())
      ),
      p_created_by
    )
    RETURNING bank_connections.id INTO v_id;
  ELSE
    -- Expressões do SET leem os valores ANTERIORES da linha (is_active, metadata).
    UPDATE public.bank_connections bc
    SET
      status         = 'connected',
      is_active      = true,
      error_message  = NULL,
      account_number = v_label,
      connected_at   = CASE WHEN bc.is_active THEN COALESCE(bc.connected_at, now()) ELSE now() END,
      metadata       = COALESCE(bc.metadata, '{}'::jsonb)
                       || jsonb_build_object('nickname', p_nickname, 'site_id', p_site_id, 'credential_mode', 'env_v1')
                       || CASE
                            WHEN bc.is_active AND COALESCE(bc.metadata, '{}'::jsonb) ? 'sync_cursor' THEN '{}'::jsonb
                            ELSE jsonb_build_object('sync_cursor', to_jsonb(now()))
                          END,
      updated_at     = now()
    WHERE bc.id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_mercadopago_connection(UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_mercadopago_connection(UUID, TEXT, TEXT, TEXT, UUID) TO service_role;

-- ── 4. upsert_bank_transaction_mercadopago (service_role) ─────────────
-- p_tx é o pagamento já normalizado pela Edge Function
-- (supabase/functions/_shared/mercadopago.ts → normalizeMpPayment). Usar
-- um único JSONB mantém a assinatura estável quando campos forem
-- acrescentados (evita o problema de overloads descrito no CLAUDE.md).
--
-- Retorno:
--   transaction_id  — linha afetada (NULL quando nada foi gravado)
--   is_new          — linha criada agora
--   became_matchable— a linha está 'pending' e pode receber sugestão do motor
--   action          — o que aconteceu, para log
CREATE OR REPLACE FUNCTION public.upsert_bank_transaction_mercadopago(
  p_store_id           UUID,
  p_bank_connection_id UUID,
  p_tx                 JSONB
)
RETURNS TABLE(
  transaction_id   UUID,
  is_new           BOOLEAN,
  became_matchable BOOLEAN,
  action           TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id   TEXT := NULLIF(btrim(p_tx->>'payment_id'), '');
  v_ref          TEXT;
  v_status       TEXT := p_tx->>'provider_status';
  v_updated      TIMESTAMPTZ := NULLIF(p_tx->>'date_last_updated', '')::timestamptz;
  v_was_approved BOOLEAN := NULLIF(p_tx->>'date_approved', '') IS NOT NULL;
  v_reversed     BOOLEAN;
  v_gross        NUMERIC := (p_tx->>'gross_amount')::numeric;
  v_refunded     NUMERIC := COALESCE(NULLIF(p_tx->>'refunded_amount', '')::numeric, 0);
  v_row          public.bank_transactions%ROWTYPE;
  v_new_id       UUID;
  v_sale_label   TEXT;
BEGIN
  IF v_payment_id IS NULL OR v_status IS NULL OR v_gross IS NULL OR v_gross <= 0 THEN
    RAISE EXCEPTION 'pagamento_mp_invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bank_connections bc
    WHERE bc.id = p_bank_connection_id
      AND bc.store_id = p_store_id
      AND bc.provider = 'mercado_pago'
  ) THEN
    RAISE EXCEPTION 'conexao_mp_invalida';
  END IF;

  v_ref      := 'mercado_pago:' || v_payment_id;
  v_reversed := v_status IN ('refunded', 'charged_back', 'cancelled');

  SELECT * INTO v_row
  FROM public.bank_transactions bt
  WHERE bt.bank_reference = v_ref
  FOR UPDATE;

  -- ── Primeira vez que vemos este pagamento ──
  IF NOT FOUND THEN
    IF NOT v_was_approved THEN
      RETURN QUERY SELECT NULL::uuid, false, false, 'skipped_not_approved'::text;
      RETURN;
    END IF;

    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, transaction_time,
      amount, transaction_type, description, bank_name, method,
      status, bank_reference, external_id, sync_at,
      provider_status, provider_updated_at,
      gross_amount, fee_amount, net_amount, refunded_amount,
      payer_name, payer_email, external_reference, raw_data
    ) VALUES (
      p_store_id, p_bank_connection_id,
      (p_tx->>'transaction_date')::date,
      NULLIF(p_tx->>'transaction_time', '')::time,
      v_gross, 'credit', p_tx->>'description', 'Mercado Pago', p_tx->>'method',
      -- já nasce estornado (ex.: aprovado e estornado entre dois syncs):
      -- fica registrado para auditoria, mas fora do motor.
      CASE WHEN v_status = 'approved' THEN 'pending' ELSE 'ignored' END,
      v_ref, v_payment_id, now(),
      v_status, v_updated,
      v_gross,
      NULLIF(p_tx->>'fee_amount', '')::numeric,
      NULLIF(p_tx->>'net_amount', '')::numeric,
      v_refunded,
      NULLIF(p_tx->>'payer_name', ''),
      NULLIF(p_tx->>'payer_email', ''),
      NULLIF(p_tx->>'external_reference', ''),
      p_tx->'raw_data'
    )
    ON CONFLICT (bank_reference) DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NOT NULL THEN
      RETURN QUERY SELECT v_new_id, true, (v_status = 'approved'), 'inserted'::text;
      RETURN;
    END IF;

    -- Corrida: outra chamada (webhook x sync) inseriu entre o SELECT e o
    -- INSERT. Relê com lock e segue pelo caminho de atualização.
    SELECT * INTO v_row
    FROM public.bank_transactions bt
    WHERE bt.bank_reference = v_ref
    FOR UPDATE;
  END IF;

  -- ── Atualização de um pagamento já conhecido ──
  IF v_row.store_id <> p_store_id THEN
    RAISE EXCEPTION 'transacao_de_outra_loja';
  END IF;

  IF v_row.provider_updated_at IS NOT NULL
     AND v_updated IS NOT NULL
     AND v_updated < v_row.provider_updated_at THEN
    RETURN QUERY SELECT v_row.id, false, false, 'stale_update_ignored'::text;
    RETURN;
  END IF;

  UPDATE public.bank_transactions bt
  SET
    provider_status     = v_status,
    provider_updated_at = COALESCE(v_updated, bt.provider_updated_at),
    fee_amount          = COALESCE(NULLIF(p_tx->>'fee_amount', '')::numeric, bt.fee_amount),
    net_amount          = COALESCE(NULLIF(p_tx->>'net_amount', '')::numeric, bt.net_amount),
    refunded_amount     = v_refunded,
    payer_name          = COALESCE(NULLIF(p_tx->>'payer_name', ''), bt.payer_name),
    payer_email         = COALESCE(NULLIF(p_tx->>'payer_email', ''), bt.payer_email),
    external_reference  = COALESCE(NULLIF(p_tx->>'external_reference', ''), bt.external_reference),
    -- a descrição alimenta o 4º passe do motor; só muda enquanto não conciliada
    description         = CASE WHEN bt.status = 'pending' THEN p_tx->>'description' ELSE bt.description END,
    raw_data            = COALESCE(p_tx->'raw_data', bt.raw_data),
    sync_at             = now(),
    updated_at          = now()
  WHERE bt.id = v_row.id;

  SELECT '#' || left(s.id::text, 8) INTO v_sale_label
  FROM public.sales s WHERE s.id = v_row.sale_id;

  -- Estorno / chargeback / cancelamento depois de aprovado
  IF v_reversed AND COALESCE(v_row.provider_status, '') IS DISTINCT FROM v_status THEN
    IF v_row.status = 'reconciled' THEN
      INSERT INTO public.connect_alerts (
        store_id, alert_type, severity, title, message, entity_type, entity_id
      ) VALUES (
        p_store_id, 'divergent_transaction', 'error',
        'Pagamento Mercado Pago estornado após conciliação',
        format(
          'O pagamento %s do Mercado Pago (R$ %s) mudou para "%s" depois de conciliado%s. Revise a venda: nenhum valor foi alterado automaticamente.',
          v_payment_id, to_char(v_row.amount, 'FM999G999G990D00'), v_status,
          CASE WHEN v_sale_label IS NOT NULL THEN ' com a venda ' || v_sale_label ELSE '' END
        ),
        'bank_transaction', v_row.id
      );
      RETURN QUERY SELECT v_row.id, false, false, 'reversed_after_reconciliation'::text;
      RETURN;
    END IF;

    IF v_row.status = 'pending' THEN
      UPDATE public.bank_transactions SET status = 'ignored', updated_at = now() WHERE id = v_row.id;
      UPDATE public.reconciliation_matches
         SET status = 'ignored', updated_at = now()
       WHERE bank_transaction_id = v_row.id AND status = 'pending';
      RETURN QUERY SELECT v_row.id, false, false, 'reversed_before_reconciliation'::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT v_row.id, false, false, 'reversed'::text;
    RETURN;
  END IF;

  -- Estorno parcial de algo já conciliado
  IF v_refunded > COALESCE(v_row.refunded_amount, 0) AND v_row.status = 'reconciled' THEN
    INSERT INTO public.connect_alerts (
      store_id, alert_type, severity, title, message, entity_type, entity_id
    ) VALUES (
      p_store_id, 'divergent_transaction', 'warning',
      'Estorno parcial no Mercado Pago após conciliação',
      format(
        'O pagamento %s do Mercado Pago teve R$ %s estornados depois de conciliado%s. Revise a venda: nenhum valor foi alterado automaticamente.',
        v_payment_id, to_char(v_refunded, 'FM999G999G990D00'),
        CASE WHEN v_sale_label IS NOT NULL THEN ' com a venda ' || v_sale_label ELSE '' END
      ),
      'bank_transaction', v_row.id
    );
    RETURN QUERY SELECT v_row.id, false, false, 'partial_refund_after_reconciliation'::text;
    RETURN;
  END IF;

  -- Voltou a 'approved' depois de um estorno que nós mesmos marcamos como
  -- ignorado (ex.: chargeback resolvido a favor do vendedor).
  IF v_status = 'approved'
     AND v_row.status = 'ignored'
     AND v_row.provider_status IN ('refunded', 'charged_back', 'cancelled') THEN
    UPDATE public.bank_transactions SET status = 'pending', updated_at = now() WHERE id = v_row.id;
    RETURN QUERY SELECT v_row.id, false, true, 'reapproved'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_row.id, false, false, 'updated'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_bank_transaction_mercadopago(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_bank_transaction_mercadopago(UUID, UUID, JSONB) TO service_role;

-- ── 5. list_bank_transactions — expõe os campos de provider ───────────
-- Mesma assinatura de 20260903000001_security_c1_c2_h1_h2_v2.sql; muda só
-- o RETURNS TABLE (colunas novas no FIM, para não deslocar as antigas),
-- por isso DROP + CREATE. O DROP apaga os grants: reaplicados abaixo.
DROP FUNCTION IF EXISTS public.list_bank_transactions(uuid, date, date, uuid, text, numeric, numeric, integer);

CREATE FUNCTION public.list_bank_transactions(
  p_store_id uuid,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_bank_connection_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT NULL::text,
  p_min_amount numeric DEFAULT NULL::numeric,
  p_max_amount numeric DEFAULT NULL::numeric,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid, transaction_date date, transaction_time time without time zone,
  amount numeric, transaction_type text, description text, bank_name text,
  method text, status text, origin_account text, destination_account text,
  category text, reconciled_with text, created_at timestamp with time zone,
  provider text, external_id text, provider_status text,
  gross_amount numeric, fee_amount numeric, net_amount numeric, refunded_amount numeric,
  payer_name text, external_reference text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  RETURN QUERY
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
    bt.created_at,
    bc.provider,
    bt.external_id,
    bt.provider_status,
    bt.gross_amount,
    bt.fee_amount,
    bt.net_amount,
    bt.refunded_amount,
    bt.payer_name,
    bt.external_reference
  FROM public.bank_transactions bt
  LEFT JOIN public.sales s ON bt.sale_id = s.id
  LEFT JOIN public.bank_connections bc ON bc.id = bt.bank_connection_id
  WHERE bt.store_id = p_store_id
    AND (p_start_date IS NULL OR bt.transaction_date >= p_start_date)
    AND (p_end_date IS NULL OR bt.transaction_date <= p_end_date)
    AND (p_bank_connection_id IS NULL OR bt.bank_connection_id = p_bank_connection_id)
    AND (p_status IS NULL OR bt.status = p_status)
    AND (p_min_amount IS NULL OR bt.amount >= p_min_amount)
    AND (p_max_amount IS NULL OR bt.amount <= p_max_amount)
  ORDER BY bt.transaction_date DESC
  LIMIT p_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.list_bank_transactions(uuid, date, date, uuid, text, numeric, numeric, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_bank_transactions(uuid, date, date, uuid, text, numeric, numeric, integer) TO authenticated, service_role;
