-- Estokfy Connect — conexão bancária funcional V1 (Pluggy).
--
-- Schema novo:
--  - payments.bank_transaction_id: liga um pagamento criado por conciliação
--    bancária à transação que o originou. UNIQUE physically impede a mesma
--    transação virar dois pagamentos (idempotência de verdade, não só de
--    aplicação).
--  - pluggy_webhooks.pluggy_event_id: idempotência real de webhook por
--    eventId da Pluggy (hoje só é absorvido indiretamente a jusante).
--  - bank_connections.balance: saldo da conta, populado a partir do
--    GET /accounts que pluggy-register-item/pluggy-sync-transactions já
--    fazem — sem chamada nova à API.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS bank_transaction_id uuid REFERENCES public.bank_transactions(id);
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_bank_transaction_id_uniq;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_bank_transaction_id_uniq UNIQUE (bank_transaction_id);

ALTER TABLE public.pluggy_webhooks
  ADD COLUMN IF NOT EXISTS pluggy_event_id text;
ALTER TABLE public.pluggy_webhooks
  DROP CONSTRAINT IF EXISTS pluggy_webhooks_event_id_uniq;
ALTER TABLE public.pluggy_webhooks
  ADD CONSTRAINT pluggy_webhooks_event_id_uniq UNIQUE (pluggy_event_id);

ALTER TABLE public.bank_connections
  ADD COLUMN IF NOT EXISTS balance numeric;

-- settle_sale_payment: mesma assinatura -- só acrescenta payment_id no
-- retorno (nenhuma outra linha muda). Necessário pra confirm_reconciliation/
-- bulk_reconcile saberem qual pagamento acabaram de criar.
CREATE OR REPLACE FUNCTION public.settle_sale_payment(p_sale_id uuid, p_payments jsonb, p_paid_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx record;
  v_sale record;
  v_pay jsonb;
  v_method text;
  v_amount numeric;
  v_added numeric := 0;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_note text;
  v_cash_desc text;
  v_payment_id uuid;
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'observacao_muito_longa';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.store_id <> v_ctx.store_id then raise exception 'store_invalida'; end if;
  if v_ctx.role not in ('owner','admin','manager','sales','finance') then
    raise exception 'sem_permissao_para_quitar';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'venda_ja_quitada';
  end if;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    v_method := (v_pay->>'method')::text;
    v_amount := (v_pay->>'amount')::numeric;
    if v_method = 'pending' then raise exception 'metodo_invalido_para_quitacao'; end if;
    if v_amount is null or v_amount <= 0 then continue; end if;

    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at, note)
    values (v_sale.store_id, v_sale.id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', p_paid_at, v_note)
    returning id into v_payment_id;

    perform public._allocate_payment_fifo_within_sale(v_payment_id, v_sale.id, v_amount);

    v_cash_desc := 'Recebimento de venda (quitação)';
    if v_note is not null then
      v_cash_desc := v_cash_desc || ' — Obs: ' || v_note;
    end if;

    insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
    select v_sale.store_id, l.id, 'income', 'venda', v_amount, v_method, 'sale', v_sale.id, v_cash_desc, v_ctx.profile_id, p_paid_at
    from public.cash_ledger l
    where l.store_id = v_sale.store_id and l.is_default = true
    limit 1;

    v_added := v_added + v_amount;
  end loop;

  if v_added <= 0 then raise exception 'pagamento_invalido'; end if;

  -- Trava: nunca aceitar mais do que a dívida real (lida sob FOR UPDATE acima).
  -- Sem isso, o excesso era absorvido em amount_paid sem erro, quebrando
  -- amount_paid + amount_pending = net_total (confirmado em 46 vendas de
  -- produção via o recebimento em lote de BatchSettlePaymentDialog.tsx).
  if v_added > v_sale.amount_pending + 0.01 then
    raise exception 'valor_maior_que_saldo_devedor';
  end if;

  v_new_paid := v_sale.amount_paid + v_added;
  v_new_pending := greatest(v_sale.amount_pending - v_added, 0);

  if v_new_pending <= 0 then
    delete from public.payments
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'paid';
  elsif v_new_paid > 0 then
    update public.payments
       set amount = v_new_pending
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'partial';
  else
    v_new_status := 'pending';
  end if;

  update public.sales
     set amount_paid = v_new_paid,
         amount_pending = v_new_pending,
         payment_status = v_new_status
   where id = v_sale.id;

  insert into public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (v_sale.store_id, v_ctx.profile_id, 'settle', 'sale', v_sale.id,
    jsonb_build_object('added',v_added,'paid',v_new_paid,'pending',v_new_pending,'payment_status',v_new_status,'note',v_note));

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'payment_id', v_payment_id,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status,
    'note', v_note
  );
