-- =====================================================================
-- Connect: Sandbox + Motor de Conciliação 3 Passes + Dashboard KPIs
-- =====================================================================

-- =====================================================================
-- 1. SANDBOX: Gerar dados de demonstração
--    Gated por is_super_admin() — somente vitorargoloo001@gmail.com
-- =====================================================================
CREATE OR REPLACE FUNCTION public.connect_seed_demo_data(p_store_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn_id   UUID;
  v_tx_id     UUID;
  v_sale_ids  UUID[] := '{}';
  v_sale_id   UUID;
  v_sale_amt  NUMERIC;
  v_sale_date DATE;
  v_today     DATE := CURRENT_DATE;
  v_i         INTEGER;
  v_tx_count  INTEGER := 0;
  v_match_count INTEGER := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas_super_admin';
  END IF;

  -- Idempotente: remove dados anteriores do sandbox
  DELETE FROM public.bank_connections
  WHERE store_id = p_store_id
    AND bank_name = 'Banco Sandbox Demo';

  -- Cria conexão bancária demo
  INSERT INTO public.bank_connections (
    store_id, bank_name, bank_code, agency, account_number,
    account_type, account_holder, status,
    last_sync_at, last_sync_status, total_transactions, is_active
  ) VALUES (
    p_store_id,
    'Banco Sandbox Demo',
    '077',
    '0001',
    '****9999',
    'checking',
    'Empresa Demonstração Ltda',
    'connected',
    now() - INTERVAL '8 minutes',
    'success',
    25,
    true
  ) RETURNING id INTO v_conn_id;

  -- Tenta vincular vendas reais (até 4) para matches determinísticos
  SELECT ARRAY(
    SELECT s.id
    FROM public.sales s
    WHERE s.store_id = p_store_id
      AND s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled', 'refunded', 'returned')
      AND s.net_total > 0
    ORDER BY s.sale_date DESC
    LIMIT 4
  ) INTO v_sale_ids;

  -- ============================================================
  -- 8 transações CONCILIADAS (credit, últimos 45 dias)
  -- ============================================================
  FOR v_i IN 1..8 LOOP
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_today - (v_i * 5 + (v_i % 3)),
      round((150 + (v_i * 73.5) + (v_i % 7) * 12)::numeric, 2),
      'credit',
      CASE (v_i % 4)
        WHEN 0 THEN 'PIX RECEBIDO - CLIENTE ' || v_i
        WHEN 1 THEN 'TED RECEBIDA - PEDIDO ' || (v_i * 100)
        WHEN 2 THEN 'TRANSFERÊNCIA RECEBIDA - REF ' || v_i
        ELSE     'PIX - PAGAMENTO VENDA ' || (v_i * 10)
      END,
      'Banco Sandbox Demo',
      CASE (v_i % 3) WHEN 0 THEN 'pix' WHEN 1 THEN 'ted' ELSE 'pix' END,
      'reconciled',
      'DEMO-REC-' || v_i || '-' || gen_random_uuid()::text
    );
    v_tx_count := v_tx_count + 1;
  END LOOP;

  -- ============================================================
  -- 5 transações DIVERGENTES
  -- ============================================================
  FOR v_i IN 1..5 LOOP
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_today - (v_i * 3 + 1),
      round((200 + v_i * 87.3)::numeric, 2),
      'credit',
      'PIX SEM IDENTIFICAÇÃO - REF ' || v_i,
      'Banco Sandbox Demo',
      'pix',
      'divergent',
      'DEMO-DIV-' || v_i || '-' || gen_random_uuid()::text
    );
    v_tx_count := v_tx_count + 1;
  END LOOP;

  -- ============================================================
  -- 2 transações IGNORADAS (taxas/débitos)
  -- ============================================================
  FOR v_i IN 1..2 LOOP
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_today - v_i,
      round((8.5 + v_i * 3.2)::numeric, 2),
      'debit',
      'TARIFA BANCÁRIA 0' || v_i,
      'Banco Sandbox Demo',
      'other',
      'ignored',
      'DEMO-IGN-' || v_i || '-' || gen_random_uuid()::text
    );
    v_tx_count := v_tx_count + 1;
  END LOOP;

  -- ============================================================
  -- 10 transações PENDENTES com reconciliation_matches
  -- Primeiras 4: tentam linkar a vendas reais (determinístico)
  -- Próximas 6: heurístico/fuzzy sem link de venda
  -- ============================================================

  FOR v_i IN 1..4 LOOP
    v_sale_id := v_sale_ids[v_i]; -- NULL se não houver venda suficiente

    IF v_sale_id IS NOT NULL THEN
      SELECT s.net_total, s.sale_date::date
      INTO v_sale_amt, v_sale_date
      FROM public.sales s WHERE s.id = v_sale_id;
    ELSE
      v_sale_amt  := round((100 + v_i * 143.7)::numeric, 2);
      v_sale_date := v_today - (v_i * 3 + 8);
    END IF;

    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_sale_date + 1,           -- 1 dia após a venda (realista para PIX)
      v_sale_amt,
      'credit',
      'PIX RECEBIDO - PEDIDO 00' || (v_i * 10),
      'Banco Sandbox Demo',
      'pix',
      'pending',
      'DEMO-DET-' || v_i || '-' || gen_random_uuid()::text
    ) RETURNING id INTO v_tx_id;
    v_tx_count := v_tx_count + 1;

    INSERT INTO public.reconciliation_matches (
      store_id, bank_transaction_id, sale_id,
      match_type, confidence_score,
      amount_difference, date_difference_days, match_reason, status
    ) VALUES (
      p_store_id, v_tx_id, v_sale_id,
      CASE WHEN v_sale_id IS NOT NULL THEN 'deterministic' ELSE 'heuristic' END,
      CASE WHEN v_sale_id IS NOT NULL THEN 97 ELSE 74 END,
      0,
      1,
      CASE WHEN v_sale_id IS NOT NULL
        THEN 'Valor exato + data correspondente (PIX D+1)'
        ELSE 'Padrão de recebimento PIX identificado'
      END,
      'pending'
    );
    v_match_count := v_match_count + 1;
  END LOOP;

  FOR v_i IN 1..6 LOOP
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_today - (v_i + 3),
      round((80 + v_i * 112.4)::numeric, 2),
      'credit',
      CASE (v_i % 3)
        WHEN 0 THEN 'TED RECEBIDA - CLIENTE'
        WHEN 1 THEN 'PIX - SEM DESCRIÇÃO'
        ELSE     'TRANSFERÊNCIA ENTRADA'
      END,
      'Banco Sandbox Demo',
      CASE (v_i % 2) WHEN 0 THEN 'ted' ELSE 'pix' END,
      'pending',
      'DEMO-HEU-' || v_i || '-' || gen_random_uuid()::text
    ) RETURNING id INTO v_tx_id;
    v_tx_count := v_tx_count + 1;

    INSERT INTO public.reconciliation_matches (
      store_id, bank_transaction_id, sale_id,
      match_type, confidence_score,
      amount_difference, date_difference_days, match_reason, status
    ) VALUES (
      p_store_id, v_tx_id, NULL,
      CASE WHEN v_i <= 3 THEN 'heuristic' ELSE 'fuzzy' END,
      CASE WHEN v_i <= 3 THEN (72 + v_i * 4) ELSE (42 + v_i * 3) END,
      round((v_i * 5.3)::numeric, 2),
      v_i,
      CASE WHEN v_i <= 3
        THEN 'Padrão de pagamento reconhecido — confirme a venda correspondente'
        ELSE 'Correspondência aproximada — revise antes de conciliar'
      END,
      'pending'
    );
    v_match_count := v_match_count + 1;
  END LOOP;

  UPDATE public.bank_connections
  SET total_transactions = v_tx_count
  WHERE id = v_conn_id;

  RETURN jsonb_build_object(
    'connection_id',       v_conn_id,
    'transactions_created', v_tx_count,
    'matches_created',     v_match_count,
    'sales_linked',        COALESCE(array_length(v_sale_ids, 1), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_seed_demo_data(UUID) TO authenticated;

-- =====================================================================
-- 2. SANDBOX: Limpar dados de demonstração
-- =====================================================================
CREATE OR REPLACE FUNCTION public.connect_clear_demo_data(p_store_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas_super_admin';
  END IF;

  DELETE FROM public.bank_connections
  WHERE store_id = p_store_id
    AND bank_name = 'Banco Sandbox Demo';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('connections_deleted', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_clear_demo_data(UUID) TO authenticated;

-- =====================================================================
-- 3. MOTOR DE CONCILIAÇÃO — 3 Passes
--    Pass 1 Determinístico: valor exato ±R$0,01, data ±3 dias → conf 95–100
--    Pass 2 Heurístico:     valor ±5%, data ±7 dias             → conf 70–88
--    Pass 3 Fuzzy:          valor ±15%, data ±14 dias           → conf 40–69
-- =====================================================================
CREATE OR REPLACE FUNCTION public.connect_run_matching(p_store_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx          RECORD;
  v_best_id     UUID;
  v_best_score  NUMERIC;
  v_match_type  TEXT;
  v_amt_diff    NUMERIC;
  v_date_diff   INTEGER;
  v_net_total   NUMERIC;
  v_sale_date   DATE;
  v_tol5        NUMERIC;
  v_tol15       NUMERIC;
  v_created     INTEGER := 0;
  v_no_match    INTEGER := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  FOR v_tx IN
    SELECT bt.id, bt.amount, bt.transaction_date
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
    v_best_id    := NULL;
    v_best_score := 0;
    v_match_type := NULL;
    v_tol5       := v_tx.amount * 0.05;
    v_tol15      := v_tx.amount * 0.15;

    -- Pass 1: Determinístico
    SELECT s.id, s.net_total, s.sale_date::date
    INTO v_best_id, v_net_total, v_sale_date
    FROM public.sales s
    WHERE s.store_id = p_store_id
      AND s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled','refunded','returned')
      AND ABS(s.net_total - v_tx.amount) < 0.01
      AND ABS(s.sale_date::date - v_tx.transaction_date) <= 3
    ORDER BY ABS(s.sale_date::date - v_tx.transaction_date)
    LIMIT 1;

    IF v_best_id IS NOT NULL THEN
      v_amt_diff   := ABS(v_net_total - v_tx.amount);
      v_date_diff  := ABS(v_sale_date - v_tx.transaction_date);
      v_best_score := LEAST(100, 95 + (3 - v_date_diff) * 1.5);
      v_match_type := 'deterministic';
    END IF;

    -- Pass 2: Heurístico
    IF v_best_id IS NULL THEN
      SELECT s.id, s.net_total, s.sale_date::date
      INTO v_best_id, v_net_total, v_sale_date
      FROM public.sales s
      WHERE s.store_id = p_store_id
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND ABS(s.net_total - v_tx.amount) <= v_tol5
        AND ABS(s.sale_date::date - v_tx.transaction_date) <= 7
      ORDER BY ABS(s.net_total - v_tx.amount), ABS(s.sale_date::date - v_tx.transaction_date)
      LIMIT 1;

      IF v_best_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_net_total - v_tx.amount);
        v_date_diff  := ABS(v_sale_date - v_tx.transaction_date);
        v_best_score := GREATEST(70, LEAST(88,
          88 - (v_amt_diff / NULLIF(v_tx.amount, 0) * 200) - (v_date_diff * 2)
        ));
        v_match_type := 'heuristic';
      END IF;
    END IF;

    -- Pass 3: Fuzzy
    IF v_best_id IS NULL THEN
      SELECT s.id, s.net_total, s.sale_date::date
      INTO v_best_id, v_net_total, v_sale_date
      FROM public.sales s
      WHERE s.store_id = p_store_id
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND ABS(s.net_total - v_tx.amount) <= v_tol15
        AND ABS(s.sale_date::date - v_tx.transaction_date) <= 14
      ORDER BY ABS(s.net_total - v_tx.amount), ABS(s.sale_date::date - v_tx.transaction_date)
      LIMIT 1;

      IF v_best_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_net_total - v_tx.amount);
        v_date_diff  := ABS(v_sale_date - v_tx.transaction_date);
        v_best_score := GREATEST(40, LEAST(69,
          65 - (v_amt_diff / NULLIF(v_tx.amount, 0) * 100) - (v_date_diff * 1.5)
        ));
        v_match_type := 'fuzzy';
      END IF;
    END IF;

    IF v_best_id IS NOT NULL THEN
      INSERT INTO public.reconciliation_matches (
        store_id, bank_transaction_id, sale_id,
        match_type, confidence_score,
        amount_difference, date_difference_days, match_reason, status
      ) VALUES (
        p_store_id, v_tx.id, v_best_id,
        v_match_type, round(v_best_score::numeric, 0),
        v_amt_diff, v_date_diff,
        CASE v_match_type
          WHEN 'deterministic' THEN 'Valor exato e data correspondente'
          WHEN 'heuristic'     THEN 'Valor e data dentro da tolerância configurada'
          ELSE                      'Correspondência aproximada por similaridade'
        END,
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
$$;

GRANT EXECUTE ON FUNCTION public.connect_run_matching(UUID) TO authenticated;

-- =====================================================================
-- 4. DASHBOARD KPIs — todos os indicadores em 1 chamada
-- =====================================================================
CREATE OR REPLACE FUNCTION public.connect_get_dashboard_kpis(p_store_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      DATE := CURRENT_DATE;
  v_month_start DATE := date_trunc('month', CURRENT_DATE)::date;
  v_total      BIGINT;
  v_reconciled BIGINT;
  v_result     jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager','finance','viewer')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE bt.status = 'reconciled')
  INTO v_total, v_reconciled
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id;

  SELECT jsonb_build_object(
    'received_today', COALESCE((
      SELECT SUM(bt.amount) FROM public.bank_transactions bt
      WHERE bt.store_id = p_store_id
        AND bt.transaction_date = v_today
        AND bt.transaction_type = 'credit'
        AND bt.status = 'reconciled'
    ), 0),
    'received_month', COALESCE((
      SELECT SUM(bt.amount) FROM public.bank_transactions bt
      WHERE bt.store_id = p_store_id
        AND bt.transaction_date >= v_month_start
        AND bt.transaction_type = 'credit'
        AND bt.status IN ('reconciled','pending')
    ), 0),
    'auto_reconciled', COALESCE((
      SELECT COUNT(*) FROM public.reconciliation_matches rm
      WHERE rm.store_id = p_store_id
        AND rm.status = 'confirmed'
        AND rm.match_type IN ('deterministic','heuristic')
    ), 0),
    'pending_reconciliation', COALESCE((
      SELECT COUNT(*) FROM public.reconciliation_matches rm
      WHERE rm.store_id = p_store_id
        AND rm.status = 'pending'
    ), 0),
    'divergent', COALESCE((
      SELECT COUNT(*) FROM public.bank_transactions bt
      WHERE bt.store_id = p_store_id AND bt.status = 'divergent'
    ), 0),
    'banks_connected', COALESCE((
      SELECT COUNT(*) FROM public.bank_connections bc
      WHERE bc.store_id = p_store_id
        AND bc.status = 'connected'
        AND bc.is_active = true
    ), 0),
    'last_sync', (
      SELECT MAX(bc.last_sync_at)
      FROM public.bank_connections bc
      WHERE bc.store_id = p_store_id AND bc.is_active = true
    ),
    'total_transactions', v_total,
    'reconciled_count',   v_reconciled,
    'reconciliation_rate', CASE
      WHEN v_total > 0 THEN round(v_reconciled::numeric / v_total * 100, 1)
      ELSE 0
    END
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_get_dashboard_kpis(UUID) TO authenticated;

-- =====================================================================
-- 5. Busca de vendas para conciliação manual
--    Retorna vendas próximas ao valor/data informados
-- =====================================================================
CREATE OR REPLACE FUNCTION public.connect_search_sales_for_match(
  p_store_id   UUID,
  p_amount     NUMERIC DEFAULT NULL,
  p_date       DATE    DEFAULT NULL,
  p_query      TEXT    DEFAULT NULL,
  p_limit      INTEGER DEFAULT 20
)
RETURNS TABLE (
  id           UUID,
  sale_number  TEXT,
  sale_date    DATE,
  net_total    NUMERIC,
  customer_name TEXT,
  payment_status TEXT,
  amount_diff  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.id::text,
    s.sale_date::date,
    s.net_total,
    COALESCE(c.name, s.notes, 'Cliente não identificado'),
    s.payment_status,
    CASE WHEN p_amount IS NOT NULL THEN ABS(s.net_total - p_amount) ELSE NULL END
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  WHERE s.store_id = p_store_id
    AND s.deleted_at IS NULL
    AND s.status NOT IN ('cancelled','refunded','returned')
    AND (
      p_amount IS NULL OR ABS(s.net_total - p_amount) <= p_amount * 0.20
    )
    AND (
      p_date IS NULL OR ABS(s.sale_date::date - p_date) <= 30
    )
    AND (
      p_query IS NULL
      OR c.name ILIKE '%' || p_query || '%'
      OR s.notes ILIKE '%' || p_query || '%'
    )
  ORDER BY
    CASE WHEN p_amount IS NOT NULL THEN ABS(s.net_total - p_amount) ELSE 0 END,
    CASE WHEN p_date IS NOT NULL THEN ABS(s.sale_date::date - p_date) ELSE 0 END,
    s.sale_date DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.connect_search_sales_for_match(UUID, NUMERIC, DATE, TEXT, INTEGER) TO authenticated;
