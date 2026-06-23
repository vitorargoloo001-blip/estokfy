-- =====================================================================
-- Block 8 — Estokfy Finance Platform
-- Tables: finance_cost_centers, finance_goals, store_groups, store_group_members
-- Alter: accounts_payable (recurrence, cost_center_id)
-- =====================================================================

-- ── Centro de Custo ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_cost_centers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
    'aluguel','funcionarios','impostos','marketing','compras','outros'
  )),
  budget_monthly  NUMERIC DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_cc_store_idx ON public.finance_cost_centers(store_id, is_active);

ALTER TABLE public.finance_cost_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_select ON public.finance_cost_centers FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());
CREATE POLICY cc_write ON public.finance_cost_centers FOR ALL TO authenticated
  USING (store_id = public.get_my_store_id()
    AND public.get_my_role() = ANY(ARRAY['owner','admin','manager','finance']));

-- ── Metas Financeiras ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  goal_type     TEXT NOT NULL CHECK (goal_type IN (
    'faturamento','lucro','recebimentos','inadimplencia'
  )),
  period_month  SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year   SMALLINT NOT NULL,
  target_value  NUMERIC NOT NULL,
  notes         TEXT,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, goal_type, period_month, period_year)
);

CREATE INDEX IF NOT EXISTS finance_goals_store_period_idx ON public.finance_goals(store_id, period_year, period_month);

ALTER TABLE public.finance_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY goals_select ON public.finance_goals FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());
CREATE POLICY goals_write ON public.finance_goals FOR ALL TO authenticated
  USING (store_id = public.get_my_store_id()
    AND public.get_my_role() = ANY(ARRAY['owner','admin','manager','finance']));

-- ── Grupos Multi-empresa ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  owner_id     UUID NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_group_members (
  group_id   UUID NOT NULL REFERENCES public.store_groups(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, store_id)
);

ALTER TABLE public.store_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY sg_owner ON public.store_groups FOR ALL TO authenticated
  USING (owner_id = auth.uid());
CREATE POLICY sgm_owner ON public.store_group_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM store_groups WHERE id = group_id AND owner_id = auth.uid()));

-- ── Estender accounts_payable: recorrência e centro de custo ──────────
ALTER TABLE public.accounts_payable
  ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.finance_cost_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence      TEXT CHECK (recurrence IN ('none','weekly','monthly','yearly')) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_config JSONB DEFAULT '{}';