end;
$function$;

-- _connect_run_matching_core: mesma assinatura -- passes 1-3 (contra
-- payments já existentes) ficam idênticos. Acrescenta um 4º passe: venda
-- em aberto (amount_pending > 0) SEM nenhum payment ainda, casada por
-- valor exato + data próxima + nome do cliente aparecendo na descrição da
-- transação (mais restritivo de propósito, porque confirmar isso cria
-- dinheiro novo). O NULL em payment_id no INSERT (herdado do v_best_pmt_id
-- nunca setado nesse passe) é o sinal que confirm_reconciliation/
-- bulk_reconcile usam pra saber que precisam chamar settle_sale_payment.
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
  v_tol5        NUMERIC;
  v_tol15       NUMERIC;
  v_created     INTEGER := 0;
  v_no_match    INTEGER := 0;
BEGIN
  FOR v_tx IN
    SELECT bt.id, bt.amount, bt.transaction_date, bt.description
    FROM public.bank_transactions bt
    WHERE bt.store_id = p_store_id
      AND bt.status = 'pending'
      AND bt.transaction_type = 'credit'
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_matches rm
        WHERE rm.bank_transaction_id = bt.id
          AND rm.status IN ('pending','confirmed')
      )
  LOOP
    v_best_pmt_id  := NULL;
    v_best_sale_id := NULL;
    v_best_score   := 0;
    v_match_type   := NULL;
    v_match_reason := NULL;
    v_tol5         := v_tx.amount * 0.05;
    v_tol15        := v_tx.amount * 0.15;

    -- Pass 1: Determinístico
    SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date
    INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date
    FROM public.payments pmt
    JOIN public.sales s ON s.id = pmt.sale_id
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
    ORDER BY ABS(pmt.paid_at::date - v_tx.transaction_date)
    LIMIT 1;

    IF v_best_pmt_id IS NOT NULL THEN
      v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
      v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
      v_best_score := LEAST(100, 95 + (3 - v_date_diff) * 1.5);
      v_match_type := 'deterministic';
      v_match_reason := 'Valor exato e data correspondente';
    END IF;

    -- Pass 2: Heurístico
    IF v_best_pmt_id IS NULL THEN
      SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date
      INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date
      FROM public.payments pmt
      JOIN public.sales s ON s.id = pmt.sale_id
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
      ORDER BY ABS(pmt.amount - v_tx.amount), ABS(pmt.paid_at::date - v_tx.transaction_date)
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
      SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date
      INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date
      FROM public.payments pmt
      JOIN public.sales s ON s.id = pmt.sale_id
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
      ORDER BY ABS(pmt.amount - v_tx.amount), ABS(pmt.paid_at::date - v_tx.transaction_date)
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

    -- Pass 4: Conta a receber em aberto sem pagamento ainda. Só roda se as
    -- passes 1-3 não acharam nenhum payment já existente pra vincular.
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

  RETURN jsonb_build_object(
    'matches_created', v_created,
    'no_match',        v_no_match,
    'total_processed', v_created + v_no_match
  );
END;
$function$;

