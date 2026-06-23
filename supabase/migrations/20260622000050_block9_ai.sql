-- ================================================================
-- BLOCK 9: Estokfy AI — Copiloto Empresarial Inteligente
-- ================================================================

-- ----------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_interactions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  intent       TEXT,
  answer       TEXT NOT NULL,
  data_sources TEXT[] DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ai_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_interactions_store" ON ai_interactions;
CREATE POLICY "ai_interactions_store" ON ai_interactions
  FOR ALL USING (store_id = get_my_store_id());

CREATE TABLE IF NOT EXISTS ai_insights (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('critico','atencao','oportunidade','informativo')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  recommendation  TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','dismissed')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_insights_store" ON ai_insights;
CREATE POLICY "ai_insights_store" ON ai_insights
  FOR ALL USING (store_id = get_my_store_id());

CREATE INDEX IF NOT EXISTS idx_ai_interactions_store ON ai_interactions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_insights_store     ON ai_insights(store_id, status, created_at DESC);

-- ----------------------------------------------------------------
-- RPC: ai_get_financial_summary
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_get_financial_summary(
  p_store_id   UUID,
  p_period_days INT DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role            TEXT := get_my_role();
  v_receita_periodo NUMERIC := 0;
  v_receita_hoje    NUMERIC := 0;
  v_receita_semana  NUMERIC := 0;
  v_a_receber       NUMERIC := 0;
  v_a_pagar         NUMERIC := 0;
  v_saldo_caixa     NUMERIC := 0;
  v_inadimplencia   NUMERIC := 0;
  v_maior_devedor   TEXT    := '';
  v_maior_valor     NUMERIC := 0;
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role NOT IN ('owner','admin','manager','finance') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  -- Receita período (pagamentos + cash_entries income)
  SELECT COALESCE(SUM(p.amount),0) INTO v_receita_periodo
  FROM payments p JOIN sales s ON s.id = p.sale_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND p.paid_at >= NOW() - (p_period_days||' days')::INTERVAL;

  SELECT v_receita_periodo + COALESCE(SUM(amount),0) INTO v_receita_periodo
  FROM cash_entries WHERE store_id = p_store_id AND entry_type = 'income'
    AND occurred_at >= NOW() - (p_period_days||' days')::INTERVAL;

  -- Receita hoje
  SELECT COALESCE(SUM(p.amount),0) INTO v_receita_hoje
  FROM payments p JOIN sales s ON s.id = p.sale_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL AND p.paid_at::DATE = CURRENT_DATE;

  SELECT v_receita_hoje + COALESCE(SUM(amount),0) INTO v_receita_hoje
  FROM cash_entries WHERE store_id = p_store_id AND entry_type = 'income'
    AND occurred_at::DATE = CURRENT_DATE;

  -- Receita semana
  SELECT COALESCE(SUM(p.amount),0) INTO v_receita_semana
  FROM payments p JOIN sales s ON s.id = p.sale_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND p.paid_at >= CURRENT_DATE - INTERVAL '7 days';

  SELECT v_receita_semana + COALESCE(SUM(amount),0) INTO v_receita_semana
  FROM cash_entries WHERE store_id = p_store_id AND entry_type = 'income'
    AND occurred_at >= CURRENT_DATE - INTERVAL '7 days';

  -- A receber
  SELECT COALESCE(SUM(amount_pending),0) INTO v_a_receber
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND payment_status IN ('pending','partial') AND amount_pending > 0;

  -- A pagar
  SELECT COALESCE(SUM(amount),0) INTO v_a_pagar
  FROM accounts_payable WHERE store_id = p_store_id AND status = 'pending';

  -- Saldo caixa
  SELECT COALESCE(SUM(CASE WHEN entry_type='income' THEN amount ELSE -amount END),0)
  INTO v_saldo_caixa FROM cash_entries WHERE store_id = p_store_id;

  -- Inadimplência (overdue)
  SELECT COALESCE(SUM(amount_pending),0) INTO v_inadimplencia
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND payment_status IN ('pending','partial') AND amount_pending > 0
    AND due_date IS NOT NULL AND due_date < CURRENT_DATE;

  -- Maior devedor
  SELECT c.name, SUM(s.amount_pending) INTO v_maior_devedor, v_maior_valor
  FROM sales s JOIN customers c ON c.id = s.customer_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND s.payment_status IN ('pending','partial') AND s.amount_pending > 0
  GROUP BY c.id, c.name ORDER BY 2 DESC LIMIT 1;

  RETURN jsonb_build_object(
    'periodo', p_period_days||' dias',
    'receita_total',     v_receita_periodo,
    'receita_hoje',      v_receita_hoje,
    'receita_semana',    v_receita_semana,
    'a_receber',         v_a_receber,
    'a_pagar',           v_a_pagar,
    'saldo_caixa',       v_saldo_caixa,
    'inadimplencia',     v_inadimplencia,
    'maior_devedor',     COALESCE(v_maior_devedor,'Nenhum'),
    'maior_devedor_valor', COALESCE(v_maior_valor,0)
  );
END;
$$;

-- ----------------------------------------------------------------
-- RPC: ai_get_sales_summary
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_get_sales_summary(
  p_store_id   UUID,
  p_period_days INT DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role        TEXT := get_my_role();
  v_total_count BIGINT  := 0;
  v_total_val   NUMERIC := 0;
  v_hoje_count  BIGINT  := 0;
  v_ticket      NUMERIC := 0;
  v_top_prod    TEXT    := '';
  v_top_cat     TEXT    := '';
  v_top_vend    TEXT    := '';
  v_top_metodo  TEXT    := '';
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role NOT IN ('owner','admin','manager','finance') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  SELECT COUNT(*), COALESCE(SUM(net_total),0)
  INTO v_total_count, v_total_val
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at >= NOW() - (p_period_days||' days')::INTERVAL;

  SELECT COUNT(*) INTO v_hoje_count
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at::DATE = CURRENT_DATE;

  v_ticket := CASE WHEN v_total_count > 0 THEN v_total_val / v_total_count ELSE 0 END;

  -- Top produto
  SELECT p.name INTO v_top_prod
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN products p ON p.id = si.product_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
  GROUP BY p.id, p.name ORDER BY SUM(si.quantity) DESC LIMIT 1;

  -- Top categoria
  SELECT c.name INTO v_top_cat
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN products p ON p.id = si.product_id
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
    AND c.id IS NOT NULL
  GROUP BY c.id, c.name ORDER BY SUM(si.quantity * si.unit_price) DESC LIMIT 1;

  -- Top vendedor
  SELECT pr.name INTO v_top_vend
  FROM sales s JOIN profiles pr ON pr.id = s.user_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
    AND s.user_id IS NOT NULL
  GROUP BY pr.id, pr.name ORDER BY SUM(s.net_total) DESC LIMIT 1;

  -- Top método
  SELECT method INTO v_top_metodo
  FROM payments p JOIN sales s ON s.id = p.sale_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND p.paid_at >= NOW() - (p_period_days||' days')::INTERVAL
  GROUP BY method ORDER BY SUM(p.amount) DESC LIMIT 1;

  RETURN jsonb_build_object(
    'periodo',           p_period_days||' dias',
    'total_vendas',      v_total_count,
    'valor_total',       v_total_val,
    'ticket_medio',      ROUND(v_ticket, 2),
    'vendas_hoje',       v_hoje_count,
    'top_produto',       COALESCE(v_top_prod,'—'),
    'top_categoria',     COALESCE(v_top_cat,'—'),
    'top_vendedor',      COALESCE(v_top_vend,'—'),
    'metodo_mais_usado', COALESCE(v_top_metodo,'—')
  );
END;
$$;

-- ----------------------------------------------------------------
-- RPC: ai_get_inventory_summary
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_get_inventory_summary(
  p_store_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role          TEXT    := get_my_role();
  v_total_prods   BIGINT  := 0;
  v_valor_estoque NUMERIC := 0;
  v_sem_estoque   BIGINT  := 0;
  v_est_baixo     BIGINT  := 0;
  v_parados       BIGINT  := 0;
  v_valor_parado  NUMERIC := 0;
  v_top_ruptura   JSONB   := '[]';
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role NOT IN ('owner','admin','manager','finance','stock') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  SELECT COUNT(*), COALESCE(SUM(stock_quantity * COALESCE(cost_price, price, 0)),0)
  INTO v_total_prods, v_valor_estoque
  FROM products WHERE store_id = p_store_id AND is_active = TRUE;

  SELECT COUNT(*) INTO v_sem_estoque
  FROM products WHERE store_id = p_store_id AND is_active = TRUE AND stock_quantity = 0;

  SELECT COUNT(*) INTO v_est_baixo
  FROM products WHERE store_id = p_store_id AND is_active = TRUE AND stock_quantity > 0 AND stock_quantity <= 5;

  -- Parados (sem venda há 30 dias)
  SELECT COUNT(*), COALESCE(SUM(stock_quantity * COALESCE(cost_price, price, 0)),0)
  INTO v_parados, v_valor_parado
  FROM products p WHERE p.store_id = p_store_id AND p.is_active = TRUE AND p.stock_quantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id = p.id AND s.deleted_at IS NULL AND s.created_at > NOW() - INTERVAL '30 days'
    );

  -- Top produtos com ruptura iminente
  SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', stock_quantity) ORDER BY stock_quantity)
  INTO v_top_ruptura
  FROM products WHERE store_id = p_store_id AND is_active = TRUE AND stock_quantity BETWEEN 1 AND 5
  LIMIT 5;

  RETURN jsonb_build_object(
    'total_produtos',      v_total_prods,
    'valor_total_estoque', ROUND(v_valor_estoque, 2),
    'sem_estoque',         v_sem_estoque,
    'estoque_baixo',       v_est_baixo,
    'parados_30d',         v_parados,
    'valor_parado',        ROUND(v_valor_parado, 2),
    'top_ruptura',         COALESCE(v_top_ruptura, '[]'::JSONB)
  );
END;
$$;

-- ----------------------------------------------------------------
-- RPC: ai_get_customer_summary
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_get_customer_summary(
  p_store_id   UUID,
  p_period_days INT DEFAULT 90
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role             TEXT    := get_my_role();
  v_total_clientes   BIGINT  := 0;
  v_inadimplentes    BIGINT  := 0;
  v_valor_inadi      NUMERIC := 0;
  v_sem_comprar_60d  BIGINT  := 0;
  v_ticket_cliente   NUMERIC := 0;
  v_top_clientes     JSONB   := '[]';
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role NOT IN ('owner','admin','manager','finance') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  SELECT COUNT(*) INTO v_total_clientes FROM customers WHERE store_id = p_store_id;

  -- Inadimplentes (com valor vencido)
  SELECT COUNT(DISTINCT customer_id), COALESCE(SUM(amount_pending),0)
  INTO v_inadimplentes, v_valor_inadi
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND payment_status IN ('pending','partial') AND amount_pending > 0
    AND due_date IS NOT NULL AND due_date < CURRENT_DATE
    AND customer_id IS NOT NULL;

  -- Sem comprar em 60 dias (clientes com histórico mas inativos)
  SELECT COUNT(*) INTO v_sem_comprar_60d
  FROM customers c WHERE c.store_id = p_store_id
    AND EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.deleted_at IS NULL
                  AND s.created_at < NOW() - INTERVAL '60 days')
    AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.deleted_at IS NULL
                      AND s.created_at >= NOW() - INTERVAL '60 days');

  -- Ticket médio por cliente
  SELECT COALESCE(AVG(total),0) INTO v_ticket_cliente FROM (
    SELECT customer_id, SUM(net_total) as total
    FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL AND customer_id IS NOT NULL
      AND created_at >= NOW() - (p_period_days||' days')::INTERVAL
    GROUP BY customer_id
  ) t;

  -- Top 5 clientes por período
  SELECT jsonb_agg(jsonb_build_object('name', c.name, 'total', SUM(s.net_total), 'pedidos', COUNT(s.id)) ORDER BY SUM(s.net_total) DESC)
  INTO v_top_clientes
  FROM sales s JOIN customers c ON c.id = s.customer_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
    AND s.customer_id IS NOT NULL
  GROUP BY c.id, c.name LIMIT 5;

  RETURN jsonb_build_object(
    'periodo',           p_period_days||' dias',
    'total_clientes',    v_total_clientes,
    'inadimplentes',     v_inadimplentes,
    'valor_inadimplente', ROUND(v_valor_inadi, 2),
    'sem_comprar_60d',   v_sem_comprar_60d,
    'ticket_medio_cliente', ROUND(v_ticket_cliente, 2),
    'top_clientes',      COALESCE(v_top_clientes, '[]'::JSONB)
  );
END;
$$;

-- ----------------------------------------------------------------
-- RPC: ai_get_employee_summary
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_get_employee_summary(
  p_store_id   UUID,
  p_period_days INT DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role          TEXT  := get_my_role();
  v_total_vend    BIGINT := 0;
  v_melhor        TEXT   := '';
  v_melhor_total  NUMERIC := 0;
  v_ranking       JSONB  := '[]';
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role NOT IN ('owner','admin','manager') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  SELECT COUNT(*) INTO v_total_vend FROM profiles WHERE store_id = p_store_id;

  SELECT jsonb_agg(jsonb_build_object('name', pr.name, 'total', SUM(s.net_total), 'pedidos', COUNT(s.id)) ORDER BY SUM(s.net_total) DESC)
  INTO v_ranking
  FROM sales s JOIN profiles pr ON pr.id = s.user_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
    AND s.user_id IS NOT NULL
  GROUP BY pr.id, pr.name;

  SELECT (elem->>'name'), (elem->>'total')::NUMERIC INTO v_melhor, v_melhor_total
  FROM jsonb_array_elements(COALESCE(v_ranking,'[]')) elem LIMIT 1;

  RETURN jsonb_build_object(
    'periodo',        p_period_days||' dias',
    'total_equipe',   v_total_vend,
    'melhor_vendedor', COALESCE(v_melhor,'—'),
    'melhor_total',   COALESCE(v_melhor_total,0),
    'ranking',        COALESCE(v_ranking, '[]'::JSONB)
  );
END;
$$;

-- ----------------------------------------------------------------
-- RPC: ai_get_connect_summary
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_get_connect_summary(
  p_store_id   UUID,
  p_period_days INT DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role         TEXT    := get_my_role();
  v_total        BIGINT  := 0;
  v_conciliadas  BIGINT  := 0;
  v_divergentes  BIGINT  := 0;
  v_pendentes    BIGINT  := 0;
  v_taxa         NUMERIC := 0;
  v_val_diverg   NUMERIC := 0;
  v_top_banco    TEXT    := '';
  v_has_connect  BOOLEAN := FALSE;
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role NOT IN ('owner','admin','manager','finance') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  -- Check if bank_transactions table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bank_transactions'
  ) INTO v_has_connect;

  IF v_has_connect THEN
    EXECUTE format('
      SELECT COUNT(*),
        COUNT(*) FILTER (WHERE status = ''matched''),
        COUNT(*) FILTER (WHERE status = ''divergent''),
        COUNT(*) FILTER (WHERE status = ''pending''),
        COALESCE(SUM(amount) FILTER (WHERE status = ''divergent''), 0)
      FROM bank_transactions
      WHERE store_id = %L
        AND transaction_date >= NOW() - %L::INTERVAL',
      p_store_id, p_period_days||' days'
    ) INTO v_total, v_conciliadas, v_divergentes, v_pendentes, v_val_diverg;

    v_taxa := CASE WHEN v_total > 0 THEN ROUND((v_conciliadas::NUMERIC / v_total) * 100, 1) ELSE 0 END;

    EXECUTE format('
      SELECT bc.name FROM bank_transactions bt
      JOIN bank_connections bc ON bc.id = bt.connection_id
      WHERE bt.store_id = %L
        AND bt.transaction_date >= NOW() - %L::INTERVAL
      GROUP BY bc.id, bc.name ORDER BY SUM(ABS(bt.amount)) DESC LIMIT 1',
      p_store_id, p_period_days||' days'
    ) INTO v_top_banco;
  END IF;

  RETURN jsonb_build_object(
    'periodo',            p_period_days||' dias',
    'connect_ativo',      v_has_connect,
    'total_transacoes',   v_total,
    'conciliadas',        v_conciliadas,
    'divergentes',        v_divergentes,
    'pendentes',          v_pendentes,
    'taxa_conciliacao',   v_taxa,
    'valor_divergente',   ROUND(v_val_diverg, 2),
    'banco_maior_volume', COALESCE(v_top_banco,'—')
  );
END;
$$;

-- ----------------------------------------------------------------
-- RPC: ai_get_business_health_score
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_get_business_health_score(
  p_store_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role      TEXT    := get_my_role();
  -- Scores
  v_s_vendas      INT := 0;
  v_s_receb       INT := 0;
  v_s_inadi       INT := 0;
  v_s_ruptura     INT := 0;
  v_s_parados     INT := 0;
  v_s_margem      INT := 0;
  v_s_connect     INT := 5; -- neutral default
  v_total_score   INT := 0;
  -- Data
  v_rec_atual   NUMERIC := 0;
  v_rec_prev    NUMERIC := 0;
  v_a_receber   NUMERIC := 0;
  v_coletado    NUMERIC := 0;
  v_overdue     NUMERIC := 0;
  v_receita_mes NUMERIC := 0;
  v_custo_mes   NUMERIC := 0;
  v_sem_est     BIGINT  := 0;
  v_total_prod  BIGINT  := 1;
  v_parados_val NUMERIC := 0;
  v_est_total_val NUMERIC := 1;
  v_has_connect BOOLEAN := FALSE;
  v_conc_rate   NUMERIC := 0;
  v_strengths   JSONB   := '[]';
  v_weaknesses  JSONB   := '[]';
  v_grade       TEXT;
  v_rec_HINT    TEXT    := '';
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role NOT IN ('owner','admin','manager','finance') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  -- Vendas: atual 30d vs prev 30d (0-20)
  SELECT COALESCE(SUM(net_total),0) INTO v_rec_atual FROM sales
  WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at >= NOW() - INTERVAL '30 days';
  SELECT COALESCE(SUM(net_total),0) INTO v_rec_prev FROM sales
  WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days';

  IF v_rec_prev = 0 THEN v_s_vendas := 14;
  ELSIF v_rec_atual >= v_rec_prev THEN v_s_vendas := 20;
  ELSIF v_rec_atual >= v_rec_prev * 0.8 THEN v_s_vendas := 16;
  ELSIF v_rec_atual >= v_rec_prev * 0.6 THEN v_s_vendas := 11;
  ELSIF v_rec_atual >= v_rec_prev * 0.4 THEN v_s_vendas := 6;
  ELSE v_s_vendas := 2;
  END IF;

  -- Recebimentos: coletado / total do mês (0-15)
  v_receita_mes := v_rec_atual;
  SELECT COALESCE(SUM(p.amount),0) INTO v_coletado
  FROM payments p JOIN sales s ON s.id = p.sale_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL AND p.paid_at >= NOW() - INTERVAL '30 days';

  IF v_receita_mes > 0 THEN
    v_s_receb := LEAST(15, FLOOR((v_coletado / v_receita_mes) * 15)::INT);
  ELSE v_s_receb := 10; END IF;

  -- Inadimplência (0-15)
  SELECT COALESCE(SUM(amount_pending),0) INTO v_a_receber
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND payment_status IN ('pending','partial') AND amount_pending > 0;
  SELECT COALESCE(SUM(amount_pending),0) INTO v_overdue
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND payment_status IN ('pending','partial') AND amount_pending > 0
    AND due_date IS NOT NULL AND due_date < CURRENT_DATE;

  IF v_a_receber = 0 THEN v_s_inadi := 15;
  ELSE
    DECLARE v_inadi_pct NUMERIC := v_overdue / v_a_receber;
    BEGIN
      IF v_inadi_pct <= 0.05 THEN v_s_inadi := 15;
      ELSIF v_inadi_pct <= 0.10 THEN v_s_inadi := 11;
      ELSIF v_inadi_pct <= 0.20 THEN v_s_inadi := 6;
      ELSE v_s_inadi := 1; END IF;
    END;
  END IF;

  -- Ruptura de estoque (0-10)
  SELECT COUNT(*), COUNT(*) FILTER (WHERE stock_quantity = 0)
  INTO v_total_prod, v_sem_est
  FROM products WHERE store_id = p_store_id AND is_active = TRUE;
  IF v_total_prod = 0 THEN v_total_prod := 1; END IF;

  DECLARE v_ruptura_pct NUMERIC := v_sem_est::NUMERIC / v_total_prod;
  BEGIN
    IF v_ruptura_pct <= 0.05 THEN v_s_ruptura := 10;
    ELSIF v_ruptura_pct <= 0.15 THEN v_s_ruptura := 7;
    ELSIF v_ruptura_pct <= 0.30 THEN v_s_ruptura := 4;
    ELSE v_s_ruptura := 1; END IF;
  END;

  -- Produtos parados (0-10)
  SELECT COALESCE(SUM(stock_quantity * COALESCE(cost_price, price, 0)),0) INTO v_est_total_val
  FROM products WHERE store_id = p_store_id AND is_active = TRUE;
  IF v_est_total_val = 0 THEN v_est_total_val := 1; END IF;

  SELECT COALESCE(SUM(stock_quantity * COALESCE(cost_price, price, 0)),0) INTO v_parados_val
  FROM products p WHERE p.store_id = p_store_id AND p.is_active = TRUE AND p.stock_quantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id = p.id AND s.deleted_at IS NULL AND s.created_at > NOW() - INTERVAL '30 days'
    );

  DECLARE v_parado_pct NUMERIC := v_parados_val / v_est_total_val;
  BEGIN
    IF v_parado_pct <= 0.10 THEN v_s_parados := 10;
    ELSIF v_parado_pct <= 0.25 THEN v_s_parados := 7;
    ELSIF v_parado_pct <= 0.40 THEN v_s_parados := 4;
    ELSE v_s_parados := 1; END IF;
  END;

  -- Margem bruta (0-15)
  SELECT COALESCE(SUM(net_total),0) INTO v_receita_mes
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at >= NOW() - INTERVAL '30 days';
  SELECT COALESCE(SUM(amount),0) INTO v_custo_mes
  FROM cash_entries WHERE store_id = p_store_id AND entry_type = 'expense'
    AND occurred_at >= NOW() - INTERVAL '30 days'
    AND category ILIKE '%Compra%';

  IF v_receita_mes > 0 THEN
    DECLARE v_margem NUMERIC := (v_receita_mes - v_custo_mes) / v_receita_mes;
    BEGIN
      IF v_margem >= 0.40 THEN v_s_margem := 15;
      ELSIF v_margem >= 0.25 THEN v_s_margem := 11;
      ELSIF v_margem >= 0.10 THEN v_s_margem := 6;
      ELSE v_s_margem := 2; END IF;
    END;
  ELSE v_s_margem := 8; END IF;

  -- Connect score (0-10)
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bank_transactions') INTO v_has_connect;
  IF v_has_connect THEN
    EXECUTE format('SELECT CASE WHEN COUNT(*) = 0 THEN 5 ELSE LEAST(10, ROUND((COUNT(*) FILTER (WHERE status=''matched'')::NUMERIC / COUNT(*)) * 10)::INT) END FROM bank_transactions WHERE store_id = %L AND transaction_date >= NOW() - INTERVAL ''30 days''', p_store_id) INTO v_s_connect;
  END IF;

  v_total_score := v_s_vendas + v_s_receb + v_s_inadi + v_s_ruptura + v_s_parados + v_s_margem + v_s_connect;

  -- Grade
  v_grade := CASE
    WHEN v_total_score >= 85 THEN 'Excelente'
    WHEN v_total_score >= 70 THEN 'Bom'
    WHEN v_total_score >= 55 THEN 'Regular'
    WHEN v_total_score >= 40 THEN 'Atenção'
    ELSE 'Crítico'
  END;

  -- Forças e fraquezas
  IF v_s_vendas >= 16 THEN v_strengths := v_strengths || '["Vendas em crescimento ou estáveis"]'::JSONB; END IF;
  IF v_s_inadi >= 11 THEN v_strengths := v_strengths || '["Baixa inadimplência"]'::JSONB; END IF;
  IF v_s_margem >= 11 THEN v_strengths := v_strengths || '["Boa margem bruta"]'::JSONB; END IF;
  IF v_s_ruptura = 10 THEN v_strengths := v_strengths || '["Estoque bem controlado"]'::JSONB; END IF;
  IF v_s_parados >= 7 THEN v_strengths := v_strengths || '["Baixo estoque parado"]'::JSONB; END IF;

  IF v_s_vendas <= 6 THEN v_weaknesses := v_weaknesses || '["Queda significativa nas vendas"]'::JSONB; END IF;
  IF v_s_inadi <= 6 THEN v_weaknesses := v_weaknesses || '["Alta inadimplência — cobranças urgentes"]'::JSONB; END IF;
  IF v_s_ruptura <= 4 THEN v_weaknesses := v_weaknesses || '["Muitos produtos sem estoque"]'::JSONB; END IF;
  IF v_s_parados <= 4 THEN v_weaknesses := v_weaknesses || '["Alto valor de estoque parado"]'::JSONB; END IF;
  IF v_s_margem <= 6 THEN v_weaknesses := v_weaknesses || '["Margem baixa — reveja preços ou custos"]'::JSONB; END IF;

  RETURN jsonb_build_object(
    'score',          v_total_score,
    'grade',          v_grade,
    'breakdown', jsonb_build_object(
      'vendas',     v_s_vendas,
      'recebimentos', v_s_receb,
      'inadimplencia', v_s_inadi,
      'ruptura',    v_s_ruptura,
      'parados',    v_s_parados,
      'margem',     v_s_margem,
      'connect',    v_s_connect
    ),
    'strengths',      v_strengths,
    'weaknesses',     v_weaknesses,
    'recommendation', CASE
      WHEN v_s_inadi <= 6 THEN 'Priorize a cobrança de clientes inadimplentes — o impacto no caixa é imediato.'
      WHEN v_s_vendas <= 6 THEN 'Vendas em queda: analise os produtos mais vendidos e considere ações promocionais.'
      WHEN v_s_ruptura <= 4 THEN 'Muitos produtos sem estoque. Faça uma reposição urgente dos itens mais vendidos.'
      WHEN v_s_parados >= 7 THEN 'Estoque saudável, mas monitore os produtos parados para evitar perda de capital.'
      ELSE 'Continue monitorando indicadores semanalmente e revise metas mensais.'
    END
  );
END;
$$;

-- ----------------------------------------------------------------
-- RPC: save_ai_interaction
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_ai_interaction(
  p_store_id    UUID,
  p_question    TEXT,
  p_intent      TEXT,
  p_answer      TEXT,
  p_data_sources TEXT[] DEFAULT '{}'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_id UUID;
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  INSERT INTO ai_interactions(store_id, user_id, question, intent, answer, data_sources)
  VALUES (p_store_id, auth.uid(), p_question, p_intent, p_answer, p_data_sources)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ----------------------------------------------------------------
-- RPC: get_ai_history
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_ai_history(
  p_store_id UUID,
  p_limit    INT DEFAULT 50
) RETURNS TABLE(id UUID, question TEXT, intent TEXT, answer TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT ai.id, ai.question, ai.intent, ai.answer, ai.created_at
  FROM ai_interactions ai
  WHERE ai.store_id = p_store_id
  ORDER BY ai.created_at DESC LIMIT p_limit;
END;
$$;

-- ----------------------------------------------------------------
-- RPC: generate_ai_insights
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_ai_insights(
  p_store_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_role          TEXT    := get_my_role();
  v_inserted      INT     := 0;
  v_rec_atual     NUMERIC := 0;
  v_rec_prev      NUMERIC := 0;
  v_overdue_pct   NUMERIC := 0;
  v_a_receber     NUMERIC := 0;
  v_overdue       NUMERIC := 0;
  v_est_baixo     BIGINT  := 0;
  v_parados       BIGINT  := 0;
  v_total_prod    BIGINT  := 1;
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role NOT IN ('owner','admin','manager') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  -- 1. Queda de faturamento
  SELECT COALESCE(SUM(net_total),0) INTO v_rec_atual FROM sales
  WHERE store_id = p_store_id AND deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days';
  SELECT COALESCE(SUM(net_total),0) INTO v_rec_prev FROM sales
  WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days';

  IF v_rec_prev > 0 AND v_rec_atual < v_rec_prev * 0.70 AND NOT EXISTS (
    SELECT 1 FROM ai_insights WHERE store_id = p_store_id AND type = 'sales_decline' AND status='active' AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN
    INSERT INTO ai_insights(store_id, type, severity, title, description, recommendation)
    VALUES (p_store_id, 'sales_decline', 'critico',
      'Queda nas vendas detectada',
      format('Vendas dos últimos 30 dias (R$ %s) estão %.0f%% abaixo do período anterior (R$ %s).',
        TO_CHAR(v_rec_atual,'FM999G999D00'), (1 - v_rec_atual/v_rec_prev)*100, TO_CHAR(v_rec_prev,'FM999G999D00')),
      'Analise os produtos mais vendidos, verifique sazonalidade e considere ações promocionais.');
    v_inserted := v_inserted + 1;
  END IF;

  -- 2. Alta inadimplência
  SELECT COALESCE(SUM(amount_pending),0) INTO v_a_receber FROM sales
  WHERE store_id = p_store_id AND deleted_at IS NULL AND payment_status IN ('pending','partial');
  SELECT COALESCE(SUM(amount_pending),0) INTO v_overdue FROM sales
  WHERE store_id = p_store_id AND deleted_at IS NULL AND payment_status IN ('pending','partial')
    AND due_date IS NOT NULL AND due_date < CURRENT_DATE;

  IF v_a_receber > 0 THEN v_overdue_pct := v_overdue / v_a_receber; END IF;

  IF v_overdue_pct > 0.15 AND NOT EXISTS (
    SELECT 1 FROM ai_insights WHERE store_id = p_store_id AND type = 'high_delinquency' AND status='active' AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN
    INSERT INTO ai_insights(store_id, type, severity, title, description, recommendation)
    VALUES (p_store_id, 'high_delinquency', 'atencao',
      'Inadimplência acima do ideal',
      format('%.1f%% dos valores a receber estão vencidos (R$ %s). Total a receber: R$ %s.',
        v_overdue_pct*100, TO_CHAR(v_overdue,'FM999G999D00'), TO_CHAR(v_a_receber,'FM999G999D00')),
      'Entre em contato com os clientes em atraso. Priorize os de maior valor.');
    v_inserted := v_inserted + 1;
  END IF;

  -- 3. Estoque baixo crítico
  SELECT COUNT(*), COUNT(*) FILTER (WHERE stock_quantity <= 5 AND stock_quantity > 0)
  INTO v_total_prod, v_est_baixo
  FROM products WHERE store_id = p_store_id AND is_active = TRUE;

  IF v_est_baixo > 5 AND NOT EXISTS (
    SELECT 1 FROM ai_insights WHERE store_id = p_store_id AND type = 'low_stock' AND status='active' AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN
    INSERT INTO ai_insights(store_id, type, severity, title, description, recommendation)
    VALUES (p_store_id, 'low_stock', 'atencao',
      format('%s produtos com estoque crítico', v_est_baixo),
      format('%s produtos estão com menos de 5 unidades em estoque. Risco de ruptura iminente.', v_est_baixo),
      'Faça a reposição dos produtos com maior saída antes que acabem.');
    v_inserted := v_inserted + 1;
  END IF;

  -- 4. Produtos parados
  SELECT COUNT(*) INTO v_parados FROM products p
  WHERE p.store_id = p_store_id AND p.is_active = TRUE AND p.stock_quantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id = p.id AND s.deleted_at IS NULL AND s.created_at > NOW() - INTERVAL '30 days'
    );

  IF v_parados > 10 AND NOT EXISTS (
    SELECT 1 FROM ai_insights WHERE store_id = p_store_id AND type = 'idle_products' AND status='active' AND created_at > NOW() - INTERVAL '24 hours'
  ) THEN
    INSERT INTO ai_insights(store_id, type, severity, title, description, recommendation)
    VALUES (p_store_id, 'idle_products', 'atencao',
      format('%s produtos sem venda há 30 dias', v_parados),
      format('%s produtos com estoque positivo não tiveram nenhuma venda nos últimos 30 dias. Capital imobilizado.', v_parados),
      'Considere promoções, liquidação ou relocação desses produtos.');
    v_inserted := v_inserted + 1;
  END IF;

  -- 5. Oportunidade: produto com alta demanda
  DECLARE
    v_top_name TEXT;
    v_top_qty  BIGINT;
    v_top_prev BIGINT;
  BEGIN
    SELECT p.name, SUM(si.quantity)
    INTO v_top_name, v_top_qty
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
    WHERE s.store_id = p_store_id AND s.deleted_at IS NULL AND s.created_at >= NOW() - INTERVAL '7 days'
    GROUP BY p.id, p.name ORDER BY 2 DESC LIMIT 1;

    IF v_top_name IS NOT NULL THEN
      SELECT COALESCE(SUM(si.quantity),0)
      INTO v_top_prev
      FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
      WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
        AND s.created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
        AND p.name = v_top_name;

      IF v_top_prev > 0 AND v_top_qty > v_top_prev * 1.5 AND NOT EXISTS (
        SELECT 1 FROM ai_insights WHERE store_id = p_store_id AND type = 'product_opportunity' AND status='active' AND created_at > NOW() - INTERVAL '24 hours'
      ) THEN
        INSERT INTO ai_insights(store_id, type, severity, title, description, recommendation)
        VALUES (p_store_id, 'product_opportunity', 'oportunidade',
          format('Alta demanda: %s', v_top_name),
          format('"%s" teve %.0f%% mais vendas esta semana vs semana anterior (%s vs %s unidades).',
            v_top_name, (v_top_qty::NUMERIC/v_top_prev - 1)*100, v_top_qty, v_top_prev),
          format('Garanta estoque suficiente de "%s" para aproveitar o momento de alta demanda.', v_top_name));
        v_inserted := v_inserted + 1;
      END IF;
    END IF;
  END;

  -- 6. Cliente importante parou de comprar
  DECLARE
    v_churn_client TEXT;
    v_churn_val    NUMERIC;
  BEGIN
    SELECT c.name, SUM(s.net_total) INTO v_churn_client, v_churn_val
    FROM sales s JOIN customers c ON c.id = s.customer_id
    WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
      AND s.created_at >= NOW() - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM sales s2 WHERE s2.customer_id = c.id AND s2.deleted_at IS NULL
          AND s2.created_at >= NOW() - INTERVAL '60 days'
      )
    GROUP BY c.id, c.name ORDER BY SUM(s.net_total) DESC LIMIT 1;

    IF v_churn_client IS NOT NULL AND v_churn_val > 500 AND NOT EXISTS (
      SELECT 1 FROM ai_insights WHERE store_id = p_store_id AND type = 'churned_customer' AND status='active' AND created_at > NOW() - INTERVAL '48 hours'
    ) THEN
      INSERT INTO ai_insights(store_id, type, severity, title, description, recommendation)
      VALUES (p_store_id, 'churned_customer', 'atencao',
        format('Cliente importante sem comprar: %s', v_churn_client),
        format('%s comprou R$ %s nos últimos 3 meses mas não retorna há mais de 60 dias.',
          v_churn_client, TO_CHAR(v_churn_val,'FM999G999D00')),
        format('Entre em contato com %s para entender o motivo e oferecer uma proposta especial.', v_churn_client));
      v_inserted := v_inserted + 1;
    END IF;
  END;

  RETURN jsonb_build_object('insights_gerados', v_inserted, 'timestamp', NOW()::TEXT);
END;
$$;

-- ----------------------------------------------------------------
-- RPC: get_ai_insights
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_ai_insights(
  p_store_id UUID,
  p_status   TEXT DEFAULT 'active',
  p_limit    INT  DEFAULT 20
) RETURNS TABLE(
  id UUID, type TEXT, severity TEXT, title TEXT,
  description TEXT, recommendation TEXT, status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT ai.id, ai.type, ai.severity, ai.title, ai.description, ai.recommendation, ai.status, ai.created_at
  FROM ai_insights ai
  WHERE ai.store_id = p_store_id
    AND (p_status IS NULL OR ai.status = p_status)
  ORDER BY
    CASE ai.severity WHEN 'critico' THEN 1 WHEN 'atencao' THEN 2 WHEN 'oportunidade' THEN 3 ELSE 4 END,
    ai.created_at DESC
  LIMIT p_limit;
END;
$$;

-- ----------------------------------------------------------------
-- RPC: resolve_ai_insight
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_ai_insight(
  p_insight_id UUID,
  p_store_id   UUID,
  p_action     TEXT DEFAULT 'resolved'
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF get_my_store_id() != p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  UPDATE ai_insights SET status = p_action, resolved_at = NOW()
  WHERE id = p_insight_id AND store_id = p_store_id AND status = 'active';
  RETURN FOUND;
END;
$$;

-- ----------------------------------------------------------------
-- RPC: super_admin_ai_overview (cross-store, restricted)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION super_admin_ai_overview()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_email TEXT;
  v_result JSONB;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email != 'vitorargoloo001@gmail.com' THEN
    RAISE EXCEPTION 'Acesso restrito ao Super Admin';
  END IF;

  SELECT jsonb_build_object(
    'total_lojas', COUNT(DISTINCT s.id),
    'lojas_com_risco', COUNT(DISTINCT s.id) FILTER (
      WHERE EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.store_id = s.id AND ai.severity = 'critico' AND ai.status = 'active')
    ),
    'insights_criticos', (SELECT COUNT(*) FROM ai_insights WHERE severity = 'critico' AND status = 'active'),
    'insights_atencao',  (SELECT COUNT(*) FROM ai_insights WHERE severity = 'atencao' AND status = 'active'),
    'top_lojas', (
      SELECT jsonb_agg(jsonb_build_object(
        'nome', s2.name,
        'receita_mes', COALESCE(SUM(sa.net_total),0),
        'insights_ativos', (SELECT COUNT(*) FROM ai_insights WHERE store_id = s2.id AND status='active')
      ) ORDER BY COALESCE(SUM(sa.net_total),0) DESC)
      FROM stores s2
      LEFT JOIN sales sa ON sa.store_id = s2.id AND sa.deleted_at IS NULL AND sa.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY s2.id, s2.name LIMIT 10
    ),
    'lojas_sem_acesso_7d', (
      SELECT jsonb_agg(jsonb_build_object('nome', s3.name, 'ultimo_acesso', MAX(ai2.created_at)))
      FROM stores s3
      LEFT JOIN ai_interactions ai2 ON ai2.store_id = s3.id
      GROUP BY s3.id, s3.name
      HAVING MAX(ai2.created_at) < NOW() - INTERVAL '7 days' OR MAX(ai2.created_at) IS NULL
      LIMIT 5
    )
  ) INTO v_result
  FROM stores s;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------
-- GRANTS
-- ----------------------------------------------------------------
REVOKE ALL ON FUNCTION ai_get_financial_summary(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_get_sales_summary(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_get_inventory_summary(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_get_customer_summary(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_get_employee_summary(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_get_connect_summary(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_get_business_health_score(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_ai_interaction(UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_ai_history(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION generate_ai_insights(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_ai_insights(UUID, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_ai_insight(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION super_admin_ai_overview() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ai_get_financial_summary(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION ai_get_sales_summary(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION ai_get_inventory_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION ai_get_customer_summary(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION ai_get_employee_summary(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION ai_get_connect_summary(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION ai_get_business_health_score(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION save_ai_interaction(UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_history(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_ai_insights(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_insights(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_ai_insight(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION super_admin_ai_overview() TO authenticated;
