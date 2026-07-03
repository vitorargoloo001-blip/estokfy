-- =====================================================================
-- Dashboard do vendedor — dados pessoais, sem lucro/recebimento da loja
--
-- get_seller_dashboard() calcula, sempre filtrado por created_by = o
-- próprio perfil chamador, agregados sobre sales/sale_items/returns.
-- Nunca retorna dados de outros funcionários nem totais da loja (lucro,
-- recebido, caixa) — seguro pra qualquer cargo chamar, já que só devolve
-- os próprios números de quem chamou.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_seller_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_profile uuid;
  v_today timestamptz := date_trunc('day', now());
  v_month_start timestamptz := date_trunc('month', now());
  v_today_count int;
  v_today_total numeric;
  v_month_count int;
  v_month_total numeric;
  v_customers_count int;
  v_products_qty numeric;
  v_returns_count int;
  v_goal_target numeric;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no_store'; END IF;

  SELECT id INTO v_profile FROM public.profiles
   WHERE auth_user_id = auth.uid() AND store_id = v_store LIMIT 1;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'perfil_nao_encontrado'; END IF;

  SELECT count(*), COALESCE(SUM(net_total), 0) INTO v_today_count, v_today_total
    FROM public.sales
   WHERE store_id = v_store AND created_by = v_profile AND deleted_at IS NULL
     AND status = 'paid' AND created_at >= v_today;

  SELECT count(*), COALESCE(SUM(net_total), 0) INTO v_month_count, v_month_total
    FROM public.sales
   WHERE store_id = v_store AND created_by = v_profile AND deleted_at IS NULL
     AND status = 'paid' AND created_at >= v_month_start;

  SELECT count(DISTINCT customer_id) INTO v_customers_count
    FROM public.sales
   WHERE store_id = v_store AND created_by = v_profile AND deleted_at IS NULL
     AND status = 'paid' AND created_at >= v_month_start AND customer_id IS NOT NULL;

  SELECT COALESCE(SUM(si.qty), 0) INTO v_products_qty
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
   WHERE s.store_id = v_store AND s.created_by = v_profile AND s.deleted_at IS NULL
     AND s.status = 'paid' AND s.created_at >= v_month_start;

  SELECT count(*) INTO v_returns_count
    FROM public.returns
   WHERE store_id = v_store AND created_by = v_profile AND created_at >= v_month_start;

  SELECT target_value INTO v_goal_target
    FROM public.finance_goals
   WHERE store_id = v_store AND goal_type = 'faturamento'
     AND period_month = EXTRACT(MONTH FROM now())::int
     AND period_year = EXTRACT(YEAR FROM now())::int
   LIMIT 1;

  RETURN jsonb_build_object(
    'today_sales_count', v_today_count,
    'today_sales_total', v_today_total,
    'month_sales_count', v_month_count,
    'month_sales_total', v_month_total,
    'avg_ticket', CASE WHEN v_month_count > 0 THEN v_month_total / v_month_count ELSE 0 END,
    'customers_served', v_customers_count,
    'products_sold', v_products_qty,
    'returns_count', v_returns_count,
    'goal_target', v_goal_target
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_seller_dashboard() TO authenticated;