-- ── RPC: Fluxo de Caixa Profissional ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_professional_cashflow(
  p_store_id  UUID,
  p_period    TEXT DEFAULT 'month',      -- 'today'|'week'|'month'|'custom'
  p_start     DATE DEFAULT NULL,
  p_end       DATE DEFAULT NULL
) RETURNS TABLE (
  day              DATE,
  confirmed_in     NUMERIC,
  projected_in     NUMERIC,
  total_out        NUMERIC,
  daily_balance    NUMERIC,
  running_balance  NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  v_start := CASE p_period
    WHEN 'today'  THEN CURRENT_DATE
    WHEN 'week'   THEN CURRENT_DATE - 6
    WHEN 'month'  THEN date_trunc('month', CURRENT_DATE)::DATE
    ELSE COALESCE(p_start, date_trunc('month', CURRENT_DATE)::DATE)
  END;
  v_end := CASE p_period
    WHEN 'today'  THEN CURRENT_DATE
    WHEN 'week'   THEN CURRENT_DATE
    WHEN 'month'  THEN (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE
    ELSE COALESCE(p_end, CURRENT_DATE)
  END;

  RETURN QUERY
  WITH ds AS (
    SELECT generate_series(v_start, v_end, '1 day'::INTERVAL)::DATE AS d
  ),
  cin AS (
    SELECT
      d,
      SUM(amount) AS amount
    FROM (
      SELECT date(occurred_at) AS d, amount FROM cash_entries
      WHERE store_id = p_store_id AND entry_type = 'income'
        AND occurred_at::DATE BETWEEN v_start AND v_end
      UNION ALL
      SELECT date(created_at) AS d, amount FROM payments
      WHERE store_id = p_store_id
        AND created_at::DATE BETWEEN v_start AND v_end
    ) x
    GROUP BY d
  ),
  proj AS (
    SELECT due_date AS d, SUM(COALESCE(amount_pending, net_total)) AS amount
    FROM sales
    WHERE store_id = p_store_id
      AND payment_status IN ('pending','partial')
      AND deleted_at IS NULL
      AND due_date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  tout AS (
    SELECT d, SUM(amount) AS amount
    FROM (
      SELECT due_date AS d, amount FROM accounts_payable
      WHERE store_id = p_store_id
        AND status IN ('pending','paid')
        AND due_date BETWEEN v_start AND v_end
      UNION ALL
      SELECT date(occurred_at) AS d, amount FROM cash_entries
      WHERE store_id = p_store_id AND entry_type = 'expense'
        AND occurred_at::DATE BETWEEN v_start AND v_end
    ) x
    GROUP BY d
  ),
  base AS (
    SELECT
      ds.d,
      COALESCE(cin.amount, 0)  AS ci,
      COALESCE(proj.amount, 0) AS pi,
      COALESCE(tout.amount, 0) AS to_
    FROM ds
    LEFT JOIN cin  ON cin.d = ds.d
    LEFT JOIN proj ON proj.d = ds.d
    LEFT JOIN tout ON tout.d = ds.d
  )
  SELECT
    b.d,
    b.ci,
    b.pi,
    b.to_,
    b.ci - b.to_  AS daily_balance,
    SUM(b.ci - b.to_) OVER (ORDER BY b.d) AS running_balance
  FROM base b
  ORDER BY b.d;
END;
$$;
REVOKE ALL ON FUNCTION public.get_professional_cashflow FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_professional_cashflow TO authenticated;

-- ── RPC: DRE Gerencial ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dre(
  p_store_id UUID,
  p_month    INT DEFAULT NULL,
  p_year     INT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month    INT := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::INT);
  v_year     INT := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
  v_start    DATE;
  v_end      DATE;

  v_receita_bruta     NUMERIC := 0;
  v_cogs              NUMERIC := 0;
  v_lucro_bruto       NUMERIC := 0;
  v_desp_operacional  NUMERIC := 0;
  v_desp_impostos     NUMERIC := 0;
  v_desp_pessoal      NUMERIC := 0;
  v_desp_aluguel      NUMERIC := 0;
  v_desp_marketing    NUMERIC := 0;
  v_desp_outros       NUMERIC := 0;
  v_lucro_operacional NUMERIC := 0;
  v_lucro_liquido     NUMERIC := 0;
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  v_start := make_date(v_year, v_month, 1);
  v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Receita Bruta = total de vendas no período
  SELECT COALESCE(SUM(net_total), 0) INTO v_receita_bruta
  FROM sales
  WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at::DATE BETWEEN v_start AND v_end;

  -- COGS = compras de estoque/mercadoria no período
  SELECT COALESCE(SUM(amount), 0) INTO v_cogs
  FROM cash_entries
  WHERE store_id = p_store_id
    AND entry_type = 'expense'
    AND category IN ('Compra de Estoque','Compra de mercadoria','Compras')
    AND occurred_at::DATE BETWEEN v_start AND v_end;

  -- Adicionar accounts_payable de compras ao COGS
  SELECT v_cogs + COALESCE(SUM(COALESCE(paid_amount, amount)), 0) INTO v_cogs
  FROM accounts_payable
  WHERE store_id = p_store_id
    AND category ILIKE '%compra%'
    AND status = 'paid'
    AND paid_at::DATE BETWEEN v_start AND v_end;

  v_lucro_bruto := v_receita_bruta - v_cogs;

  -- Despesas por categoria
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE category ILIKE '%impost%'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category ILIKE '%funcionar%' OR category ILIKE '%pessoal%' OR category = 'Funcionários'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category ILIKE '%aluguel%'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category ILIKE '%market%'), 0),
    COALESCE(SUM(amount) FILTER (WHERE
      category NOT ILIKE '%compra%' AND
      category NOT ILIKE '%impost%' AND
      category NOT ILIKE '%funcionar%' AND
      category NOT ILIKE '%pessoal%' AND
      category NOT ILIKE '%aluguel%' AND
      category NOT ILIKE '%market%'
    ), 0)
  INTO v_desp_impostos, v_desp_pessoal, v_desp_aluguel, v_desp_marketing, v_desp_outros
  FROM cash_entries
  WHERE store_id = p_store_id
    AND entry_type = 'expense'
    AND category NOT IN ('Compra de Estoque','Compra de mercadoria','Compras')
    AND occurred_at::DATE BETWEEN v_start AND v_end;

  -- Adicionar accounts_payable pagas (excl. compras) ao total de despesas
  SELECT
    v_desp_impostos + COALESCE(SUM(COALESCE(paid_amount, amount)) FILTER (WHERE category ILIKE '%impost%'), 0),
    v_desp_pessoal + COALESCE(SUM(COALESCE(paid_amount, amount)) FILTER (WHERE category ILIKE '%funcionar%'), 0),
    v_desp_aluguel + COALESCE(SUM(COALESCE(paid_amount, amount)) FILTER (WHERE category ILIKE '%aluguel%'), 0),
    v_desp_marketing + COALESCE(SUM(COALESCE(paid_amount, amount)) FILTER (WHERE category ILIKE '%market%'), 0),
    v_desp_outros + COALESCE(SUM(COALESCE(paid_amount, amount)) FILTER (WHERE
      category NOT ILIKE '%compra%' AND category NOT ILIKE '%impost%' AND
      category NOT ILIKE '%funcionar%' AND category NOT ILIKE '%aluguel%' AND
      category NOT ILIKE '%market%'
    ), 0)
  INTO v_desp_impostos, v_desp_pessoal, v_desp_aluguel, v_desp_marketing, v_desp_outros
  FROM accounts_payable
  WHERE store_id = p_store_id
    AND status = 'paid'
    AND category NOT ILIKE '%compra%'
    AND paid_at::DATE BETWEEN v_start AND v_end;

  v_desp_operacional := v_desp_impostos + v_desp_pessoal + v_desp_aluguel + v_desp_marketing + v_desp_outros;
  v_lucro_operacional := v_lucro_bruto - v_desp_operacional;
  v_lucro_liquido     := v_lucro_operacional; -- simplified (no IR/CSLL separate tracking)

  RETURN jsonb_build_object(
    'period',              format('%s/%s', LPAD(v_month::TEXT, 2, '0'), v_year::TEXT),
    'period_month',        v_month,
    'period_year',         v_year,
    'receita_bruta',       v_receita_bruta,
    'cogs',                v_cogs,
    'lucro_bruto',         v_lucro_bruto,
    'margem_bruta',        CASE WHEN v_receita_bruta > 0 THEN ROUND((v_lucro_bruto / v_receita_bruta * 100)::NUMERIC, 2) ELSE 0 END,
    'despesas_operacionais', v_desp_operacional,
    'desp_breakdown', jsonb_build_object(
      'impostos', v_desp_impostos,
      'pessoal',  v_desp_pessoal,
      'aluguel',  v_desp_aluguel,
      'marketing', v_desp_marketing,
      'outros',   v_desp_outros
    ),
    'lucro_operacional',   v_lucro_operacional,
    'lucro_liquido',       v_lucro_liquido,
    'margem_liquida',      CASE WHEN v_receita_bruta > 0 THEN ROUND((v_lucro_liquido / v_receita_bruta * 100)::NUMERIC, 2) ELSE 0 END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_dre FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dre TO authenticated;

-- ── RPC: DRE Comparativo (atual vs anterior) ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_dre_comparison(p_store_id UUID, p_month INT DEFAULT NULL, p_year INT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month    INT := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::INT);
  v_year     INT := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
  v_prev_m   INT;
  v_prev_y   INT;
  v_current  JSONB;
  v_previous JSONB;
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  -- Mês anterior
  v_prev_m := CASE WHEN v_month = 1 THEN 12 ELSE v_month - 1 END;
  v_prev_y := CASE WHEN v_month = 1 THEN v_year - 1 ELSE v_year END;

  SELECT get_dre(p_store_id, v_month, v_year)   INTO v_current;
  SELECT get_dre(p_store_id, v_prev_m, v_prev_y) INTO v_previous;

  RETURN jsonb_build_object(
    'current',  v_current,
    'previous', v_previous
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_dre_comparison FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dre_comparison TO authenticated;

-- ── RPC: Progresso das metas ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_finance_goals_progress(
  p_store_id UUID,
  p_month    INT DEFAULT NULL,
  p_year     INT DEFAULT NULL
) RETURNS TABLE (
  goal_id      UUID,
  goal_type    TEXT,
  target_value NUMERIC,
  realized     NUMERIC,
  progress_pct NUMERIC,
  notes        TEXT,
  on_track     BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month INT := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::INT);
  v_year  INT := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
  v_start DATE;
  v_end   DATE;

  v_faturamento  NUMERIC := 0;
  v_recebimentos NUMERIC := 0;
  v_desp         NUMERIC := 0;
  v_lucro        NUMERIC := 0;
  v_dlq          NUMERIC := 0;
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  v_start := make_date(v_year, v_month, 1);
  v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Faturamento
  SELECT COALESCE(SUM(net_total), 0) INTO v_faturamento
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at::DATE BETWEEN v_start AND v_end;

  -- Recebimentos (pagamentos efetivos)
  SELECT COALESCE(SUM(amount), 0) INTO v_recebimentos
  FROM payments WHERE store_id = p_store_id
    AND created_at::DATE BETWEEN v_start AND v_end;

  -- Lucro (faturamento - despesas)
  SELECT COALESCE(SUM(amount), 0) INTO v_desp
  FROM cash_entries WHERE store_id = p_store_id
    AND entry_type = 'expense'
    AND occurred_at::DATE BETWEEN v_start AND v_end;
  v_lucro := v_faturamento - v_desp;

  -- Inadimplência (%)
  DECLARE v_total_pendente NUMERIC; v_total_vendas NUMERIC;
  BEGIN
    SELECT COALESCE(SUM(amount_pending), 0) INTO v_total_pendente
    FROM sales WHERE store_id = p_store_id AND payment_status IN ('pending','partial')
      AND deleted_at IS NULL AND due_date < CURRENT_DATE;

    SELECT COALESCE(SUM(net_total), 1) INTO v_total_vendas
    FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
      AND created_at::DATE BETWEEN v_start AND v_end;

    v_dlq := ROUND((v_total_pendente / NULLIF(v_total_vendas, 0) * 100)::NUMERIC, 2);
  END;

  RETURN QUERY
  SELECT
    g.id,
    g.goal_type,
    g.target_value,
    CASE g.goal_type
      WHEN 'faturamento'  THEN v_faturamento
      WHEN 'lucro'        THEN v_lucro
      WHEN 'recebimentos' THEN v_recebimentos
      WHEN 'inadimplencia' THEN v_dlq
    END AS realized,
    CASE g.goal_type
      WHEN 'inadimplencia' THEN
        -- Para inadimplência, menor é melhor — meta é estar abaixo do target
        ROUND(GREATEST(0, (1 - v_dlq / NULLIF(g.target_value, 0)) * 100)::NUMERIC, 1)
      ELSE
        ROUND(LEAST(
          CASE WHEN g.target_value > 0
            THEN (CASE g.goal_type
              WHEN 'faturamento'  THEN v_faturamento
              WHEN 'lucro'        THEN v_lucro
              WHEN 'recebimentos' THEN v_recebimentos
              ELSE 0 END) / g.target_value * 100
            ELSE 0
          END,
          100
        )::NUMERIC, 1)
    END AS progress_pct,
    g.notes,
    CASE g.goal_type
      WHEN 'inadimplencia' THEN v_dlq <= g.target_value
      WHEN 'faturamento'   THEN v_faturamento >= g.target_value * 0.75
      WHEN 'lucro'         THEN v_lucro >= g.target_value * 0.75
      WHEN 'recebimentos'  THEN v_recebimentos >= g.target_value * 0.75
      ELSE false
    END AS on_track
  FROM finance_goals g
  WHERE g.store_id = p_store_id
    AND g.period_month = v_month
    AND g.period_year  = v_year
  ORDER BY g.goal_type;
END;
$$;
REVOKE ALL ON FUNCTION public.get_finance_goals_progress FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_finance_goals_progress TO authenticated;

-- ── RPC: Upsert meta ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_finance_goal(
  p_store_id    UUID,
  p_goal_type   TEXT,
  p_month       INT,
  p_year        INT,
  p_target      NUMERIC,
  p_notes       TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF public.get_my_role() NOT IN ('owner','admin','manager','finance') THEN
    RAISE EXCEPTION 'Permissão insuficiente';
  END IF;

  INSERT INTO finance_goals (store_id, goal_type, period_month, period_year, target_value, notes, created_by)
  VALUES (p_store_id, p_goal_type, p_month, p_year, p_target, p_notes, auth.uid())
  ON CONFLICT (store_id, goal_type, period_month, period_year)
  DO UPDATE SET target_value = EXCLUDED.target_value, notes = EXCLUDED.notes, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_finance_goal FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_finance_goal TO authenticated;

-- ── RPC: Deletar meta ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_finance_goal(p_id UUID, p_store_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  DELETE FROM finance_goals WHERE id = p_id AND store_id = p_store_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_finance_goal FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_finance_goal TO authenticated;

-- ── RPC: Listar Centros de Custo ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cost_centers(p_store_id UUID)
RETURNS SETOF public.finance_cost_centers
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM finance_cost_centers
  WHERE store_id = p_store_id AND store_id = get_my_store_id()
  ORDER BY category, name;
$$;
REVOKE ALL ON FUNCTION public.get_cost_centers FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cost_centers TO authenticated;

-- ── RPC: Upsert Centro de Custo ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_cost_center(
  p_store_id  UUID,
  p_id        UUID DEFAULT NULL,
  p_name      TEXT DEFAULT NULL,
  p_category  TEXT DEFAULT NULL,
  p_budget    NUMERIC DEFAULT NULL,
  p_active    BOOLEAN DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF public.get_my_role() NOT IN ('owner','admin','manager','finance') THEN
    RAISE EXCEPTION 'Permissão insuficiente';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO finance_cost_centers (store_id, name, category, budget_monthly, is_active, created_by)
    VALUES (p_store_id, p_name, p_category, COALESCE(p_budget, 0), COALESCE(p_active, true), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE finance_cost_centers SET
      name           = COALESCE(p_name, name),
      category       = COALESCE(p_category, category),
      budget_monthly = COALESCE(p_budget, budget_monthly),
      is_active      = COALESCE(p_active, is_active),
      updated_at     = now()
    WHERE id = p_id AND store_id = p_store_id
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_cost_center FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_cost_center TO authenticated;

-- ── RPC: Dashboard Executivo Finance ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_executive_finance_dashboard(p_store_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month       INT := EXTRACT(MONTH FROM CURRENT_DATE)::INT;
  v_year        INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_start       DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_end         DATE := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  v_receita_mes      NUMERIC := 0;
  v_receita_semana   NUMERIC := 0;
  v_receita_hoje     NUMERIC := 0;
  v_despesas_mes     NUMERIC := 0;
  v_lucro_mes        NUMERIC := 0;
  v_margem           NUMERIC := 0;
  v_recebido_mes     NUMERIC := 0;
  v_a_receber        NUMERIC := 0;
  v_a_pagar          NUMERIC := 0;
  v_dlq_rate         NUMERIC := 0;
  v_prev_receita     NUMERIC := 0;
  v_prev_lucro       NUMERIC := 0;
  v_goals_on_track   INT := 0;
  v_goals_total      INT := 0;
  v_cashflow_hoje    NUMERIC := 0;
  v_saldo_corrente   NUMERIC := 0;
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  -- Receitas
  SELECT COALESCE(SUM(net_total), 0) INTO v_receita_mes
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at::DATE BETWEEN v_start AND v_end;

  SELECT COALESCE(SUM(net_total), 0) INTO v_receita_semana
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at::DATE >= CURRENT_DATE - 6;

  SELECT COALESCE(SUM(net_total), 0) INTO v_receita_hoje
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at::DATE = CURRENT_DATE;

  -- Despesas mês
  SELECT COALESCE(SUM(amount), 0) INTO v_despesas_mes
  FROM cash_entries WHERE store_id = p_store_id AND entry_type = 'expense'
    AND occurred_at::DATE BETWEEN v_start AND v_end;

  v_lucro_mes := v_receita_mes - v_despesas_mes;
  v_margem    := CASE WHEN v_receita_mes > 0 THEN ROUND((v_lucro_mes / v_receita_mes * 100)::NUMERIC, 1) ELSE 0 END;

  -- Recebimentos efetivos
  SELECT COALESCE(SUM(amount), 0) INTO v_recebido_mes
  FROM payments WHERE store_id = p_store_id
    AND created_at::DATE BETWEEN v_start AND v_end;

  -- A Receber (pendente)
  SELECT COALESCE(SUM(amount_pending), 0) INTO v_a_receber
  FROM sales WHERE store_id = p_store_id AND payment_status IN ('pending','partial')
    AND deleted_at IS NULL;

  -- A Pagar (pendente)
  SELECT COALESCE(SUM(amount), 0) INTO v_a_pagar
  FROM accounts_payable WHERE store_id = p_store_id AND status = 'pending';

  -- Inadimplência
  DECLARE v_total_pending NUMERIC; v_total_sales NUMERIC;
  BEGIN
    SELECT COALESCE(SUM(amount_pending), 0) INTO v_total_pending
    FROM sales WHERE store_id = p_store_id AND payment_status IN ('pending','partial')
      AND deleted_at IS NULL AND due_date < CURRENT_DATE;
    SELECT COALESCE(SUM(net_total), 1) INTO v_total_sales
    FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
      AND created_at::DATE BETWEEN v_start AND v_end;
    v_dlq_rate := ROUND((v_total_pending / NULLIF(v_total_sales, 0) * 100)::NUMERIC, 1);
  END;

  -- Mês anterior (receita + lucro)
  DECLARE v_prev_start DATE; v_prev_end DATE; v_prev_desp NUMERIC;
  BEGIN
    v_prev_start := (v_start - INTERVAL '1 month')::DATE;
    v_prev_end   := v_start - 1;
    SELECT COALESCE(SUM(net_total), 0) INTO v_prev_receita
    FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
      AND created_at::DATE BETWEEN v_prev_start AND v_prev_end;
    SELECT COALESCE(SUM(amount), 0) INTO v_prev_desp
    FROM cash_entries WHERE store_id = p_store_id AND entry_type = 'expense'
      AND occurred_at::DATE BETWEEN v_prev_start AND v_prev_end;
    v_prev_lucro := v_prev_receita - v_prev_desp;
  END;

  -- Metas
  SELECT COUNT(*), COUNT(*) FILTER (WHERE on_track) INTO v_goals_total, v_goals_on_track
  FROM get_finance_goals_progress(p_store_id, v_month, v_year);

  -- Saldo atual (caixa)
  SELECT COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount ELSE -amount END), 0) INTO v_saldo_corrente
  FROM cash_entries WHERE store_id = p_store_id;

  RETURN jsonb_build_object(
    'receita_mes',        v_receita_mes,
    'receita_semana',     v_receita_semana,
    'receita_hoje',       v_receita_hoje,
    'receita_growth_pct', CASE WHEN v_prev_receita > 0 THEN ROUND(((v_receita_mes - v_prev_receita) / v_prev_receita * 100)::NUMERIC, 1) ELSE NULL END,
    'despesas_mes',       v_despesas_mes,
    'lucro_mes',          v_lucro_mes,
    'lucro_growth_pct',   CASE WHEN v_prev_lucro <> 0 THEN ROUND(((v_lucro_mes - v_prev_lucro) / ABS(v_prev_lucro) * 100)::NUMERIC, 1) ELSE NULL END,
    'margem_pct',         v_margem,
    'recebido_mes',       v_recebido_mes,
    'a_receber',          v_a_receber,
    'a_pagar',            v_a_pagar,
    'delinquency_rate',   v_dlq_rate,
    'saldo_caixa',        v_saldo_corrente,
    'goals_total',        v_goals_total,
    'goals_on_track',     v_goals_on_track
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_executive_finance_dashboard FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_executive_finance_dashboard TO authenticated;

-- ── RPC: Análise de Risco de Recebimento (AR) ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_ar_risk_analysis(
  p_store_id UUID,
  p_limit    INT DEFAULT 20
) RETURNS TABLE (
  customer_id     UUID,
  customer_name   TEXT,
  total_pending   NUMERIC,
  overdue_amount  NUMERIC,
  max_days_late   INT,
  payment_rate    NUMERIC,
  risk_score      INT,
  risk_level      TEXT,
  avg_delay_days  NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_store_id() <> p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  RETURN QUERY
  WITH customer_sales AS (
    SELECT
      s.customer_id,
      c.name AS customer_name,
      SUM(s.amount_pending)  AS total_pending,
      SUM(s.amount_pending) FILTER (WHERE s.due_date < CURRENT_DATE) AS overdue_amount,
      MAX(GREATEST(0, CURRENT_DATE - s.due_date)) FILTER (WHERE s.due_date < CURRENT_DATE AND s.payment_status IN ('pending','partial')) AS max_days_late,
      AVG(GREATEST(0, CURRENT_DATE - s.due_date)) FILTER (WHERE s.due_date < CURRENT_DATE AND s.payment_status IN ('pending','partial')) AS avg_delay_days,
      COUNT(*) FILTER (WHERE s.payment_status = 'paid') AS paid_count,
      COUNT(*) AS total_count,
      SUM(s.net_total) AS total_sold
    FROM sales s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.store_id = p_store_id
      AND s.deleted_at IS NULL
      AND s.customer_id IS NOT NULL
      AND s.payment_status IN ('pending','partial')
    GROUP BY s.customer_id, c.name
    HAVING SUM(s.amount_pending) > 0
  )
  SELECT
    cs.customer_id,
    cs.customer_name,
    cs.total_pending,
    COALESCE(cs.overdue_amount, 0),
    COALESCE(cs.max_days_late, 0),
    ROUND((COALESCE(cs.paid_count, 0)::NUMERIC / NULLIF(cs.total_count, 0) * 100)::NUMERIC, 1) AS payment_rate,
    -- Risk score 0-100
    LEAST(100, GREATEST(0,
      -- Days overdue component (0-50)
      (CASE
        WHEN COALESCE(cs.max_days_late, 0) = 0  THEN 0
        WHEN cs.max_days_late < 30               THEN 15
        WHEN cs.max_days_late < 60               THEN 30
        WHEN cs.max_days_late < 90               THEN 45
        ELSE 50
      END) +
      -- Amount component (0-30)
      LEAST(30, (cs.total_pending / NULLIF(cs.total_sold, 0) * 30)::INT) +
      -- History component (0-20): low payment rate = high risk
      (20 - LEAST(20, COALESCE(cs.paid_count, 0)::NUMERIC / NULLIF(cs.total_count, 0) * 20)::INT)
    ))::INT AS risk_score,
    CASE
      WHEN LEAST(100, GREATEST(0,
        (CASE WHEN COALESCE(cs.max_days_late,0) = 0 THEN 0 WHEN cs.max_days_late < 30 THEN 15 WHEN cs.max_days_late < 60 THEN 30 WHEN cs.max_days_late < 90 THEN 45 ELSE 50 END) +
        LEAST(30, (cs.total_pending / NULLIF(cs.total_sold, 0) * 30)::INT) +
        (20 - LEAST(20, COALESCE(cs.paid_count,0)::NUMERIC / NULLIF(cs.total_count,0) * 20)::INT)
      )) >= 70 THEN 'alto'
      WHEN LEAST(100, GREATEST(0,
        (CASE WHEN COALESCE(cs.max_days_late,0) = 0 THEN 0 WHEN cs.max_days_late < 30 THEN 15 WHEN cs.max_days_late < 60 THEN 30 WHEN cs.max_days_late < 90 THEN 45 ELSE 50 END) +
        LEAST(30, (cs.total_pending / NULLIF(cs.total_sold, 0) * 30)::INT) +
        (20 - LEAST(20, COALESCE(cs.paid_count,0)::NUMERIC / NULLIF(cs.total_count,0) * 20)::INT)
      )) >= 40 THEN 'medio'
      ELSE 'baixo'
    END AS risk_level,
    ROUND(COALESCE(cs.avg_delay_days, 0)::NUMERIC, 1)
  FROM customer_sales cs
  ORDER BY risk_score DESC, total_pending DESC
  LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.get_ar_risk_analysis FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ar_risk_analysis TO authenticated;

-- ── RPC: Visão consolidada multi-empresa ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_consolidated_finance(p_group_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month    INT := EXTRACT(MONTH FROM CURRENT_DATE)::INT;
  v_year     INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_start    DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_end      DATE := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  v_result   JSONB;
BEGIN
  -- Verificar que o usuário é dono do grupo
  IF NOT EXISTS (SELECT 1 FROM store_groups WHERE id = p_group_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado ao grupo';
  END IF;

  SELECT jsonb_build_object(
    'group_id',          p_group_id,
    'period',            format('%s/%s', LPAD(v_month::TEXT, 2, '0'), v_year::TEXT),
    'store_count',       COUNT(DISTINCT sgm.store_id),
    'receita_total',     COALESCE(SUM(s.net_total), 0),
    'a_receber_total',   COALESCE(SUM(s.amount_pending) FILTER (WHERE s.payment_status IN ('pending','partial') AND s.deleted_at IS NULL), 0),
    'a_pagar_total',     COALESCE(SUM(ap.amount) FILTER (WHERE ap.status = 'pending'), 0),
    'stores', jsonb_agg(DISTINCT jsonb_build_object(
      'store_id', sgm.store_id,
      'store_name', st.name
    ))
  ) INTO v_result
  FROM store_group_members sgm
  JOIN stores st ON st.id = sgm.store_id
  LEFT JOIN sales s ON s.store_id = sgm.store_id AND s.created_at::DATE BETWEEN v_start AND v_end AND s.deleted_at IS NULL
  LEFT JOIN accounts_payable ap ON ap.store_id = sgm.store_id
  WHERE sgm.group_id = p_group_id;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_consolidated_finance FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consolidated_finance TO authenticated;

-- ── RPC: Contas a pagar com alertas ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_payables_with_alerts(
  p_store_id UUID,
  p_status   TEXT DEFAULT 'pending'   -- 'pending'|'all'
) RETURNS TABLE (
  id UUID, description TEXT, category TEXT, amount NUMERIC,
  due_date DATE, status TEXT, supplier_name TEXT,
  cost_center_name TEXT, recurrence TEXT,
  alert_level TEXT, days_until_due INT
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    ap.id, ap.description, ap.category, ap.amount,
    ap.due_date, ap.status,
    sp.name AS supplier_name,
    cc.name AS cost_center_name,
    COALESCE(ap.recurrence, 'none') AS recurrence,
    CASE
      WHEN ap.due_date < CURRENT_DATE THEN 'vencido'
      WHEN ap.due_date = CURRENT_DATE THEN 'hoje'
      WHEN ap.due_date <= CURRENT_DATE + 3 THEN 'vencendo'
      ELSE 'ok'
    END AS alert_level,
    (ap.due_date - CURRENT_DATE)::INT AS days_until_due
  FROM accounts_payable ap
  LEFT JOIN suppliers sp ON sp.id = ap.supplier_id
  LEFT JOIN finance_cost_centers cc ON cc.id = ap.cost_center_id
  WHERE ap.store_id = p_store_id
    AND ap.store_id = get_my_store_id()
    AND (p_status = 'all' OR ap.status = p_status)
  ORDER BY ap.due_date ASC;
$$;
REVOKE ALL ON FUNCTION public.get_payables_with_alerts FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payables_with_alerts TO authenticated;
