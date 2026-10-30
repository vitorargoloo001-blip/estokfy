-- =====================================================================
-- Conciliação automática de verdade: sugestões com nota alta passam a ser
-- confirmadas sozinhas, sem ninguém clicar.
--
-- Antes: a automação "Conciliação Automática" (connect_automations,
-- type = 'auto_reconciliation') existia na tela, mas nada a executava em
-- horário nenhum. Executada à mão, também não confirmava nada:
-- run-connect-automations chamava connect_run_matching (que exige usuário
-- logado e devolve só contagens, não a lista de sugestões) e depois
-- confirm_reconciliation com parâmetros que não existem.
--
-- Agora:
--   * _connect_auto_confirm(loja) confirma as sugestões pendentes com nota
--     >= min_confidence da automação ativa da loja (padrão 85).
--   * _connect_run_matching_core chama essa função no final. Toda execução
--     do motor (sincronização do Mercado Pago a cada 10 min, webhooks,
--     importação de extrato, tick diário, "rodar agora") já confirma o que
--     tiver nota suficiente. Loja sem a automação ativa: nada muda.
--   * Sugestão de venda a prazo sem pagamento (passe 4) é quitada por
--     _connect_settle_sale_system, porque settle_sale_payment exige usuário
--     logado. Mesmo motivo e mesmas travas de mercadopago_pix_apply_status.
--     Qualquer mudança na regra de quitação precisa ser espelhada aqui.
--   * Se a quitação falhar (venda já quitada, valor maior que o saldo), a
--     sugestão fica pendente para revisão manual.
-- =====================================================================

