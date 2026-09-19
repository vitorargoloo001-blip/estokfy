-- Repair RPCs against the production schema; preserve signatures and tenant boundaries.
BEGIN;
CREATE OR REPLACE FUNCTION public.add_reconciliation_note(p_match_id uuid, p_note text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
  v_old_note TEXT;
BEGIN
  PERFORM public.require_active_profile();
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.notes
  INTO v_store_id, v_old_note
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_match_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Conciliação não encontrada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.reconciliation_matches
  SET notes = p_note, updated_at = now()
  WHERE id = p_match_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    'Observação adicionada à conciliação',
    'update',
    'reconciliation_match', p_match_id,
    jsonb_build_object(
      'before', jsonb_build_object('notes', v_old_note),
      'after',  jsonb_build_object('notes', p_note)
    )
  );

  RETURN QUERY SELECT true, 'Observação salva com sucesso';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.add_reconciliation_note(uuid,text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ai_get_business_health_score(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','finance') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

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
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL AND p.method <> 'pending' AND p.paid_at >= NOW() - INTERVAL '30 days';

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
  SELECT COUNT(*), COUNT(*) FILTER (WHERE on_hand = 0)
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
  SELECT COALESCE(SUM(on_hand * COALESCE(cost_price, sale_price, 0)),0) INTO v_est_total_val
  FROM products WHERE store_id = p_store_id AND is_active = TRUE;
  IF v_est_total_val = 0 THEN v_est_total_val := 1; END IF;

  SELECT COALESCE(SUM(on_hand * COALESCE(cost_price, sale_price, 0)),0) INTO v_parados_val
  FROM products p WHERE p.store_id = p_store_id AND p.is_active = TRUE AND p.on_hand > 0
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
    EXECUTE format('SELECT CASE WHEN COUNT(*) = 0 THEN 5 ELSE LEAST(10, ROUND((COUNT(*) FILTER (WHERE status=''reconciled'')::NUMERIC / COUNT(*)) * 10)::INT) END FROM bank_transactions WHERE store_id = %L AND transaction_date >= NOW() - INTERVAL ''30 days''', p_store_id) INTO v_s_connect;
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
$function$;
REVOKE EXECUTE ON FUNCTION public.ai_get_business_health_score(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ai_get_customer_summary(p_store_id uuid, p_period_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role             TEXT    := get_my_role();
  v_total_clientes   BIGINT  := 0;
  v_inadimplentes    BIGINT  := 0;
  v_valor_inadi      NUMERIC := 0;
  v_sem_comprar_60d  BIGINT  := 0;
  v_ticket_cliente   NUMERIC := 0;
  v_top_clientes     JSONB   := '[]';
BEGIN
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','finance') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

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
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.total DESC) INTO v_top_clientes FROM (
    SELECT c.name, SUM(s.net_total) AS total, COUNT(s.id) AS pedidos
    FROM sales s JOIN customers c ON c.id=s.customer_id
    WHERE s.store_id=p_store_id AND s.deleted_at IS NULL AND s.status <> 'cancelled'
      AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
    GROUP BY c.id,c.name ORDER BY total DESC,c.id LIMIT 5
  ) t;

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
$function$;
REVOKE EXECUTE ON FUNCTION public.ai_get_customer_summary(uuid,integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ai_get_employee_summary(p_store_id uuid, p_period_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role          TEXT  := get_my_role();
  v_total_vend    BIGINT := 0;
  v_melhor        TEXT   := '';
  v_melhor_total  NUMERIC := 0;
  v_ranking       JSONB  := '[]';
BEGIN
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  SELECT COUNT(*) INTO v_total_vend FROM profiles WHERE store_id = p_store_id;

  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.total DESC) INTO v_ranking FROM (
    SELECT pr.full_name AS name, SUM(s.net_total) AS total, COUNT(s.id) AS pedidos
    FROM sales s JOIN profiles pr ON pr.id=s.created_by
    WHERE s.store_id=p_store_id AND s.deleted_at IS NULL AND s.status <> 'cancelled'
      AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
    GROUP BY pr.id,pr.full_name
  ) t;

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
$function$;
REVOKE EXECUTE ON FUNCTION public.ai_get_employee_summary(uuid,integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ai_get_inventory_summary(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','finance','stock') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

  SELECT COUNT(*), COALESCE(SUM(on_hand * COALESCE(cost_price, sale_price, 0)),0)
  INTO v_total_prods, v_valor_estoque
  FROM products WHERE store_id = p_store_id AND is_active = TRUE;

  SELECT COUNT(*) INTO v_sem_estoque
  FROM products WHERE store_id = p_store_id AND is_active = TRUE AND on_hand = 0;

  SELECT COUNT(*) INTO v_est_baixo
  FROM products WHERE store_id = p_store_id AND is_active = TRUE AND on_hand > 0 AND on_hand <= 5;

  -- Parados (sem venda há 30 dias)
  SELECT COUNT(*), COALESCE(SUM(on_hand * COALESCE(cost_price, sale_price, 0)),0)
  INTO v_parados, v_valor_parado
  FROM products p WHERE p.store_id = p_store_id AND p.is_active = TRUE AND p.on_hand > 0
    AND NOT EXISTS (
      SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id = p.id AND s.deleted_at IS NULL AND s.created_at > NOW() - INTERVAL '30 days'
    );

  -- Top produtos com ruptura iminente
  SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', on_hand) ORDER BY on_hand)
  INTO v_top_ruptura
  FROM (SELECT name, on_hand FROM products WHERE store_id=p_store_id AND is_active=TRUE AND on_hand BETWEEN 1 AND 5 ORDER BY on_hand,id LIMIT 5) low_stock;

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
$function$;
REVOKE EXECUTE ON FUNCTION public.ai_get_inventory_summary(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ai_get_sales_summary(p_store_id uuid, p_period_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager','finance') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

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
  GROUP BY p.id, p.name ORDER BY SUM(si.qty) DESC LIMIT 1;

  -- Top categoria
  SELECT c.name INTO v_top_cat
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN products p ON p.id = si.product_id
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
    AND c.id IS NOT NULL
  GROUP BY c.id, c.name ORDER BY SUM(si.qty * si.unit_price) DESC LIMIT 1;

  -- Top vendedor
  SELECT pr.full_name INTO v_top_vend
  FROM sales s JOIN profiles pr ON pr.id = s.created_by
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND s.created_at >= NOW() - (p_period_days||' days')::INTERVAL
    AND s.created_by IS NOT NULL
  GROUP BY pr.id, pr.full_name ORDER BY SUM(s.net_total) DESC LIMIT 1;

  -- Top método
  SELECT method INTO v_top_metodo
  FROM payments p JOIN sales s ON s.id = p.sale_id
  WHERE s.store_id = p_store_id AND s.deleted_at IS NULL
    AND p.method <> 'pending' AND p.paid_at >= NOW() - (p_period_days||' days')::INTERVAL
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
$function$;
REVOKE EXECUTE ON FUNCTION public.ai_get_sales_summary(uuid,integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.bulk_confirm_reconciliation(p_store_id uuid, p_match_ids uuid[])
 RETURNS TABLE(confirmed_count integer, failed_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_confirmed integer := 0;
  v_failed uuid[] := '{}';
  v_match_id uuid;
  v_result record;
BEGIN
  PERFORM public._assert_store_membership(p_store_id);
  FOREACH v_match_id IN ARRAY COALESCE(p_match_ids, '{}'::uuid[]) LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.reconciliation_matches WHERE id=v_match_id AND store_id=p_store_id AND status='pending') THEN
        RAISE EXCEPTION 'Conciliação não pendente nesta loja';
      END IF;
      SELECT * INTO v_result FROM public.confirm_reconciliation(v_match_id);
      IF v_result.success IS DISTINCT FROM true THEN RAISE EXCEPTION '%',v_result.message; END IF;
      v_confirmed := v_confirmed+1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := array_append(v_failed,v_match_id);
    END;
  END LOOP;
  RETURN QUERY SELECT v_confirmed,v_failed;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.bulk_confirm_reconciliation(uuid,uuid[]) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.classify_divergence(p_tx_id uuid, p_type text, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
  v_old_type TEXT;
BEGIN
  PERFORM public.require_active_profile();
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT bt.store_id, bt.divergence_type
  INTO v_store_id, v_old_type
  FROM public.bank_transactions bt WHERE bt.id = p_tx_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Transação não encontrada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id
      AND p.store_id = v_store_id AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.bank_transactions
  SET divergence_type   = p_type,
      divergence_reason = p_reason,
      updated_at        = now()
  WHERE id = p_tx_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    'Divergência classificada: ' || p_type,
    'update',
    'bank_transaction', p_tx_id,
    jsonb_build_object(
      'before', jsonb_build_object('divergence_type', v_old_type),
      'after',  jsonb_build_object('divergence_type', p_type, 'divergence_reason', p_reason)
    )
  );

  RETURN QUERY SELECT true, 'Divergência classificada com sucesso';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.classify_divergence(uuid,text,text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.create_bank_connection(p_store_id uuid, p_bank_name text, p_agency text, p_account_number text, p_account_type text, p_account_holder text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_new_id UUID;
BEGIN
  PERFORM public.require_active_profile();
  SELECT p.id INTO v_user_id FROM public.profiles p WHERE p.auth_user_id = auth.uid() AND p.is_active LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.store_id = p_store_id
      AND p.role IN ('owner', 'admin', 'manager')
  ) THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Permission denied';
    RETURN;
  END IF;

  INSERT INTO public.bank_connections (
    store_id, bank_name, agency, account_number, account_type,
    account_holder, status, created_by
  )
  VALUES (
    p_store_id, p_bank_name, p_agency, p_account_number, p_account_type,
    p_account_holder, 'pending', v_user_id
  )
  RETURNING bank_connections.id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, true, 'Connection created successfully';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_bank_connection(uuid,text,text,text,text,text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.generate_ai_insights(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN RAISE EXCEPTION 'Permissão insuficiente'; END IF;

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
      format('Vendas dos últimos 30 dias (R$ %s) estão %s%% abaixo do período anterior (R$ %s).',
        TO_CHAR(v_rec_atual,'FM999G999D00'), ROUND((1 - v_rec_atual/v_rec_prev)*100,0), TO_CHAR(v_rec_prev,'FM999G999D00')),
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
      format('%s%% dos valores a receber estão vencidos (R$ %s). Total a receber: R$ %s.',
        ROUND(v_overdue_pct*100,1), TO_CHAR(v_overdue,'FM999G999D00'), TO_CHAR(v_a_receber,'FM999G999D00')),
      'Entre em contato com os clientes em atraso. Priorize os de maior valor.');
    v_inserted := v_inserted + 1;
  END IF;

  -- 3. Estoque baixo crítico
  SELECT COUNT(*), COUNT(*) FILTER (WHERE on_hand <= 5 AND on_hand > 0)
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
  WHERE p.store_id = p_store_id AND p.is_active = TRUE AND p.on_hand > 0
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
    SELECT p.name, SUM(si.qty)
    INTO v_top_name, v_top_qty
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
    WHERE s.store_id = p_store_id AND s.deleted_at IS NULL AND s.created_at >= NOW() - INTERVAL '7 days'
    GROUP BY p.id, p.name ORDER BY 2 DESC LIMIT 1;

    IF v_top_name IS NOT NULL THEN
      SELECT COALESCE(SUM(si.qty),0)
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
          format('"%s" teve %s%% mais vendas esta semana vs semana anterior (%s vs %s unidades).',
            v_top_name, ROUND((v_top_qty::NUMERIC/v_top_prev - 1)*100,0), v_top_qty, v_top_prev),
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
$function$;
REVOKE EXECUTE ON FUNCTION public.generate_ai_insights(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_executive_finance_dashboard(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

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
  FROM payments WHERE store_id = p_store_id AND method <> 'pending'
    AND paid_at::DATE BETWEEN v_start AND v_end;

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
$function$;
REVOKE EXECUTE ON FUNCTION public.get_executive_finance_dashboard(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_finance_goals_progress(p_store_id uuid, p_month integer DEFAULT NULL::integer, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(goal_id uuid, goal_type text, target_value numeric, realized numeric, progress_pct numeric, notes text, on_track boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  v_start := make_date(v_year, v_month, 1);
  v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Faturamento
  SELECT COALESCE(SUM(net_total), 0) INTO v_faturamento
  FROM sales WHERE store_id = p_store_id AND deleted_at IS NULL
    AND created_at::DATE BETWEEN v_start AND v_end;

  -- Recebimentos (pagamentos efetivos)
  SELECT COALESCE(SUM(amount), 0) INTO v_recebimentos
  FROM payments WHERE store_id = p_store_id AND method <> 'pending'
    AND paid_at::DATE BETWEEN v_start AND v_end;

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
$function$;
REVOKE EXECUTE ON FUNCTION public.get_finance_goals_progress(uuid,integer,integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_pending_matches_by_confidence(p_store_id uuid, p_confidence_level text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, bank_transaction_id uuid, transaction_date date, transaction_amount numeric, transaction_description text, bank_name text, method text, suggested_sale_id uuid, sale_date date, sale_amount numeric, customer_name text, customer_phone text, confidence_score integer, confidence_level text, match_type text, amount_difference numeric, date_difference_days integer, match_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    rm.sale_id,
    s.sale_date,
    s.net_total                  AS sale_amount,
    c.name                       AS customer_name,
    c.phone                      AS customer_phone,
    ROUND(rm.confidence_score)::integer AS confidence_score,
    CASE
      WHEN rm.confidence_score >= 85 THEN 'high'
      WHEN rm.confidence_score >= 60 THEN 'medium'
      ELSE 'low'
    END                          AS confidence_level,
    rm.match_type,
    rm.amount_difference,
    rm.date_difference_days,
    rm.match_reason
  FROM public.reconciliation_matches rm
  JOIN public.bank_transactions bt ON bt.id = rm.bank_transaction_id
  LEFT JOIN public.sales     s  ON s.id = rm.sale_id
  LEFT JOIN public.customers c  ON c.id = s.customer_id
  WHERE rm.store_id = p_store_id
    AND rm.status = 'pending'
    AND (
      p_confidence_level IS NULL
      OR (p_confidence_level = 'high'   AND rm.confidence_score >= 85)
      OR (p_confidence_level = 'medium' AND rm.confidence_score >= 60 AND rm.confidence_score < 85)
      OR (p_confidence_level = 'low'    AND rm.confidence_score < 60)
    )
  ORDER BY rm.confidence_score DESC, bt.transaction_date DESC
  LIMIT p_limit;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_pending_matches_by_confidence(uuid,text,integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_professional_cashflow(p_store_id uuid, p_period text DEFAULT 'month'::text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS TABLE(day date, confirmed_in numeric, projected_in numeric, total_out numeric, daily_balance numeric, running_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start DATE;
  v_end   DATE;
BEGIN
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;

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
        AND status = 'pending'
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
$function$;
REVOKE EXECUTE ON FUNCTION public.get_professional_cashflow(uuid,text,date,date) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ignore_divergence(p_tx_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
BEGIN
  PERFORM public.require_active_profile();
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT bt.store_id INTO v_store_id
  FROM public.bank_transactions bt WHERE bt.id = p_tx_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Transação não encontrada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id
      AND p.store_id = v_store_id AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.bank_transactions
  SET status            = 'ignored',
      divergence_reason = COALESCE(p_reason, divergence_reason),
      updated_at        = now()
  WHERE id = p_tx_id;

  -- Também atualiza qualquer match pendente
  UPDATE public.reconciliation_matches
  SET status     = 'ignored',
      updated_at = now()
  WHERE bank_transaction_id = p_tx_id
    AND status IN ('pending', 'divergent');

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    'Divergência ignorada',
    'reconciliation',
    'bank_transaction', p_tx_id,
    jsonb_build_object(
      'before',  jsonb_build_object('status', 'divergent'),
      'after',   jsonb_build_object('status', 'ignored'),
      'reason',  p_reason
    )
  );

  RETURN QUERY SELECT true, 'Divergência ignorada com sucesso';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.ignore_divergence(uuid,text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.ignore_reconciliation(p_reconciliation_id uuid)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_store_id       UUID;
  v_transaction_id UUID;
  v_tx_amount      NUMERIC;
BEGIN
  PERFORM public.require_active_profile();
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.bank_transaction_id
  INTO v_store_id, v_transaction_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_reconciliation_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permission denied';
    RETURN;
  END IF;

  SELECT bt.amount INTO v_tx_amount
  FROM public.bank_transactions bt WHERE bt.id = v_transaction_id;

  UPDATE public.reconciliation_matches
  SET status = 'ignored', updated_at = now()
  WHERE id = p_reconciliation_id;

  UPDATE public.bank_transactions
  SET status = 'ignored', updated_at = now()
  WHERE id = v_transaction_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    'Transação ignorada na conciliação',
    'reconciliation',
    'reconciliation_match', p_reconciliation_id,
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'amount', v_tx_amount
    )
  );

  RETURN QUERY SELECT true, 'Reconciliation ignored';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.ignore_reconciliation(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.register_pluggy_item_auth(p_store_id uuid, p_pluggy_item_id text, p_institution_name text, p_connector_id integer DEFAULT NULL::integer, p_connector_name text DEFAULT NULL::text, p_accounts jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(pluggy_item_db_id uuid, bank_connection_ids uuid[], is_new boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item_id  UUID;
  v_is_new   BOOLEAN := false;
  v_conn_ids UUID[]  := '{}';
  v_account  JSONB;
  v_conn_id  UUID;
  v_acct_type TEXT;
BEGIN
  PERFORM public.require_active_profile();
  -- Verificar acesso à loja
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid() AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado à loja';
  END IF;

  -- Upsert pluggy_items
  INSERT INTO public.pluggy_items (
    store_id, pluggy_item_id, institution_name,
    connector_id, connector_name,
    pluggy_account_ids, accounts_json,
    status, last_updated_at
  ) VALUES (
    p_store_id, p_pluggy_item_id, p_institution_name,
    p_connector_id, p_connector_name,
    ARRAY(SELECT jsonb_array_elements(p_accounts) ->> 'id'),
    p_accounts,
    'updated', now()
  )
  ON CONFLICT (store_id, pluggy_item_id) DO UPDATE SET
    institution_name   = EXCLUDED.institution_name,
    connector_id       = COALESCE(EXCLUDED.connector_id, public.pluggy_items.connector_id),
    connector_name     = COALESCE(EXCLUDED.connector_name, public.pluggy_items.connector_name),
    pluggy_account_ids = EXCLUDED.pluggy_account_ids,
    accounts_json      = EXCLUDED.accounts_json,
    status             = 'updated',
    last_updated_at    = now(),
    updated_at         = now()
  RETURNING id, (xmax = 0) INTO v_item_id, v_is_new;

  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id
    FROM public.pluggy_items
    WHERE store_id = p_store_id AND pluggy_item_id = p_pluggy_item_id;
    v_is_new := false;
  END IF;

  -- Criar/atualizar bank_connections para cada conta Pluggy
  FOR v_account IN SELECT * FROM jsonb_array_elements(p_accounts) LOOP
    -- Mapear tipo de conta
    v_acct_type := CASE
      WHEN (v_account->>'type') = 'CREDIT' THEN 'other'
      WHEN (v_account->>'subtype') IN ('SAVINGS_ACCOUNT') THEN 'savings'
      ELSE 'checking'
    END;

    SELECT bc.id INTO v_conn_id FROM public.bank_connections bc
    WHERE bc.store_id = p_store_id AND bc.pluggy_item_id = v_item_id AND bc.pluggy_account_id = (v_account->>'id') LIMIT 1;
    IF v_conn_id IS NULL THEN
    -- Insert only while holding the parent-item lock
    INSERT INTO public.bank_connections (
      store_id, bank_name, bank_code, agency, account_number,
      account_type, status, is_active,
      pluggy_item_id, pluggy_account_id
    ) VALUES (
      p_store_id,
      p_institution_name,
      NULL,
      v_account->>'routingNumber',
      COALESCE(v_account->>'number', v_account->>'id'),
      v_acct_type,
      'connected',
      true,
      v_item_id,
      v_account->>'id'
    );

    END IF;
    SELECT id INTO v_conn_id
    FROM public.bank_connections
    WHERE store_id = p_store_id AND pluggy_account_id = (v_account->>'id')
    LIMIT 1;

    IF v_conn_id IS NOT NULL THEN
      UPDATE public.bank_connections
      SET status = 'connected', is_active = true, pluggy_item_id = v_item_id, updated_at = now()
      WHERE id = v_conn_id;

      v_conn_ids := v_conn_ids || v_conn_id;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_item_id, v_conn_ids, v_is_new;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.register_pluggy_item_auth(uuid,text,text,integer,text,jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.reopen_reconciliation(p_reconciliation_id uuid)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_store_id       UUID;
  v_transaction_id UUID;
BEGIN
  PERFORM public.require_active_profile();
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.bank_transaction_id
  INTO v_store_id, v_transaction_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_reconciliation_id AND rm.status = 'ignored';

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Conciliação não encontrada ou não está ignorada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.reconciliation_matches
  SET status = 'pending', updated_at = now()
  WHERE id = p_reconciliation_id;

  UPDATE public.bank_transactions
  SET status = 'pending', updated_at = now()
  WHERE id = v_transaction_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    'Conciliação reaberta para revisão',
    'reconciliation',
    'reconciliation_match', p_reconciliation_id,
    jsonb_build_object('transaction_id', v_transaction_id)
  );

  RETURN QUERY SELECT true, 'Conciliação reaberta com sucesso';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reopen_reconciliation(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.resolve_divergence_link(p_tx_id uuid, p_sale_id uuid)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  UUID;
  v_store_id UUID;
  v_match_id UUID;
BEGIN
  PERFORM public.require_active_profile();
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT bt.store_id INTO v_store_id
  FROM public.bank_transactions bt WHERE bt.id = p_tx_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Transação não encontrada';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id
      AND p.store_id = v_store_id AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE id=p_sale_id AND store_id=v_store_id AND deleted_at IS NULL AND status<>'cancelled') THEN
    RETURN QUERY SELECT false, 'Venda não encontrada nesta loja';
    RETURN;
  END IF;
  -- Upsert: atualiza match existente ou cria novo
  SELECT id INTO v_match_id FROM public.reconciliation_matches
  WHERE bank_transaction_id = p_tx_id LIMIT 1;

  IF v_match_id IS NULL THEN
    INSERT INTO public.reconciliation_matches (
      store_id, bank_transaction_id, sale_id,
      match_type, confidence_score, status,
      confirmed_by, confirmed_at, match_reason
    ) VALUES (
      v_store_id, p_tx_id, p_sale_id,
      'manual', 100, 'confirmed',
      v_user_id, now(),
      'Vinculado manualmente via Central de Divergências'
    ) RETURNING id INTO v_match_id;
  ELSE
    UPDATE public.reconciliation_matches
    SET sale_id          = p_sale_id,
        status           = 'confirmed',
        match_type       = 'manual',
        confidence_score = 100,
        confirmed_by     = v_user_id,
        confirmed_at     = now(),
        match_reason     = 'Vinculado manualmente via Central de Divergências',
        updated_at       = now()
    WHERE id = v_match_id;
  END IF;

  -- Atualizar status da transação
  UPDATE public.bank_transactions
  SET status           = 'reconciled',
      divergence_type  = NULL,
      divergence_reason = NULL,
      updated_at       = now()
  WHERE id = p_tx_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    'Divergência resolvida por vinculação manual',
    'reconciliation',
    'bank_transaction', p_tx_id,
    jsonb_build_object(
      'before', jsonb_build_object('status', 'divergent'),
      'after',  jsonb_build_object('status', 'reconciled', 'sale_id', p_sale_id),
      'match_id', v_match_id
    )
  );

  RETURN QUERY SELECT true, 'Divergência resolvida com sucesso';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.resolve_divergence_link(uuid,uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.super_admin_ai_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_email TEXT;
  v_result JSONB;
BEGIN
  PERFORM public._assert_platform_admin();

  SELECT jsonb_build_object(
    'total_lojas', COUNT(DISTINCT s.id),
    'lojas_com_risco', COUNT(DISTINCT s.id) FILTER (
      WHERE EXISTS (SELECT 1 FROM ai_insights ai WHERE ai.store_id = s.id AND ai.severity = 'critico' AND ai.status = 'active')
    ),
    'insights_criticos', (SELECT COUNT(*) FROM ai_insights WHERE severity = 'critico' AND status = 'active'),
    'insights_atencao',  (SELECT COUNT(*) FROM ai_insights WHERE severity = 'atencao' AND status = 'active'),
    'top_lojas', (
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.receita_mes DESC) FROM (
        SELECT s2.name AS nome, COALESCE(SUM(sa.net_total),0) AS receita_mes,
          (SELECT COUNT(*) FROM ai_insights WHERE store_id=s2.id AND status='active') AS insights_ativos
        FROM stores s2 LEFT JOIN sales sa ON sa.store_id=s2.id AND sa.deleted_at IS NULL
          AND sa.status<>'cancelled' AND sa.created_at>=NOW()-INTERVAL '30 days'
        GROUP BY s2.id,s2.name ORDER BY receita_mes DESC,s2.id LIMIT 10
      ) t
    ),
    'lojas_sem_acesso_7d', (
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT s3.name AS nome, MAX(ai2.created_at) AS ultimo_acesso
        FROM stores s3 LEFT JOIN ai_interactions ai2 ON ai2.store_id=s3.id
        GROUP BY s3.id,s3.name
        HAVING MAX(ai2.created_at)<NOW()-INTERVAL '7 days' OR MAX(ai2.created_at) IS NULL
        ORDER BY MAX(ai2.created_at) NULLS FIRST,s3.id LIMIT 5
      ) t
    )
  ) INTO v_result
  FROM stores s;

  RETURN v_result;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.super_admin_ai_overview() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.trigger_ai_automations(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_auto     RECORD;
  v_insight  RECORD;
  v_triggered INT := 0;
  v_notifs   INT := 0;
  v_health   JSONB;
  v_diverg   INT;
  v_offline  INT;
BEGIN
  IF get_my_store_id() IS DISTINCT FROM p_store_id THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Para cada automação ativa de tipo monitoramento
  FOR v_auto IN
    SELECT * FROM connect_automations
    WHERE store_id = p_store_id AND is_active = true
      AND type IN ('divergence_alert','bank_disconnected','cashflow_risk')
  LOOP
    v_triggered := v_triggered + 1;

    IF v_auto.type = 'divergence_alert' THEN
      -- Contar divergências abertas
      SELECT COUNT(*) INTO v_diverg
      FROM bank_transactions
      WHERE store_id = p_store_id AND status = 'divergent';

      DECLARE v_min_diverg INT := COALESCE((v_auto.config->>'min_divergences')::INT, 1);
      BEGIN
        IF v_diverg >= v_min_diverg THEN
          PERFORM create_connect_notification(
            p_store_id,
            'divergence_alert',
            format('⚠️ %s divergência(s) detectada(s)', v_diverg),
            format('Existem %s transações bancárias divergentes aguardando revisão.', v_diverg),
            CASE WHEN v_diverg > 10 THEN 'critical' WHEN v_diverg > 3 THEN 'warning' ELSE 'info' END,
            'internal',
            v_auto.id, NULL,
            jsonb_build_object('divergent_count', v_diverg)
          );
          v_notifs := v_notifs + 1;
        END IF;
      END;
    END IF;

    IF v_auto.type = 'bank_disconnected' THEN
      DECLARE v_max_hours INT := COALESCE((v_auto.config->>'max_hours_offline')::INT, 24);
      BEGIN
        SELECT COUNT(*) INTO v_offline
        FROM bank_connections
        WHERE store_id = p_store_id
          AND status IN ('error','disconnected')
          AND (last_sync_at IS NULL OR last_sync_at < now() - (v_max_hours || ' hours')::INTERVAL);

        IF v_offline > 0 THEN
          PERFORM create_connect_notification(
            p_store_id,
            'bank_disconnected',
            format('🏦 %s banco(s) desconectado(s)', v_offline),
            format('%s conexão(ões) bancária(s) sem sincronização há mais de %s horas.', v_offline, v_max_hours),
            'critical',
            'internal',
            v_auto.id, NULL,
            jsonb_build_object('offline_count', v_offline)
          );
          v_notifs := v_notifs + 1;
        END IF;
      END;
    END IF;

    IF v_auto.type = 'cashflow_risk' THEN
      DECLARE
        v_threshold NUMERIC := COALESCE((v_auto.config->>'at_risk_threshold_pct')::NUMERIC, 30);
        v_at_risk   NUMERIC;
        v_total_fc  NUMERIC;
      BEGIN
        SELECT COALESCE(SUM(amount), 0) INTO v_at_risk
        FROM bank_transactions
        WHERE store_id = p_store_id
          AND transaction_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
          AND transaction_type = 'debit';

        SELECT COALESCE(SUM(net_total), 0) INTO v_total_fc
        FROM sales
        WHERE store_id = p_store_id
          AND payment_status IN ('pending','partial')
          AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
          AND deleted_at IS NULL;

        IF v_total_fc > 0 AND (v_at_risk / v_total_fc * 100) >= v_threshold THEN
          PERFORM create_connect_notification(
            p_store_id,
            'cashflow_risk',
            '📈 Risco no fluxo de caixa detectado',
            format('%s%% do fluxo previsto (R$ %s) está em risco nos próximos 30 dias.',
              ROUND(v_at_risk / v_total_fc * 100,0), ROUND(v_at_risk,2)),
            'warning',
            'internal',
            v_auto.id, NULL,
            jsonb_build_object('at_risk', v_at_risk, 'total_forecast', v_total_fc)
          );
          v_notifs := v_notifs + 1;
        END IF;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('triggered', v_triggered, 'notifications_created', v_notifs);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.trigger_ai_automations(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.undo_reconciliation(p_match_id uuid)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    UUID;
  v_store_id   UUID;
  v_tx_id      UUID;
  v_old_status TEXT;
  v_sale_id    UUID;
BEGIN
  PERFORM public.require_active_profile();
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.bank_transaction_id, rm.status, rm.sale_id
  INTO v_store_id, v_tx_id, v_old_status, v_sale_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_match_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 'Conciliação não encontrada';
    RETURN;
  END IF;

  IF v_old_status != 'confirmed' THEN
    RETURN QUERY SELECT false, 'Somente conciliações confirmadas podem ser desfeitas';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.store_id = v_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RETURN QUERY SELECT false, 'Permissão negada';
    RETURN;
  END IF;

  UPDATE public.reconciliation_matches
  SET status       = 'pending',
      confirmed_at = NULL,
      confirmed_by = NULL,
      updated_at   = now()
  WHERE id = p_match_id;

  UPDATE public.bank_transactions
  SET status = 'pending', updated_at = now()
  WHERE id = v_tx_id;

  INSERT INTO public.connect_audit_logs (
    store_id, user_id, action, action_type,
    entity_type, entity_id, details
  ) VALUES (
    v_store_id, auth.uid(),
    'Conciliação desfeita (revertida para pendente)',
    'reconciliation',
    'reconciliation_match', p_match_id,
    jsonb_build_object(
      'before', jsonb_build_object('status', 'confirmed', 'sale_id', v_sale_id),
      'after',  jsonb_build_object('status', 'pending'),
      'transaction_id', v_tx_id
    )
  );

  RETURN QUERY SELECT true, 'Conciliação desfeita com sucesso';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.undo_reconciliation(uuid) FROM PUBLIC, anon;

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
  PERFORM public.require_active_profile();
  SELECT id INTO v_user_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT rm.store_id, rm.bank_transaction_id, rm.payment_id, rm.sale_id
  INTO v_store_id, v_transaction_id, v_match_payment_id, v_match_sale_id
  FROM public.reconciliation_matches rm
  WHERE rm.id = p_reconciliation_id AND rm.status = 'pending' FOR UPDATE;

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
  FROM public.bank_transactions bt WHERE bt.id = v_transaction_id FOR UPDATE;

  v_target_sale_id := COALESCE(p_sale_id, v_match_sale_id);

  IF v_target_sale_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sales WHERE id=v_target_sale_id AND store_id=v_store_id AND deleted_at IS NULL AND status<>'cancelled') THEN
    RETURN QUERY SELECT false, 'Venda não encontrada nesta loja';
    RETURN;
  END IF;
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
REVOKE EXECUTE ON FUNCTION public.confirm_reconciliation(uuid,uuid) FROM PUBLIC,anon;
COMMIT;
