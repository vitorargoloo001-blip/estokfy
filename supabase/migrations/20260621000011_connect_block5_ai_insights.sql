-- =====================================================================
-- Connect Block 5 — IA Financeira: insights automáticos
-- =====================================================================

-- ── 1. Tabela connect_ai_insights ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.connect_ai_insights (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL CHECK (insight_type IN (
                  'suspicious_receipt',
                  'duplicate_payment',
                  'sales_drop',
                  'delinquency_increase',
                  'frequent_divergence',
                  'webhook_stale',
                  'bank_disconnected',
                  'high_pending_volume'
                )),
  severity     TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical', 'warning', 'info')),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  suggestion   TEXT,
  data         JSONB DEFAULT '{}',
  entity_type  TEXT,
  entity_id    UUID,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

ALTER TABLE public.connect_ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY connect_ai_insights_store ON public.connect_ai_insights
  FOR ALL USING (
    store_id IN (
      SELECT store_id FROM public.profiles WHERE auth_user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_connect_ai_insights_store
  ON public.connect_ai_insights(store_id, is_dismissed, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connect_ai_insights_type
  ON public.connect_ai_insights(store_id, insight_type, created_at DESC);

-- ── 2. RPC: detect_ai_insights ────────────────────────────────────────
-- Motor de detecção automática. Retorna número de insights criados.

CREATE OR REPLACE FUNCTION public.detect_ai_insights(
  p_store_id UUID
)
RETURNS TABLE(
  insights_created  INTEGER,
  insights_types    TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count      INTEGER := 0;
  v_types      TEXT[]  := '{}';
  v_avg_amount NUMERIC;
  v_std_amount NUMERIC;
  v_drop_pct   NUMERIC;
  v_delq_now   NUMERIC;
  v_delq_prev  NUMERIC;
  v_div_rate   NUMERIC;
  v_pending_ct BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Expirar insights antigos
  UPDATE public.connect_ai_insights
  SET is_dismissed = TRUE, dismissed_at = NOW()
  WHERE store_id = p_store_id
    AND expires_at IS NOT NULL
    AND expires_at < NOW()
    AND is_dismissed = FALSE;

  -- ── A. Recebimentos suspeitos (valor > média + 2.5σ) ─────────────────
  SELECT AVG(amount), STDDEV(amount)
  INTO v_avg_amount, v_std_amount
  FROM public.bank_transactions
  WHERE store_id = p_store_id
    AND transaction_type = 'credit'
    AND created_at >= NOW() - INTERVAL '90 days';

  IF v_avg_amount IS NOT NULL AND v_std_amount > 0 THEN
    WITH suspects AS (
      SELECT bt.id, bt.amount, bt.transaction_date, bt.description, bc.bank_name
      FROM public.bank_transactions bt
      JOIN public.bank_connections bc ON bc.id = bt.bank_connection_id
      WHERE bt.store_id = p_store_id
        AND bt.transaction_type = 'credit'
        AND bt.amount > v_avg_amount + (2.5 * v_std_amount)
        AND bt.created_at >= NOW() - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1 FROM public.connect_ai_insights ai
          WHERE ai.store_id = p_store_id
            AND ai.insight_type = 'suspicious_receipt'
            AND ai.entity_id = bt.id
            AND ai.is_dismissed = FALSE
        )
    )
    INSERT INTO public.connect_ai_insights (
      store_id, insight_type, severity, title, description, suggestion,
      data, entity_type, entity_id, expires_at
    )
    SELECT
      p_store_id,
      'suspicious_receipt',
      'warning',
      'Recebimento com valor incomum',
      'Transação de ' || TO_CHAR(s.amount, 'FM"R$"999G999G990D00') ||
        ' em ' || TO_CHAR(s.transaction_date, 'DD/MM/YYYY') ||
        ' está acima da média histórica (' ||
        TO_CHAR(v_avg_amount, 'FM"R$"999G999G990D00') || ').',
      'Verifique se esse recebimento corresponde a uma venda registrada no sistema.',
      jsonb_build_object('amount', s.amount, 'avg', v_avg_amount, 'sigma', v_std_amount,
                         'description', s.description, 'bank', s.bank_name),
      'bank_transaction',
      s.id,
      NOW() + INTERVAL '7 days'
    FROM suspects s;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN v_types := v_types || ARRAY['suspicious_receipt']; END IF;
  END IF;

  -- ── B. Pagamentos duplicados (mesmo valor + método + ±24h) ───────────
  WITH dups AS (
    SELECT
      bt1.id AS id1,
      bt1.amount,
      bt1.method,
      bt1.transaction_date
    FROM public.bank_transactions bt1
    WHERE bt1.store_id = p_store_id
      AND bt1.transaction_type = 'credit'
      AND bt1.created_at >= NOW() - INTERVAL '30 days'
      AND EXISTS (
        SELECT 1 FROM public.bank_transactions bt2
        WHERE bt2.store_id = p_store_id
          AND bt2.id <> bt1.id
          AND bt2.amount = bt1.amount
          AND bt2.method = bt1.method
          AND ABS(bt2.transaction_date - bt1.transaction_date) <= 1
          AND bt2.transaction_type = 'credit'
          AND bt2.created_at >= NOW() - INTERVAL '30 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.connect_ai_insights ai
        WHERE ai.store_id = p_store_id
          AND ai.insight_type = 'duplicate_payment'
          AND ai.entity_id = bt1.id
          AND ai.is_dismissed = FALSE
      )
    LIMIT 5
  )
  INSERT INTO public.connect_ai_insights (
    store_id, insight_type, severity, title, description, suggestion,
    data, entity_type, entity_id, expires_at
  )
  SELECT
    p_store_id,
    'duplicate_payment',
    'critical',
    'Possível pagamento duplicado',
    'Transação de ' || TO_CHAR(d.amount, 'FM"R$"999G999G990D00') ||
      ' via ' || d.method || ' em ' || TO_CHAR(d.transaction_date, 'DD/MM/YYYY') ||
      ' parece duplicada — mesmo valor e método em datas próximas.',
    'Verifique se não houve cobranças em duplicidade e conteste com o banco se necessário.',
    jsonb_build_object('amount', d.amount, 'method', d.method, 'date', d.transaction_date),
    'bank_transaction',
    d.id1,
    NOW() + INTERVAL '14 days'
  FROM dups d;

  v_count := v_count + (SELECT COUNT(*) FROM connect_ai_insights
    WHERE store_id = p_store_id AND insight_type = 'duplicate_payment'
      AND created_at > NOW() - INTERVAL '1 minute');
  IF EXISTS (
    SELECT 1 FROM connect_ai_insights
    WHERE store_id = p_store_id AND insight_type = 'duplicate_payment'
      AND created_at > NOW() - INTERVAL '1 minute'
  ) THEN
    v_types := v_types || ARRAY['duplicate_payment'];
  END IF;

  -- ── C. Queda nas vendas (semana atual vs anterior, -20%) ─────────────
  WITH week_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE s.sale_date >= CURRENT_DATE - 7) AS this_week,
      COUNT(*) FILTER (WHERE s.sale_date >= CURRENT_DATE - 14 AND s.sale_date < CURRENT_DATE - 7) AS prev_week
    FROM public.sales s
    WHERE s.store_id = p_store_id
  )
  SELECT
    CASE WHEN prev_week > 0 THEN
      ((this_week::NUMERIC - prev_week) / prev_week * 100)
    ELSE NULL END
  INTO v_drop_pct
  FROM week_counts;

  IF v_drop_pct IS NOT NULL AND v_drop_pct < -20 AND NOT EXISTS (
    SELECT 1 FROM public.connect_ai_insights
    WHERE store_id = p_store_id AND insight_type = 'sales_drop'
      AND is_dismissed = FALSE AND created_at >= NOW() - INTERVAL '3 days'
  ) THEN
    INSERT INTO public.connect_ai_insights (
      store_id, insight_type, severity, title, description, suggestion,
      data, expires_at
    ) VALUES (
      p_store_id,
      'sales_drop',
      'warning',
      'Queda nas vendas detectada',
      'As vendas desta semana caíram ' || ROUND(ABS(v_drop_pct), 1) || '% em relação à semana anterior.',
      'Revise seu estoque, preços e estratégia de vendas. Considere ações promocionais.',
      jsonb_build_object('drop_pct', v_drop_pct),
      NOW() + INTERVAL '5 days'
    );
    v_count := v_count + 1;
    v_types := v_types || ARRAY['sales_drop'];
  END IF;

  -- ── D. Aumento de inadimplência ──────────────────────────────────────
  WITH delq AS (
    SELECT
      COUNT(*) FILTER (WHERE s.sale_date >= CURRENT_DATE - 30
                         AND s.payment_status IN ('pending', 'partial')
                         AND s.sale_date < CURRENT_DATE) AS now_delq,
      COUNT(*) FILTER (WHERE s.sale_date >= CURRENT_DATE - 60
                         AND s.sale_date < CURRENT_DATE - 30
                         AND s.payment_status IN ('pending', 'partial')) AS prev_delq,
      COUNT(*) FILTER (WHERE s.sale_date >= CURRENT_DATE - 30) AS total_now
    FROM public.sales s
    WHERE s.store_id = p_store_id
  )
  SELECT
    CASE WHEN total_now > 0 THEN (now_delq::NUMERIC / total_now * 100) ELSE 0 END,
    CASE WHEN total_now > 0 THEN (prev_delq::NUMERIC / NULLIF(total_now, 0) * 100) ELSE 0 END
  INTO v_delq_now, v_delq_prev
  FROM delq;

  IF v_delq_now > 15 AND v_delq_now > v_delq_prev * 1.3 AND NOT EXISTS (
    SELECT 1 FROM public.connect_ai_insights
    WHERE store_id = p_store_id AND insight_type = 'delinquency_increase'
      AND is_dismissed = FALSE AND created_at >= NOW() - INTERVAL '5 days'
  ) THEN
    INSERT INTO public.connect_ai_insights (
      store_id, insight_type, severity, title, description, suggestion,
      data, expires_at
    ) VALUES (
      p_store_id,
      'delinquency_increase',
      'critical',
      'Aumento na inadimplência',
      'Taxa de inadimplência chegou a ' || ROUND(v_delq_now, 1) ||
        '% (era ' || ROUND(v_delq_prev, 1) || '% no período anterior).',
      'Acione clientes em atraso e revise a política de crédito da loja.',
      jsonb_build_object('rate_now', v_delq_now, 'rate_prev', v_delq_prev),
      NOW() + INTERVAL '7 days'
    );
    v_count := v_count + 1;
    v_types := v_types || ARRAY['delinquency_increase'];
  END IF;

  -- ── E. Divergências frequentes (>20% do volume) ──────────────────────
  SELECT
    CASE WHEN COUNT(*) > 0 THEN
      (COUNT(*) FILTER (WHERE bt.status = 'divergent')::NUMERIC / COUNT(*) * 100)
    ELSE 0 END
  INTO v_div_rate
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND bt.created_at >= NOW() - INTERVAL '30 days';

  IF v_div_rate > 20 AND NOT EXISTS (
    SELECT 1 FROM public.connect_ai_insights
    WHERE store_id = p_store_id AND insight_type = 'frequent_divergence'
      AND is_dismissed = FALSE AND created_at >= NOW() - INTERVAL '3 days'
  ) THEN
    INSERT INTO public.connect_ai_insights (
      store_id, insight_type, severity, title, description, suggestion,
      data, expires_at
    ) VALUES (
      p_store_id,
      'frequent_divergence',
      'warning',
      'Taxa de divergência elevada',
      ROUND(v_div_rate, 1) || '% das transações do último mês estão divergentes.',
      'Revise as regras de conciliação e verifique se há vendas não registradas no sistema.',
      jsonb_build_object('divergence_rate', v_div_rate),
      NOW() + INTERVAL '3 days'
    );
    v_count := v_count + 1;
    v_types := v_types || ARRAY['frequent_divergence'];
  END IF;

  -- ── F. Alto volume pendente (>30 TXs sem conciliação) ────────────────
  SELECT COUNT(*)
  INTO v_pending_ct
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND bt.status NOT IN ('reconciled', 'ignored')
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_matches rm
      WHERE rm.bank_transaction_id = bt.id AND rm.status IN ('confirmed', 'pending')
    );

  IF v_pending_ct >= 30 AND NOT EXISTS (
    SELECT 1 FROM public.connect_ai_insights
    WHERE store_id = p_store_id AND insight_type = 'high_pending_volume'
      AND is_dismissed = FALSE AND created_at >= NOW() - INTERVAL '24 hours'
  ) THEN
    INSERT INTO public.connect_ai_insights (
      store_id, insight_type, severity, title, description, suggestion,
      data, expires_at
    ) VALUES (
      p_store_id,
      'high_pending_volume',
      'warning',
      'Alto volume de transações sem conciliação',
      v_pending_ct || ' transações bancárias ainda não foram conciliadas.',
      'Execute a conciliação automática ou revise manualmente as pendências.',
      jsonb_build_object('pending_count', v_pending_ct),
      NOW() + INTERVAL '2 days'
    );
    v_count := v_count + 1;
    v_types := v_types || ARRAY['high_pending_volume'];
  END IF;

  RETURN QUERY SELECT v_count, v_types;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_ai_insights(UUID) TO authenticated;

-- ── 3. RPC: get_ai_insights ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_ai_insights(
  p_store_id          UUID,
  p_include_dismissed BOOLEAN DEFAULT FALSE,
  p_severity          TEXT    DEFAULT NULL,
  p_limit             INTEGER DEFAULT 50
)
RETURNS TABLE(
  id           UUID,
  insight_type TEXT,
  severity     TEXT,
  title        TEXT,
  description  TEXT,
  suggestion   TEXT,
  data         JSONB,
  entity_type  TEXT,
  entity_id    UUID,
  is_dismissed BOOLEAN,
  created_at   TIMESTAMPTZ
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
    ai.id, ai.insight_type, ai.severity, ai.title, ai.description,
    ai.suggestion, ai.data, ai.entity_type, ai.entity_id,
    ai.is_dismissed, ai.created_at
  FROM public.connect_ai_insights ai
  WHERE ai.store_id = p_store_id
    AND (p_include_dismissed OR NOT ai.is_dismissed)
    AND (p_severity IS NULL OR ai.severity = p_severity)
    AND (ai.expires_at IS NULL OR ai.expires_at > NOW())
  ORDER BY
    CASE ai.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
    ai.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_insights(UUID, BOOLEAN, TEXT, INTEGER) TO authenticated;

-- ── 4. RPC: dismiss_ai_insight ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.dismiss_ai_insight(
  p_insight_id UUID
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.connect_ai_insights
  SET is_dismissed = TRUE, dismissed_at = NOW()
  WHERE id = p_insight_id
    AND store_id IN (
      SELECT store_id FROM public.profiles WHERE auth_user_id = auth.uid()
    );

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Insight não encontrado ou acesso negado';
    RETURN;
  END IF;
  RETURN QUERY SELECT TRUE, 'Insight dispensado';
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_ai_insight(UUID) TO authenticated;

-- ── 5. RPC: dismiss_all_ai_insights ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.dismiss_all_ai_insights(
  p_store_id   UUID,
  p_severity   TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ct INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE public.connect_ai_insights
  SET is_dismissed = TRUE, dismissed_at = NOW()
  WHERE store_id = p_store_id
    AND is_dismissed = FALSE
    AND (p_severity IS NULL OR severity = p_severity);

  GET DIAGNOSTICS v_ct = ROW_COUNT;
  RETURN v_ct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_all_ai_insights(UUID, TEXT) TO authenticated;