-- confirm_reconciliation: mesma assinatura. Quando o match não tem
-- payment_id ainda (veio do 4º passe), cria o pagamento de verdade via
-- settle_sale_payment antes de marcar como confirmado -- herda a trava
-- contra sobrepagamento, alocação por item e cash_entries de graça.
-- Comportamento pra match que já tinha payment_id (todo o resto de hoje)
-- fica idêntico.
CREATE OR REPLACE FUNCTION public.confirm_reconciliation(p_reconciliation_id uuid, p_sale_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id       UUID;
  v_store_id      UUID;
  v_transaction_id UUID;
  v_tx_amount     NUMERIC;
  v_match_payment_id UUID;
  v_match_sale_id UUID;
  v_target_sale_id UUID;
  v_settle_result jsonb;
  v_new_payment_id UUID;
  v_bt_method text;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.bank_transaction_id, rm.payment_id, rm.sale_id
  INTO v_store_id, v_transaction_id, v_match_payment_id, v_match_sale_id
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

  SELECT bt.amount, bt.method INTO v_tx_amount, v_bt_method
  FROM public.bank_transactions bt WHERE bt.id = v_transaction_id;

  v_target_sale_id := COALESCE(p_sale_id, v_match_sale_id);

  IF v_match_payment_id IS NULL AND v_target_sale_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.payments WHERE bank_transaction_id = v_transaction_id) THEN
      RETURN QUERY SELECT false, 'Esta transação já gerou um pagamento — não processada de novo';
      RETURN;
    END IF;

    v_settle_result := public.settle_sale_payment(
      v_target_sale_id,
      jsonb_build_array(jsonb_build_object(
        'method', CASE v_bt_method
          WHEN 'pix' THEN 'pix'
          WHEN 'credit_card' THEN 'credit_card'
          WHEN 'debit_card' THEN 'debit_card'
          WHEN 'money' THEN 'cash'
          ELSE 'transfer'
        END,
        'amount', v_tx_amount
      )),
      now(),
      'Conciliação bancária automática'
    );
    v_new_payment_id := (v_settle_result->>'payment_id')::uuid;

    UPDATE public.payments SET bank_transaction_id = v_transaction_id WHERE id = v_new_payment_id;
  END IF;

  UPDATE public.reconciliation_matches
  SET
    status       = 'confirmed',
    confirmed_at = now(),
    confirmed_by = v_user_id,
    sale_id      = v_target_sale_id,
    payment_id   = COALESCE(v_new_payment_id, payment_id),
    updated_at   = now()
  WHERE id = p_reconciliation_id;

  UPDATE public.bank_transactions
  SET
    status     = 'reconciled',
    sale_id    = v_target_sale_id,
    updated_at = now()
  WHERE id = v_transaction_id;

  -- created_at_date é GENERATED ALWAYS (STORED) -- nunca deve ser inserido
  -- explicitamente. O INSERT original tentava gravar CURRENT_DATE nela, o
  -- que o Postgres sempre rejeitou (erro 428C9) desde que a coluna virou
  -- gerada -- confirm_reconciliation nunca conseguiu concluir com sucesso
  -- em produção, achado ao testar esta migration, corrigido junto.
  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    CASE WHEN p_sale_id IS NOT NULL THEN 'Conciliação manual confirmada' ELSE 'Conciliação automática confirmada' END,
    'reconciliation',
    'reconciliation_match', p_reconciliation_id,
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'sale_id', v_target_sale_id,
      'amount', v_tx_amount,
      'manual', p_sale_id IS NOT NULL,
      'payment_created', v_new_payment_id IS NOT NULL,
      'payment_id', v_new_payment_id
    )
  );

  RETURN QUERY SELECT true, 'Reconciliation confirmed successfully';
END;
$function$;

