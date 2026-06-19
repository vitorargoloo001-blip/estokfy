-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  profile_id uuid NULL,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  description text NULL,
  link text NULL,
  entity_type text NULL,
  entity_id uuid NULL,
  dedupe_key text NULL,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_store ON public.notifications(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(store_id, read_at) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON public.notifications(store_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notif_select ON public.notifications FOR SELECT TO authenticated
  USING (store_id = public.get_my_store_id());

CREATE POLICY notif_insert ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (store_id = public.get_my_store_id());

CREATE POLICY notif_update ON public.notifications FOR UPDATE TO authenticated
  USING (store_id = public.get_my_store_id())
  WITH CHECK (store_id = public.get_my_store_id());

CREATE POLICY notif_delete ON public.notifications FOR DELETE TO authenticated
  USING (store_id = public.get_my_store_id() AND public.get_my_role() = ANY(ARRAY['owner','admin','manager']));

-- ============ FUNÇÃO: refresh de notificações automáticas ============
CREATE OR REPLACE FUNCTION public.refresh_store_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_store uuid;
  v_count int := 0;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  v_store := v_ctx.store_id;

  -- Estoque sem produto (zero)
  INSERT INTO public.notifications(store_id, type, severity, title, description, link, entity_type, entity_id, dedupe_key)
  SELECT v_store, 'stock_out', 'critical',
         'Sem estoque: ' || p.name,
         'O produto ' || p.name || ' está com estoque zerado.',
         '/produtos',
         'product', p.id,
         'stock_out:' || p.id::text || ':' || to_char(now(),'YYYY-MM-DD')
  FROM public.products p
  WHERE p.store_id = v_store AND p.is_active = true AND p.on_hand <= 0
  ON CONFLICT (store_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Estoque baixo
  INSERT INTO public.notifications(store_id, type, severity, title, description, link, entity_type, entity_id, dedupe_key)
  SELECT v_store, 'stock_low', 'warning',
         'Estoque baixo: ' || p.name,
         'Restam ' || p.on_hand || ' unidades (mínimo: ' || p.minimum_stock || ').',
         '/produtos',
         'product', p.id,
         'stock_low:' || p.id::text || ':' || to_char(now(),'YYYY-MM-DD')
  FROM public.products p
  WHERE p.store_id = v_store AND p.is_active = true
    AND p.on_hand > 0 AND p.minimum_stock > 0 AND p.on_hand <= p.minimum_stock
  ON CONFLICT (store_id, dedupe_key) DO NOTHING;

  -- Contas a pagar vencidas
  INSERT INTO public.notifications(store_id, type, severity, title, description, link, entity_type, entity_id, dedupe_key)
  SELECT v_store, 'payable_overdue', 'critical',
         'Conta vencida: ' || ap.description,
         'Vencida em ' || to_char(ap.due_date,'DD/MM/YYYY') || ' — R$ ' || to_char(ap.amount,'FM999G999G990D00'),
         '/contas-a-pagar',
         'payable', ap.id,
         'payable_overdue:' || ap.id::text || ':' || to_char(now(),'YYYY-MM-DD')
  FROM public.accounts_payable ap
  WHERE ap.store_id = v_store AND ap.status = 'pending' AND ap.due_date < current_date
  ON CONFLICT (store_id, dedupe_key) DO NOTHING;

  -- Vendas pendentes vencidas (a receber)
  INSERT INTO public.notifications(store_id, type, severity, title, description, link, entity_type, entity_id, dedupe_key)
  SELECT v_store, 'receivable_overdue', 'warning',
         'Venda vencida (a receber)',
         'R$ ' || to_char(s.amount_pending,'FM999G999G990D00') || ' pendente desde ' || to_char(s.due_date,'DD/MM/YYYY'),
         '/contas-a-receber',
         'sale', s.id,
         'recv_overdue:' || s.id::text || ':' || to_char(now(),'YYYY-MM-DD')
  FROM public.sales s
  WHERE s.store_id = v_store
    AND s.payment_status IN ('pending','partial')
    AND s.due_date IS NOT NULL AND s.due_date < current_date
  ON CONFLICT (store_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============ FUNÇÃO: stats por produto (margem, parado, previsão) ============
CREATE OR REPLACE FUNCTION public.product_analytics(p_store_id uuid)
RETURNS TABLE(
  product_id uuid,
  name text,
  sku text,
  on_hand int,
  minimum_stock int,
  cost_price numeric,
  sale_price numeric,
  margin_value numeric,
  margin_pct numeric,
  qty_sold_30d numeric,
  daily_avg numeric,
  days_to_empty numeric,
  last_sale_at timestamptz,
  days_idle int
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH sales_30 AS (
    SELECT si.product_id, COALESCE(SUM(si.qty),0)::numeric AS qty_30,
           MAX(s.created_at) AS last_sold
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.store_id = p_store_id AND s.created_at >= now() - interval '30 days'
    GROUP BY si.product_id
  ),
  last_sale AS (
    SELECT si.product_id, MAX(s.created_at) AS last_sold
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.store_id = p_store_id
    GROUP BY si.product_id
  )
  SELECT
    p.id, p.name, p.sku, p.on_hand, p.minimum_stock, p.cost_price, p.sale_price,
    (p.sale_price - p.cost_price) AS margin_value,
    CASE WHEN p.sale_price > 0 THEN ((p.sale_price - p.cost_price) / p.sale_price * 100) ELSE 0 END AS margin_pct,
    COALESCE(s30.qty_30, 0) AS qty_sold_30d,
    COALESCE(s30.qty_30, 0) / 30.0 AS daily_avg,
    CASE WHEN COALESCE(s30.qty_30,0) > 0 THEN p.on_hand / (s30.qty_30 / 30.0) ELSE NULL END AS days_to_empty,
    ls.last_sold AS last_sale_at,
    CASE WHEN ls.last_sold IS NULL THEN NULL ELSE EXTRACT(DAY FROM (now() - ls.last_sold))::int END AS days_idle
  FROM public.products p
  LEFT JOIN sales_30 s30 ON s30.product_id = p.id
  LEFT JOIN last_sale ls ON ls.product_id = p.id
  WHERE p.store_id = p_store_id AND p.is_active = true;
$$;

-- ============ FUNÇÃO: histórico unificado do produto ============
CREATE OR REPLACE FUNCTION public.product_history(p_product_id uuid)
RETURNS TABLE(
  occurred_at timestamptz,
  event_type text,
  qty int,
  unit_value numeric,
  total_value numeric,
  reference_type text,
  reference_id uuid,
  actor_name text,
  notes text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Movimentações de estoque
  SELECT sm.created_at, sm.movement_type, sm.qty, sm.unit_cost,
         COALESCE(sm.total_amount, sm.unit_cost * ABS(sm.qty)),
         sm.reference_type, sm.reference_id,
         pr.full_name, sm.reason
  FROM public.stock_movements sm
  LEFT JOIN public.profiles pr ON pr.id = sm.created_by
  WHERE sm.product_id = p_product_id
    AND sm.store_id = public.get_my_store_id()
  UNION ALL
  -- Alterações de preço/custo via audit_logs
  SELECT al.created_at, 'audit:'||al.action, NULL::int, NULL::numeric, NULL::numeric,
         al.entity, al.entity_id, pr.full_name,
         (al.after_json->>'note')
  FROM public.audit_logs al
  LEFT JOIN public.profiles pr ON pr.id = al.actor_profile_id
  WHERE al.store_id = public.get_my_store_id()
    AND al.entity = 'product'
    AND al.entity_id = p_product_id
  ORDER BY 1 DESC;
$$;

-- ============ FUNÇÃO: cliente 360 ============
CREATE OR REPLACE FUNCTION public.customer_360(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'customer', to_jsonb(c.*),
    'totals', (
      SELECT jsonb_build_object(
        'sales_count', COUNT(*),
        'total_spent', COALESCE(SUM(net_total),0),
        'total_paid', COALESCE(SUM(amount_paid),0),
        'total_pending', COALESCE(SUM(amount_pending),0),
        'avg_ticket', COALESCE(AVG(net_total),0),
        'last_purchase_at', MAX(created_at)
      ) FROM public.sales WHERE store_id = v_store AND customer_id = p_customer_id
    ),
    'recent_sales', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x.*)), '[]'::jsonb) FROM (
        SELECT id, created_at, net_total, payment_status, amount_pending, due_date
        FROM public.sales
        WHERE store_id = v_store AND customer_id = p_customer_id
        ORDER BY created_at DESC LIMIT 20
      ) x
    ),
    'returns', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x.*)), '[]'::jsonb) FROM (
        SELECT r.id, r.created_at, r.reason, r.status
        FROM public.returns r
        JOIN public.sales s ON s.id = r.sale_id
        WHERE s.customer_id = p_customer_id AND r.store_id = v_store
        ORDER BY r.created_at DESC LIMIT 20
      ) x
    )
  ) INTO v_result
  FROM public.customers c
  WHERE c.id = p_customer_id AND c.store_id = v_store;

  RETURN v_result;
END;
$$;