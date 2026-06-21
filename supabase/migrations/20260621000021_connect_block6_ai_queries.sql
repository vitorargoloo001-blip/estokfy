-- Block 6: Sistema de perguntas em linguagem natural com respostas baseadas em dados reais

-- ── Tabela de perguntas e respostas ──────────────────────────────────

CREATE TABLE IF NOT EXISTS connect_ai_queries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id),
  question_key  TEXT        NOT NULL,
  question_text TEXT        NOT NULL,
  answer_text   TEXT,
  answer_data   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_queries_store_created
  ON connect_ai_queries (store_id, created_at DESC);

ALTER TABLE connect_ai_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_ai_queries"
  ON connect_ai_queries
  USING (store_id = (SELECT store_id FROM profiles WHERE id = auth.uid()));

-- ── Mapeamento de question_key → texto da pergunta ────────────────────

CREATE OR REPLACE FUNCTION _ai_query_question_text(p_key TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_key
    WHEN 'quanto_entrou_hoje'          THEN 'Quanto entrou hoje?'
    WHEN 'quanto_entrou_mes'           THEN 'Quanto entrou este mês?'
    WHEN 'qual_banco_mais_movimentou'  THEN 'Qual banco movimentou mais?'
    WHEN 'qual_metodo_mais_vende'      THEN 'Qual método de pagamento vende mais?'
    WHEN 'quanto_conciliado_auto'      THEN 'Quanto foi conciliado automaticamente?'
    WHEN 'quantas_divergencias'        THEN 'Quantas divergências existem?'
    WHEN 'quem_deve_mais'              THEN 'Quem está me devendo mais?'
    WHEN 'maior_cliente'               THEN 'Qual meu maior cliente?'
    WHEN 'previsao_30_dias'            THEN 'Qual minha previsão para os próximos 30 dias?'
    ELSE p_key
  END;
$$;

-- ── RPC principal: responde pergunta com dados reais ──────────────────

CREATE OR REPLACE FUNCTION answer_financial_question(
  p_store_id    UUID,
  p_question_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_answer_text  TEXT;
  v_answer_data  JSONB;
  v_amount       NUMERIC;
  v_amount2      NUMERIC;
  v_count        BIGINT;
  v_name         TEXT;
  v_method       TEXT;
  v_method_label TEXT;
  v_pct          NUMERIC;
  v_store_ok     UUID;

  METHOD_LABELS  CONSTANT TEXT[] := ARRAY[
    'pix','PIX','ted','TED','doc','DOC','boleto','Boleto',
    'credit_card','Cartão de Crédito','debit_card','Cartão de Débito',
    'money','Dinheiro','card','Cartão','other','Outro'
  ];
BEGIN
  -- Verificar isolamento: usuário pertence a esta loja
  SELECT store_id INTO v_store_ok FROM profiles WHERE id = auth.uid() LIMIT 1;
  IF v_store_ok IS DISTINCT FROM p_store_id THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  CASE p_question_key

    -- ── Quanto entrou hoje ──────────────────────────────────────────
    WHEN 'quanto_entrou_hoje' THEN
      SELECT COALESCE(SUM(amount), 0), COUNT(*)
        INTO v_amount, v_count
        FROM bank_transactions
        WHERE store_id = p_store_id
          AND transaction_date = CURRENT_DATE;
      IF v_count = 0 THEN
        v_answer_text := 'Não há registros de recebimento bancário para hoje ainda.';
      ELSE
        v_answer_text := format(
          'Hoje entraram R$ %s em %s transação(ões) bancária(s).',
          to_char(v_amount, 'FM999G999G990D00'), v_count
        );
      END IF;
      v_answer_data := jsonb_build_object('total', v_amount, 'count', v_count, 'date', CURRENT_DATE);

    -- ── Quanto entrou este mês ──────────────────────────────────────
    WHEN 'quanto_entrou_mes' THEN
      SELECT COALESCE(SUM(amount), 0), COUNT(*)
        INTO v_amount, v_count
        FROM bank_transactions
        WHERE store_id = p_store_id
          AND transaction_date >= date_trunc('month', CURRENT_DATE);
      IF v_count = 0 THEN
        v_answer_text := 'Nenhuma transação bancária registrada este mês ainda.';
      ELSE
        v_answer_text := format(
          'Este mês entrou R$ %s em %s transação(ões) bancária(s).',
          to_char(v_amount, 'FM999G999G990D00'), v_count
        );
      END IF;
      v_answer_data := jsonb_build_object('total', v_amount, 'count', v_count,
        'month', to_char(CURRENT_DATE, 'MM/YYYY'));

    -- ── Qual banco movimentou mais ──────────────────────────────────
    WHEN 'qual_banco_mais_movimentou' THEN
      SELECT bank_name, SUM(amount), COUNT(*)
        INTO v_name, v_amount, v_count
        FROM bank_transactions
        WHERE store_id       = p_store_id
          AND transaction_date >= CURRENT_DATE - 30
        GROUP BY bank_name
        ORDER BY SUM(amount) DESC
        LIMIT 1;
      IF v_name IS NULL THEN
        v_answer_text := 'Nenhum banco com transações nos últimos 30 dias.';
      ELSE
        v_answer_text := format(
          '%s foi o banco que mais movimentou nos últimos 30 dias: R$ %s em %s transações.',
          v_name, to_char(v_amount, 'FM999G999G990D00'), v_count
        );
      END IF;
      v_answer_data := jsonb_build_object('bank', v_name, 'total', v_amount, 'count', v_count, 'period_days', 30);

    -- ── Qual método de pagamento vende mais ─────────────────────────
    WHEN 'qual_metodo_mais_vende' THEN
      SELECT p.method, SUM(p.amount), COUNT(*)
        INTO v_method, v_amount, v_count
        FROM payments p
        JOIN sales s ON s.id = p.sale_id
          AND s.store_id = p_store_id AND s.deleted_at IS NULL
          AND s.created_at >= date_trunc('month', CURRENT_DATE)
        GROUP BY p.method
        ORDER BY SUM(p.amount) DESC
        LIMIT 1;
      IF v_method IS NULL THEN
        v_answer_text := 'Nenhuma venda registrada este mês ainda.';
      ELSE
        v_method_label := CASE v_method
          WHEN 'pix' THEN 'PIX'
          WHEN 'ted' THEN 'TED'
          WHEN 'boleto' THEN 'Boleto'
          WHEN 'credit_card' THEN 'Cartão de Crédito'
          WHEN 'debit_card' THEN 'Cartão de Débito'
          WHEN 'money' THEN 'Dinheiro'
          WHEN 'card' THEN 'Cartão'
          ELSE initcap(v_method)
        END;
        v_answer_text := format(
          '%s é o método que mais vendeu este mês: R$ %s em %s transação(ões).',
          v_method_label, to_char(v_amount, 'FM999G999G990D00'), v_count
        );
      END IF;
      v_answer_data := jsonb_build_object('method', v_method, 'total', v_amount, 'count', v_count);

    -- ── Quanto foi conciliado automaticamente ───────────────────────
    WHEN 'quanto_conciliado_auto' THEN
      SELECT COUNT(*) FILTER (WHERE match_type = 'automatic' AND status = 'confirmed'),
             COUNT(*) FILTER (WHERE status = 'confirmed')
        INTO v_count, v_count
        FROM reconciliation_matches
        WHERE store_id = p_store_id;
      -- redo properly
      SELECT
        COALESCE(SUM(bt.amount) FILTER (WHERE rm.match_type = 'automatic' AND rm.status = 'confirmed'), 0),
        COUNT(*) FILTER (WHERE rm.match_type = 'automatic' AND rm.status = 'confirmed')
        INTO v_amount, v_count
        FROM reconciliation_matches rm
        JOIN bank_transactions bt ON bt.id = rm.bank_transaction_id
        WHERE rm.store_id = p_store_id;
      SELECT ROUND((COUNT(*) FILTER (WHERE match_type = 'automatic')::NUMERIC /
             NULLIF(COUNT(*) FILTER (WHERE status = 'confirmed'), 0) * 100)::NUMERIC, 1)
        INTO v_pct
        FROM reconciliation_matches
        WHERE store_id = p_store_id AND status = 'confirmed';
      IF v_count = 0 THEN
        v_answer_text := 'Nenhuma conciliação automática registrada ainda.';
      ELSE
        v_answer_text := format(
          '%s transação(ões) conciliada(s) automaticamente (R$ %s) — %s%% do total conciliado.',
          v_count, to_char(v_amount, 'FM999G999G990D00'), COALESCE(v_pct, 0)
        );
      END IF;
      v_answer_data := jsonb_build_object('auto_count', v_count, 'auto_amount', v_amount, 'auto_pct', v_pct);

    -- ── Quantas divergências existem ────────────────────────────────
    WHEN 'quantas_divergencias' THEN
      SELECT COUNT(*), COALESCE(SUM(amount), 0)
        INTO v_count, v_amount
        FROM bank_transactions
        WHERE store_id = p_store_id AND status = 'divergent';
      IF v_count = 0 THEN
        v_answer_text := 'Não há divergências abertas. Ótimo!';
      ELSE
        v_answer_text := format(
          'Existem %s divergência(s) abertas totalizando R$ %s.',
          v_count, to_char(v_amount, 'FM999G999G990D00')
        );
      END IF;
      v_answer_data := jsonb_build_object('count', v_count, 'amount', v_amount);

    -- ── Quem deve mais ──────────────────────────────────────────────
    WHEN 'quem_deve_mais' THEN
      SELECT c.name, SUM(s.amount_pending), COUNT(*)
        INTO v_name, v_amount, v_count
        FROM sales s
        JOIN customers c ON c.id = s.customer_id
        WHERE s.store_id       = p_store_id
          AND s.deleted_at     IS NULL
          AND s.payment_status IN ('pending','partial')
          AND s.amount_pending > 0
        GROUP BY c.id, c.name
        ORDER BY SUM(s.amount_pending) DESC
        LIMIT 1;
      IF v_name IS NULL THEN
        v_answer_text := 'Não há clientes com pagamentos pendentes. Excelente!';
      ELSE
        v_answer_text := format(
          '%s é o cliente com maior débito: R$ %s em %s venda(s) pendente(s).',
          v_name, to_char(v_amount, 'FM999G999G990D00'), v_count
        );
      END IF;
      v_answer_data := jsonb_build_object('customer', v_name, 'pending_amount', v_amount, 'pending_sales', v_count);

    -- ── Maior cliente ───────────────────────────────────────────────
    WHEN 'maior_cliente' THEN
      SELECT c.name, SUM(s.net_total), COUNT(*)
        INTO v_name, v_amount, v_count
        FROM sales s
        JOIN customers c ON c.id = s.customer_id
        WHERE s.store_id   = p_store_id
          AND s.deleted_at IS NULL
          AND s.created_at >= date_trunc('month', CURRENT_DATE)
        GROUP BY c.id, c.name
        ORDER BY SUM(s.net_total) DESC
        LIMIT 1;
      IF v_name IS NULL THEN
        v_answer_text := 'Nenhuma venda com cliente registrada este mês.';
      ELSE
        v_answer_text := format(
          '%s é o maior cliente deste mês: R$ %s em %s compra(s).',
          v_name, to_char(v_amount, 'FM999G999G990D00'), v_count
        );
      END IF;
      v_answer_data := jsonb_build_object('customer', v_name, 'total', v_amount, 'sales_count', v_count);

    -- ── Previsão 30 dias ────────────────────────────────────────────
    WHEN 'previsao_30_dias' THEN
      -- Banco: média diária 30d × 30
      SELECT COALESCE(SUM(amount), 0) / GREATEST(COUNT(DISTINCT transaction_date), 1) * 30
        INTO v_amount
        FROM bank_transactions
        WHERE store_id       = p_store_id
          AND transaction_date >= CURRENT_DATE - 30;
      -- Pendente a vencer
      SELECT COALESCE(SUM(amount_pending), 0)
        INTO v_amount2
        FROM sales
        WHERE store_id       = p_store_id
          AND deleted_at     IS NULL
          AND payment_status IN ('pending','partial')
          AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30;
      v_answer_text := format(
        'Previsão para os próximos 30 dias: R$ %s (projeção baseada na média bancária) + R$ %s em vendas a receber = total estimado R$ %s.',
        to_char(v_amount, 'FM999G999G990D00'),
        to_char(v_amount2, 'FM999G999G990D00'),
        to_char(v_amount + v_amount2, 'FM999G999G990D00')
      );
      v_answer_data := jsonb_build_object(
        'bank_projection', v_amount,
        'pending_receivables', v_amount2,
        'total_forecast', v_amount + v_amount2
      );

    ELSE
      v_answer_text := 'Pergunta não reconhecida.';
      v_answer_data := jsonb_build_object('error', 'unknown_question_key');
  END CASE;

  -- Registrar no histórico
  INSERT INTO connect_ai_queries (store_id, user_id, question_key, question_text, answer_text, answer_data)
  VALUES (
    p_store_id,
    auth.uid(),
    p_question_key,
    _ai_query_question_text(p_question_key),
    v_answer_text,
    v_answer_data
  );

  RETURN jsonb_build_object(
    'question_key',   p_question_key,
    'question_text',  _ai_query_question_text(p_question_key),
    'answer_text',    v_answer_text,
    'answer_data',    v_answer_data,
    'answered_at',    now()
  );
END;
$$;

REVOKE ALL ON FUNCTION answer_financial_question(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION answer_financial_question(UUID, TEXT) TO authenticated;

-- ── Histórico de perguntas ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_ai_query_history(
  p_store_id UUID,
  p_limit    INTEGER DEFAULT 20
)
RETURNS TABLE (
  id            UUID,
  question_key  TEXT,
  question_text TEXT,
  answer_text   TEXT,
  answer_data   JSONB,
  created_at    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
SELECT id, question_key, question_text, answer_text, answer_data, created_at
FROM connect_ai_queries
WHERE store_id = p_store_id
ORDER BY created_at DESC
LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION get_ai_query_history(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_ai_query_history(UUID, INTEGER) TO authenticated;