-- bulk_reconcile: mesma assinatura. Mesmo tratamento de confirm_reconciliation
-- pros matches sem payment_id, um de cada vez, antes do UPDATE em massa.
-- Se um settle_sale_payment falhar (ex.: saldo da venda mudou desde a
-- sugestão), a exceção aborta a transação inteira do lote -- comportamento
-- consciente: mais seguro que confirmar parte e deixar estado misto.
CREATE OR REPLACE FUNCTION public.bulk_reconcile(p_reconciliation_ids uuid[], p_action text)
 RETURNS TABLE(success boolean, message text, processed_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
  v_count    INTEGER;
  v_rm       RECORD;
  v_settle_result jsonb;
  v_new_payment_id UUID;
  v_bt_method text;
  v_tx_amount numeric;
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
    FOR v_rm IN
      SELECT rm.id, rm.bank_transaction_id, rm.sale_id
      FROM public.reconciliation_matches rm
      WHERE rm.id = ANY(p_reconciliation_ids)
        AND rm.status = 'pending'
        AND rm.payment_id IS NULL
        AND rm.sale_id IS NOT NULL
    LOOP
      IF EXISTS (SELECT 1 FROM public.payments WHERE bank_transaction_id = v_rm.bank_transaction_id) THEN
        CONTINUE;
      END IF;

      SELECT bt.amount, bt.method INTO v_tx_amount, v_bt_method
      FROM public.bank_transactions bt WHERE bt.id = v_rm.bank_transaction_id;

      v_settle_result := public.settle_sale_payment(
        v_rm.sale_id,
        jsonb_build_array(jsonb_build_object(
          'method', CASE v_bt_method
            WHEN 'pix' THEN 'pix'
            WHEN 'credit_card' THEN 'credit_card'
            WHEN 'debit_card' THEN 'debit_card'
            WHEN 'money' THEN 'cash'
            ELSE 'transfer'
          END,
          'amount', v_tx_amount
        )),
        now(),
        'Conciliação bancária em lote'
      );
      v_new_payment_id := (v_settle_result->>'payment_id')::uuid;

      UPDATE public.payments SET bank_transaction_id = v_rm.bank_transaction_id WHERE id = v_new_payment_id;
      UPDATE public.reconciliation_matches SET payment_id = v_new_payment_id WHERE id = v_rm.id;
    END LOOP;

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

  -- created_at_date é GENERATED ALWAYS (STORED), mesmo ajuste de
  -- confirm_reconciliation acima.
  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    'Conciliação em lote: ' || p_action || ' (' || v_count || ' registros)',
    'reconciliation',
    'bulk_reconciliation', NULL,
    jsonb_build_object(
      'action', p_action,
      'count', v_count,
      'ids', to_jsonb(p_reconciliation_ids)
    )
  );

  RETURN QUERY SELECT true, (p_action || ' successful')::TEXT, v_count::INTEGER;
END;
$function$;

-- get_bank_connections_with_pluggy: acrescenta bc.balance na saída, pra tela
-- de Bancos mostrar o saldo (item 11 do pedido). RETURNS TABLE muda de
-- forma (nova coluna), então precisa DROP antes -- CREATE OR REPLACE não
-- aceita mudar o tipo de retorno de uma função existente.
DROP FUNCTION IF EXISTS public.get_bank_connections_with_pluggy(uuid);
CREATE FUNCTION public.get_bank_connections_with_pluggy(p_store_id uuid)
 RETURNS TABLE(id uuid, bank_name text, bank_code text, agency text, account_number text, account_type text, status text, last_sync_at timestamp with time zone, last_sync_status text, total_transactions bigint, is_active boolean, pluggy_item_id uuid, pluggy_external_item_id text, pluggy_account_id text, pluggy_status text, institution_name text, last_synced_at timestamp with time zone, provider text, balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    bc.provider,
    bc.balance
  FROM public.bank_connections bc
  LEFT JOIN public.pluggy_items pi ON pi.id = bc.pluggy_item_id
  WHERE bc.store_id = p_store_id
    AND bc.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.store_id = p_store_id
    )
  ORDER BY bc.created_at ASC;
$function$;