-- ── Quitação sem usuário logado (espelha settle_sale_payment) ─────────
CREATE OR REPLACE FUNCTION public._connect_settle_sale_system(
  p_sale_id             uuid,
  p_store_id            uuid,
  p_method              text,
  p_amount              numeric,
  p_bank_transaction_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sale       record;
  v_payment_id uuid;
  v_new_paid   numeric;
  v_new_pend   numeric;
  v_new_status text;
  v_note       CONSTANT text := 'Conciliação bancária automática';
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('pix','cash','credit_card','debit_card','transfer') THEN
    RAISE EXCEPTION 'metodo_invalido_para_quitacao';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'pagamento_invalido';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.deleted_at IS NOT NULL OR v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'venda_nao_encontrada';
  END IF;
  IF v_sale.store_id <> p_store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_sale.payment_status = 'paid' THEN RAISE EXCEPTION 'venda_ja_quitada'; END IF;
  IF p_amount > v_sale.amount_pending THEN RAISE EXCEPTION 'valor_maior_que_saldo_devedor'; END IF;

  INSERT INTO public.payments (store_id, sale_id, method, amount, paid_at, note, bank_transaction_id)
  VALUES (v_sale.store_id, v_sale.id, p_method, p_amount, now(), v_note, p_bank_transaction_id)
  RETURNING id INTO v_payment_id;

  PERFORM public._allocate_payment_fifo_within_sale(v_payment_id, v_sale.id, p_amount);

  INSERT INTO public.cash_entries (
    store_id, ledger_id, entry_type, category, amount, payment_method,
    reference_type, reference_id, description, created_by, occurred_at
  )
  SELECT v_sale.store_id, l.id, 'income', 'venda', p_amount, p_method,
         'sale', v_sale.id, 'Recebimento de venda (quitação) — Obs: ' || v_note, NULL, now()
  FROM public.cash_ledger l
  WHERE l.store_id = v_sale.store_id AND l.is_default = true
  LIMIT 1;

  v_new_paid := v_sale.amount_paid + p_amount;
  v_new_pend := greatest(v_sale.amount_pending - p_amount, 0);
  IF v_new_pend <= 0 THEN
    DELETE FROM public.payments WHERE sale_id = v_sale.id AND method = 'pending';
    v_new_status := 'paid';
  ELSIF v_new_paid > 0 THEN
    UPDATE public.payments SET amount = v_new_pend WHERE sale_id = v_sale.id AND method = 'pending';
    v_new_status := 'partial';
  ELSE
    v_new_status := 'pending';
  END IF;

  UPDATE public.sales
     SET amount_paid = v_new_paid,
         amount_pending = v_new_pend,
         payment_status = v_new_status
   WHERE id = v_sale.id;

  INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (v_sale.store_id, NULL, 'settle', 'sale', v_sale.id,
    jsonb_build_object('added', p_amount, 'paid', v_new_paid, 'pending', v_new_pend,
      'payment_status', v_new_status, 'note', v_note,
      'source', 'connect_auto_reconciliation', 'bank_transaction_id', p_bank_transaction_id));

  RETURN v_payment_id;
END;
$$;

-- ── Confirmação automática das sugestões ───────────────────────────────
-- p_min_score NULL: usa a automação ativa da loja (sem ela, não faz nada).
-- p_min_score informado: execução manual pela tela de Automações.
CREATE OR REPLACE FUNCTION public._connect_auto_confirm(p_store_id uuid, p_min_score numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_auto       record;
  v_min        numeric;
  v_rm         record;
  v_bt         record;
  v_payment_id uuid;
  v_confirmed  integer := 0;
  v_settled    integer := 0;
  v_skipped    integer := 0;
BEGIN
  SELECT a.id, a.is_active, a.config INTO v_auto
  FROM public.connect_automations a
  WHERE a.store_id = p_store_id AND a.type = 'auto_reconciliation'
  ORDER BY a.is_active DESC, a.created_at
  LIMIT 1;

  IF p_min_score IS NULL THEN
    IF NOT coalesce(v_auto.is_active, false) THEN
      RETURN jsonb_build_object('enabled', false, 'confirmed', 0);
    END IF;
    v_min := CASE WHEN v_auto.config->>'min_confidence' ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN (v_auto.config->>'min_confidence')::numeric
                  ELSE 85 END;
  ELSE
    v_min := p_min_score;
  END IF;

  FOR v_rm IN
    SELECT rm.id, rm.bank_transaction_id, rm.sale_id, rm.payment_id, rm.confidence_score
    FROM public.reconciliation_matches rm
    WHERE rm.store_id = p_store_id
      AND rm.status = 'pending'
      AND rm.confidence_score >= v_min
    ORDER BY rm.confidence_score DESC, rm.created_at, rm.id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT bt.id, bt.amount, bt.method, bt.status INTO v_bt
    FROM public.bank_transactions bt
    WHERE bt.id = v_rm.bank_transaction_id AND bt.store_id = p_store_id
    FOR UPDATE;
    IF v_bt.id IS NULL OR v_bt.status <> 'pending' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_payment_id := v_rm.payment_id;
    IF v_payment_id IS NULL THEN
      -- Venda a prazo: o recebimento vira o pagamento da venda.
      IF v_rm.sale_id IS NULL
         OR EXISTS (SELECT 1 FROM public.payments p WHERE p.bank_transaction_id = v_bt.id) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      BEGIN
        v_payment_id := public._connect_settle_sale_system(
          v_rm.sale_id, p_store_id,
          CASE v_bt.method
            WHEN 'pix' THEN 'pix'
            WHEN 'credit_card' THEN 'credit_card'
            WHEN 'debit_card' THEN 'debit_card'
            WHEN 'money' THEN 'cash'
            ELSE 'transfer'
          END,
          v_bt.amount, v_bt.id);
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END;
      v_settled := v_settled + 1;
    END IF;

    UPDATE public.reconciliation_matches
       SET status       = 'confirmed',
           confirmed_at = now(),
           confirmed_by = NULL,
           payment_id   = v_payment_id,
           notes        = coalesce(notes, 'Confirmada automaticamente (nota '
                            || round(v_rm.confidence_score)::text || ', mínimo ' || v_min::text || ')'),
           updated_at   = now()
     WHERE id = v_rm.id;

    UPDATE public.bank_transactions
       SET status = 'reconciled', sale_id = v_rm.sale_id, updated_at = now()
     WHERE id = v_bt.id;

    v_confirmed := v_confirmed + 1;
  END LOOP;

  IF p_min_score IS NULL THEN
    UPDATE public.connect_automations
       SET last_run_at = now(), last_run_status = 'success'
     WHERE id = v_auto.id;
  END IF;

  IF v_confirmed > 0 THEN
    PERFORM public.add_connect_log(
      p_store_id, 'match',
      'Conciliação automática: ' || v_confirmed || ' confirmada(s)',
      jsonb_build_object('confirmed', v_confirmed, 'settled', v_settled, 'skipped', v_skipped, 'min_score', v_min),
      NULL, NULL, 'info');
    PERFORM public.create_connect_notification(
      p_store_id, 'auto_reconciliation',
      '⚡ ' || v_confirmed || ' transação(ões) conciliada(s) automaticamente',
      'A conciliação automática confirmou ' || v_confirmed || ' recebimento(s) com nota ≥ ' || v_min::text
        || CASE WHEN v_settled > 0 THEN ', ' || v_settled || ' quitando venda a prazo.' ELSE '.' END,
      'info', 'internal', v_auto.id, NULL,
      jsonb_build_object('confirmed', v_confirmed, 'settled', v_settled, 'min_score', v_min));
  END IF;

  RETURN jsonb_build_object(
    'enabled',   true,
    'min_score', v_min,
    'confirmed', v_confirmed,
    'settled',   v_settled,
    'skipped',   v_skipped
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._connect_settle_sale_system(uuid, uuid, text, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._connect_auto_confirm(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._connect_settle_sale_system(uuid, uuid, text, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._connect_auto_confirm(uuid, numeric) TO service_role;

-- ── Motor: chama a confirmação automática no final ──────────────────
-- Corpo igual ao da migration 20261030000001, só com o bloco final novo.
CREATE OR REPLACE FUNCTION public._connect_run_matching_core(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx          RECORD;
  v_best_pmt_id UUID;
  v_best_sale_id UUID;
  v_best_score  NUMERIC;
  v_match_type  TEXT;
  v_match_reason TEXT;
  v_amt_diff    NUMERIC;
  v_date_diff   INTEGER;
  v_pmt_amount  NUMERIC;
  v_pmt_date    DATE;
  v_name_match  BOOLEAN;
  v_tol5        NUMERIC;
  v_tol15       NUMERIC;
  v_created     INTEGER := 0;
  v_no_match    INTEGER := 0;
  v_auto        JSONB;
BEGIN
  FOR v_tx IN
    SELECT bt.id, bt.amount, bt.transaction_date, bt.description, bt.external_reference,
           COALESCE(NULLIF(btrim(bt.payer_name), ''), bt.description) AS payer_text
    FROM public.bank_transactions bt
    WHERE bt.store_id = p_store_id
      AND bt.status = 'pending'
      AND bt.transaction_type = 'credit'
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_matches rm
        WHERE rm.bank_transaction_id = bt.id
          AND rm.status IN ('pending','confirmed')
      )
    ORDER BY (bt.external_reference IS NULL), bt.transaction_date, bt.id
  LOOP
    v_best_pmt_id  := NULL;
    v_best_sale_id := NULL;
    v_best_score   := 0;
    v_match_type   := NULL;
    v_match_reason := NULL;
    v_name_match   := false;
    v_tol5         := v_tx.amount * 0.05;
    v_tol15        := v_tx.amount * 0.15;

    -- Pass 0: Pix gerado pelo Estokfy. O pagamento da venda foi criado por
    -- mercadopago_pix_apply_status com idempotency_key 'mercadopago:<id na order>'.
    IF v_tx.external_reference IS NOT NULL THEN
      SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date
      INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date
      FROM public.mercadopago_pix_charges ch
      JOIN public.payments pmt
        ON pmt.sale_id = ch.sale_id
       AND pmt.store_id = ch.store_id
       AND pmt.idempotency_key = 'mercadopago:' || ch.mp_payment_id
      JOIN public.sales s ON s.id = pmt.sale_id
      WHERE ch.id::text = v_tx.external_reference
        AND ch.store_id = p_store_id
        AND ch.status = 'paid'
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND ABS(pmt.amount - v_tx.amount) < 0.01
        AND NOT EXISTS (
          SELECT 1 FROM public.reconciliation_matches rm2
          WHERE rm2.payment_id = pmt.id AND rm2.status IN ('pending','confirmed')
        )
      LIMIT 1;
      IF v_best_pmt_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
        v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
        v_best_score := 100;
        v_match_type := 'deterministic';
        v_match_reason := 'Pix gerado pelo Estokfy para esta venda';
      END IF;
    END IF;

    -- Pass 1: Determinístico
    IF v_best_pmt_id IS NULL THEN
      SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date,
             public._connect_payer_matches_customer(v_tx.payer_text, c.name)
      INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date, v_name_match
      FROM public.payments pmt
      JOIN public.sales s ON s.id = pmt.sale_id
      LEFT JOIN public.customers c ON c.id = s.customer_id
      WHERE s.store_id = p_store_id
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND pmt.method IN ('pix','card','credit_card','debit_card')
        AND NOT EXISTS (
          SELECT 1 FROM public.reconciliation_matches rm2
          WHERE rm2.payment_id = pmt.id AND rm2.status IN ('pending','confirmed')
        )
        AND ABS(pmt.amount - v_tx.amount) < 0.01
        AND ABS(pmt.paid_at::date - v_tx.transaction_date) <= 3
      ORDER BY public._connect_payer_matches_customer(v_tx.payer_text, c.name) DESC,
               (COALESCE(pmt.provider, '') = 'mercadopago'),
               ABS(pmt.paid_at::date - v_tx.transaction_date)
      LIMIT 1;
      IF v_best_pmt_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
        v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
        v_best_score := LEAST(100, 95 + (3 - v_date_diff) * 1.5);
        v_match_type := 'deterministic';
        v_match_reason := 'Valor exato e data correspondente';
      END IF;
    END IF;

    -- Pass 2: Heurístico
    IF v_best_pmt_id IS NULL THEN
      SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date,
             public._connect_payer_matches_customer(v_tx.payer_text, c.name)
      INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date, v_name_match
      FROM public.payments pmt
      JOIN public.sales s ON s.id = pmt.sale_id
      LEFT JOIN public.customers c ON c.id = s.customer_id
      WHERE s.store_id = p_store_id
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND pmt.method IN ('pix','card','credit_card','debit_card')
        AND NOT EXISTS (
          SELECT 1 FROM public.reconciliation_matches rm2
          WHERE rm2.payment_id = pmt.id AND rm2.status IN ('pending','confirmed')
        )
        AND ABS(pmt.amount - v_tx.amount) <= v_tol5
        AND ABS(pmt.paid_at::date - v_tx.transaction_date) <= 7
      ORDER BY public._connect_payer_matches_customer(v_tx.payer_text, c.name) DESC,
               (COALESCE(pmt.provider, '') = 'mercadopago'),
               ABS(pmt.amount - v_tx.amount), ABS(pmt.paid_at::date - v_tx.transaction_date)
      LIMIT 1;
      IF v_best_pmt_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
        v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
        v_best_score := GREATEST(70, LEAST(88,
          88 - (v_amt_diff / NULLIF(v_tx.amount, 0) * 200) - (v_date_diff * 2)
        ));
        v_match_type := 'heuristic';
        v_match_reason := 'Valor e data dentro da tolerância configurada';
      END IF;
    END IF;

    -- Pass 3: Fuzzy
    IF v_best_pmt_id IS NULL THEN
      SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date,
             public._connect_payer_matches_customer(v_tx.payer_text, c.name)
      INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date, v_name_match
      FROM public.payments pmt
      JOIN public.sales s ON s.id = pmt.sale_id
      LEFT JOIN public.customers c ON c.id = s.customer_id
      WHERE s.store_id = p_store_id
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND pmt.method IN ('pix','card','credit_card','debit_card')
        AND NOT EXISTS (
          SELECT 1 FROM public.reconciliation_matches rm2
          WHERE rm2.payment_id = pmt.id AND rm2.status IN ('pending','confirmed')
        )
        AND ABS(pmt.amount - v_tx.amount) <= v_tol15
        AND ABS(pmt.paid_at::date - v_tx.transaction_date) <= 14
      ORDER BY public._connect_payer_matches_customer(v_tx.payer_text, c.name) DESC,
               (COALESCE(pmt.provider, '') = 'mercadopago'),
               ABS(pmt.amount - v_tx.amount), ABS(pmt.paid_at::date - v_tx.transaction_date)
      LIMIT 1;
      IF v_best_pmt_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
        v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
        v_best_score := GREATEST(40, LEAST(69,
          65 - (v_amt_diff / NULLIF(v_tx.amount, 0) * 100) - (v_date_diff * 1.5)
        ));
        v_match_type := 'fuzzy';
        v_match_reason := 'Correspondência aproximada por similaridade';
      END IF;
    END IF;

    IF v_match_type IS NOT NULL AND v_name_match THEN
      v_match_reason := v_match_reason || ' · nome do pagador confere com o cliente';
    END IF;

    -- Pass 4: Conta a receber em aberto sem pagamento ainda. Só roda se as
    -- passes 0-3 não acharam nenhum payment já existente pra vincular.
    -- v_best_pmt_id continua NULL de propósito -- é o sinal que
    -- confirm_reconciliation/bulk_reconcile usam pra saber que precisam
    -- criar o pagamento (via settle_sale_payment) em vez de só confirmar.
    IF v_match_type IS NULL THEN
      SELECT s.id, s.amount_pending, COALESCE(s.due_date, s.sale_date)
      INTO v_best_sale_id, v_pmt_amount, v_pmt_date
      FROM public.sales s
      JOIN public.customers c ON c.id = s.customer_id
      WHERE s.store_id = p_store_id
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND s.amount_pending > 0
        AND length(btrim(c.name)) >= 3
        AND NOT EXISTS (
          SELECT 1 FROM public.reconciliation_matches rm4
          WHERE rm4.sale_id = s.id AND rm4.status IN ('pending','confirmed') AND rm4.payment_id IS NULL
        )
        AND ABS(s.amount_pending - v_tx.amount) < 0.01
        AND ABS(COALESCE(s.due_date, s.sale_date) - v_tx.transaction_date) <= 3
        AND v_tx.description ILIKE '%' || c.name || '%'
      ORDER BY ABS(COALESCE(s.due_date, s.sale_date) - v_tx.transaction_date)
      LIMIT 1;

      IF v_best_sale_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
        v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
        v_best_score := LEAST(97, 90 + (3 - v_date_diff));
        v_match_type := 'deterministic';
        v_match_reason := 'Venda em aberto sem pagamento — cliente identificado na descrição';
      END IF;
    END IF;

    IF v_match_type IS NOT NULL THEN
      INSERT INTO public.reconciliation_matches (
        store_id, bank_transaction_id, sale_id, payment_id,
        match_type, confidence_score,
        amount_difference, date_difference_days, match_reason, status
      ) VALUES (
        p_store_id, v_tx.id, v_best_sale_id, v_best_pmt_id,
        v_match_type, round(v_best_score::numeric, 0),
        v_amt_diff, v_date_diff,
        v_match_reason,
        'pending'
      )
      ON CONFLICT DO NOTHING;
      v_created := v_created + 1;
    ELSE
      v_no_match := v_no_match + 1;
    END IF;

  END LOOP;

  -- Conciliação automática: confirma o que tiver nota suficiente, se a loja
  -- ativou a automação. Uma falha aqui não desfaz as sugestões criadas acima.
  BEGIN
    v_auto := public._connect_auto_confirm(p_store_id);
  EXCEPTION WHEN OTHERS THEN
    v_auto := jsonb_build_object('error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'matches_created', v_created,
    'no_match',        v_no_match,
    'total_processed', v_created + v_no_match,
    'auto_confirm',    v_auto
  );
END;
$function$;
