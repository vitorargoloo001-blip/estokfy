-- =====================================================================
-- Connect Block 5 — Previsão de fluxo de caixa + filtro por confiança
-- =====================================================================

-- ── 1. RPC: get_cashflow_forecast ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_cashflow_forecast(
  p_store_id UUID
)
RETURNS TABLE(
  -- Hoje
  confirmed_today      NUMERIC,
  probable_today       NUMERIC,
  at_risk_today        NUMERIC,
  -- 7 dias
  confirmed_7d         NUMERIC,
  probable_7d          NUMERIC,
  at_risk_7d           NUMERIC,
  -- 30 dias
  confirmed_30d        NUMERIC,
  probable_30d         NUMERIC,
  at_risk_30d          NUMERIC,
  -- Histórico para gráfico (últimos 30d + próximos 7d)
  daily_forecast       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmed_today   NUMERIC := 0;
  v_probable_today    NUMERIC := 0;
  v_at_risk_today     NUMERIC := 0;
  v_confirmed_7d      NUMERIC := 0;
  v_probable_7d       NUMERIC := 0;
  v_at_risk_7d        NUMERIC := 0;
  v_confirmed_30d     NUMERIC := 0;
  v_probable_30d      NUMERIC := 0;
  v_at_risk_30d       NUMERIC := 0;
  v_daily_avg         NUMERIC := 0;
  v_forecast_json     JSONB   := '[]';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- ── Confirmado (transações bancárias conciliadas) ──────────────────
  -- Hoje
  SELECT COALESCE(SUM(bt.amount), 0) INTO v_confirmed_today
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND bt.transaction_type = 'credit'
    AND bt.transaction_date = CURRENT_DATE
    AND bt.status = 'reconciled';

  -- 7 dias
  SELECT COALESCE(SUM(bt.amount), 0) INTO v_confirmed_7d
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND bt.transaction_type = 'credit'
    AND bt.transaction_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 6
    AND bt.status = 'reconciled';

  -- 30 dias
  SELECT COALESCE(SUM(bt.amount), 0) INTO v_confirmed_30d
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND bt.transaction_type = 'credit'
    AND bt.transaction_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 29
    AND bt.status = 'reconciled';

  -- ── Provável (vendas pendentes com vencimento futuro) ──────────────
  -- Hoje
  SELECT COALESCE(SUM(s.net_total), 0) INTO v_probable_today
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.payment_status IN ('pending', 'partial')
    AND s.sale_date = CURRENT_DATE;

  -- 7 dias (vendas pendentes dos próximos 7 dias)
  SELECT COALESCE(SUM(s.net_total), 0) INTO v_probable_7d
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.payment_status IN ('pending', 'partial')
    AND s.sale_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 6;

  -- 30 dias (vendas pendentes + projeção baseada na média diária dos últimos 30d)
  SELECT COALESCE(SUM(s.net_total) / 30.0, 0) INTO v_daily_avg
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.sale_date >= CURRENT_DATE - 30
    AND s.payment_status = 'paid';

  SELECT COALESCE(SUM(s.net_total), 0) + (v_daily_avg * 30) INTO v_probable_30d
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.payment_status IN ('pending', 'partial')
    AND s.sale_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 29;

  -- ── Em risco (vendas vencidas sem pagamento) ───────────────────────
  -- Hoje
  SELECT COALESCE(SUM(s.net_total), 0) INTO v_at_risk_today
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.payment_status IN ('pending', 'partial')
    AND s.sale_date < CURRENT_DATE;

  -- 7 dias (mesmas vendas em risco continuam)
  v_at_risk_7d := v_at_risk_today;

  -- 30 dias
  SELECT COALESCE(SUM(s.net_total), 0) INTO v_at_risk_30d
  FROM public.sales s
  WHERE s.store_id = p_store_id
    AND s.payment_status IN ('pending', 'partial')
    AND s.sale_date < CURRENT_DATE;

  -- ── Séries diárias para gráfico (30 dias histórico + 7 dias projeção) ─
  SELECT jsonb_agg(row_to_json(d) ORDER BY d.date)
  INTO v_forecast_json
  FROM (
    -- Histórico: entradas bancárias reais conciliadas
    SELECT
      bt.transaction_date::TEXT AS date,
      SUM(bt.amount)            AS confirmed,
      0                         AS probable,
      0                         AS at_risk,
      'historical'              AS source
    FROM public.bank_transactions bt
    WHERE bt.store_id = p_store_id
      AND bt.transaction_type = 'credit'
      AND bt.transaction_date >= CURRENT_DATE - 30
      AND bt.transaction_date <= CURRENT_DATE
      AND bt.status = 'reconciled'
    GROUP BY bt.transaction_date

    UNION ALL

    -- Projeção: vendas pendentes nos próximos 7 dias
    SELECT
      s.sale_date::TEXT AS date,
      0                 AS confirmed,
      SUM(s.net_total)  AS probable,
      0                 AS at_risk,
      'forecast'        AS source
    FROM public.sales s
    WHERE s.store_id = p_store_id
      AND s.payment_status IN ('pending', 'partial')
      AND s.sale_date > CURRENT_DATE
      AND s.sale_date <= CURRENT_DATE + 7
    GROUP BY s.sale_date
  ) d;

  RETURN QUERY SELECT
    v_confirmed_today, v_probable_today, v_at_risk_today,
    v_confirmed_7d,    v_probable_7d,    v_at_risk_7d,
    v_confirmed_30d,   v_probable_30d,   v_at_risk_30d,
    COALESCE(v_forecast_json, '[]'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cashflow_forecast(UUID) TO authenticated;

-- ── 2. RPC: get_pending_matches_by_confidence ─────────────────────────
-- Filtra transações pendentes por nível de confiança

CREATE OR REPLACE FUNCTION public.get_pending_matches_by_confidence(
  p_store_id          UUID,
  p_confidence_level  TEXT    DEFAULT NULL, -- 'high' | 'medium' | 'low' | NULL = todos
  p_limit             INTEGER DEFAULT 200
)
RETURNS TABLE(
  id                       UUID,
  bank_transaction_id      UUID,
  transaction_date         DATE,
  transaction_amount       NUMERIC,
  transaction_description  TEXT,
  bank_name                TEXT,
  method                   TEXT,
  suggested_sale_id        UUID,
  sale_date                DATE,
  sale_amount              NUMERIC,
  customer_name            TEXT,
  customer_phone           TEXT,
  confidence_score         INTEGER,
  confidence_level         TEXT,
  match_type               TEXT,
  amount_difference        NUMERIC,
  date_difference_days     INTEGER,
  match_reason             TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT
    rm.id,
    rm.bank_transaction_id,
    bt.transaction_date,
    bt.amount                    AS transaction_amount,
    bt.description               AS transaction_description,
    bt.bank_name,
    bt.method,
    rm.suggested_sale_id,
    s.sale_date,
    s.net_total                  AS sale_amount,
    c.name                       AS customer_name,
    c.phone                      AS customer_phone,
    rm.match_score               AS confidence_score,
    CASE
      WHEN rm.match_score >= 85 THEN 'high'
      WHEN rm.match_score >= 60 THEN 'medium'
      ELSE 'low'
    END                          AS confidence_level,
    rm.match_type,
    rm.amount_difference,
    rm.date_difference_days,
    rm.match_reason
  FROM public.reconciliation_matches rm
  JOIN public.bank_transactions bt ON bt.id = rm.bank_transaction_id
  LEFT JOIN public.sales     s  ON s.id = rm.suggested_sale_id
  LEFT JOIN public.customers c  ON c.id = s.customer_id
  WHERE rm.store_id = p_store_id
    AND rm.status = 'pending'
    AND (
      p_confidence_level IS NULL
      OR (p_confidence_level = 'high'   AND rm.match_score >= 85)
      OR (p_confidence_level = 'medium' AND rm.match_score >= 60 AND rm.match_score < 85)
      OR (p_confidence_level = 'low'    AND rm.match_score < 60)
    )
  ORDER BY rm.match_score DESC, bt.transaction_date DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_matches_by_confidence(UUID, TEXT, INTEGER)
  TO authenticated;

-- ── 3. RPC: bulk_confirm_reconciliation ──────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_confirm_reconciliation(
  p_store_id   UUID,
  p_match_ids  UUID[]
)
RETURNS TABLE(
  confirmed_count  INTEGER,
  failed_ids       UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmed INTEGER := 0;
  v_failed    UUID[]  := '{}';
  v_match_id  UUID;
  v_profile   UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT id INTO v_profile FROM public.profiles
  WHERE auth_user_id = auth.uid() LIMIT 1;

  FOREACH v_match_id IN ARRAY p_match_ids LOOP
    BEGIN
      UPDATE public.reconciliation_matches
      SET
        status       = 'confirmed',
        confirmed_by = v_profile,
        confirmed_at = NOW(),
        updated_at   = NOW()
      WHERE id = v_match_id
        AND store_id = p_store_id
        AND status = 'pending';

      IF FOUND THEN
        -- Atualizar status da transação bancária
        UPDATE public.bank_transactions bt
        SET status = 'reconciled', updated_at = NOW()
        FROM public.reconciliation_matches rm
        WHERE rm.id = v_match_id
          AND bt.id = rm.bank_transaction_id;

        -- Atualizar status da venda vinculada se houver
        UPDATE public.sales s
        SET payment_status = 'paid', updated_at = NOW()
        FROM public.reconciliation_matches rm
        WHERE rm.id = v_match_id
          AND s.id = rm.suggested_sale_id
          AND rm.suggested_sale_id IS NOT NULL
          AND s.payment_status = 'pending';

        v_confirmed := v_confirmed + 1;
      ELSE
        v_failed := v_failed || v_match_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || v_match_id;
    END;
  END LOOP;

  RETURN QUERY SELECT v_confirmed, v_failed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_confirm_reconciliation(UUID, UUID[]) TO authenticated;

-- ── 4. RPC: bulk_ignore_reconciliation ───────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_ignore_reconciliation(
  p_store_id  UUID,
  p_match_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE public.reconciliation_matches
  SET status = 'ignored', updated_at = NOW()
  WHERE id = ANY(p_match_ids)
    AND store_id = p_store_id
    AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_ignore_reconciliation(UUID, UUID[]) TO authenticated;
