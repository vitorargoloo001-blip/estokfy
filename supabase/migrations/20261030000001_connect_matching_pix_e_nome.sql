-- =====================================================================
-- Conciliação: vínculo exato do Pix gerado pelo Estokfy e desempate pelo
-- nome do pagador.
--
-- 1. Passe 0 (novo): o Pix cobrado pelo Estokfy (mercadopago_pix_charges)
--    manda o id da cobrança como external_reference. Quando o Connect importa
--    o recebimento com esse external_reference, o vínculo com o pagamento da
--    venda é exato (nota 100). Transações com external_reference são
--    processadas primeiro para que nenhuma sugestão aproximada leve antes o
--    pagamento delas.
-- 2. Passes 1-3: entre candidatos igualmente bons, vence o pagamento cuja
--    venda tem cliente com o mesmo nome do pagador (payer_name, ou a
--    descrição do extrato quando não há payer_name). Pagamentos do Pix do
--    Estokfy ficam por último nesses passes — o lugar deles é o passe 0.
--    As notas não mudam; a justificativa passa a dizer quando o nome confere.
--
-- Passe 4 (venda a prazo pelo nome na descrição) não muda.
-- =====================================================================

-- Minúsculas, sem acento, só letras/números separados por um espaço.
CREATE OR REPLACE FUNCTION public._connect_norm_name(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT btrim(regexp_replace(
    translate(lower(coalesce(p_text, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- Verdadeiro quando o primeiro e o último nome do cliente aparecem como
-- palavras inteiras no texto do pagador ("Maria Souza" casa com
-- "MARIA S SOUZA", "Ana" não casa com "Mariana").
CREATE OR REPLACE FUNCTION public._connect_payer_matches_customer(p_payer text, p_customer text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH n AS (
    SELECT ' ' || public._connect_norm_name(p_payer) || ' ' AS payer,
           string_to_array(public._connect_norm_name(p_customer), ' ') AS parts
  )
  SELECT coalesce(
    length(parts[1]) >= 3
      AND payer LIKE '% ' || parts[1] || ' %'
      AND payer LIKE '% ' || parts[array_length(parts, 1)] || ' %',
    false)
  FROM n
$$;

REVOKE EXECUTE ON FUNCTION public._connect_norm_name(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public._connect_payer_matches_customer(text, text) FROM anon, authenticated, PUBLIC;

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

  RETURN jsonb_build_object(
    'matches_created', v_created,
    'no_match',        v_no_match,
    'total_processed', v_created + v_no_match
  );
END;
$function$;
