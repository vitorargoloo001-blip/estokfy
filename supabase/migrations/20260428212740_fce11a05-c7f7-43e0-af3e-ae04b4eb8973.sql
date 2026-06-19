CREATE OR REPLACE FUNCTION public.dashboard_intelligence(p_limit int DEFAULT 8)
RETURNS TABLE(
  priority int,
  kind text,
  severity text,
  title text,
  description text,
  link text,
  entity_id uuid,
  metric numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sid uuid := public.get_my_store_id();
BEGIN
  RETURN QUERY
  WITH neg_margin AS (
    SELECT 1 AS pr, 'margin_negative'::text AS kd, 'critical'::text AS sv,
           ('Prejuízo: ' || p.name)::text AS ti,
           ('Preço de venda (R$ ' || p.sale_price || ') menor que custo (R$ ' || p.cost_price || ').')::text AS ds,
           '/produtos'::text AS lk, p.id AS eid, (p.sale_price - p.cost_price)::numeric AS mt
    FROM products p
    WHERE p.store_id=v_sid AND p.is_active AND p.sale_price>0 AND p.cost_price>p.sale_price
  ),
  zero_stock AS (
    SELECT 1, 'stock_out', 'critical',
           ('Sem estoque: ' || p.name)::text,
           'Produto ativo com 0 unidades em estoque.'::text,
           '/produtos', p.id, p.on_hand::numeric
    FROM products p
    WHERE p.store_id=v_sid AND p.is_active AND p.on_hand <= 0
  ),
  payables AS (
    SELECT 1, 'payable_overdue', 'critical',
           ('Conta vencida: ' || ap.description)::text,
           ('Venceu em ' || to_char(ap.due_date,'DD/MM/YYYY') || ' — R$ ' || to_char(ap.amount,'FM999G999G990D00'))::text,
           '/contas-a-pagar', ap.id, ap.amount
    FROM accounts_payable ap
    WHERE ap.store_id=v_sid AND ap.status='pending' AND ap.due_date<current_date
  ),
  low_stock AS (
    SELECT 2, 'stock_low', 'warning',
           ('Estoque baixo: ' || p.name)::text,
           ('Restam ' || p.on_hand || ' un (mínimo ' || p.minimum_stock || ').')::text,
           '/produtos', p.id, p.on_hand::numeric
    FROM products p
    WHERE p.store_id=v_sid AND p.is_active AND p.minimum_stock>0
      AND p.on_hand>0 AND p.on_hand<=p.minimum_stock
  ),
  receivables AS (
    SELECT 2, 'receivable_overdue', 'warning',
           'A receber vencido'::text,
           ('R$ ' || to_char(s.amount_pending,'FM999G999G990D00') || ' pendente desde ' || to_char(s.due_date,'DD/MM/YYYY'))::text,
           '/contas-a-receber', s.id, s.amount_pending
    FROM sales s
    WHERE s.store_id=v_sid AND s.payment_status IN ('pending','partial')
      AND s.due_date IS NOT NULL AND s.due_date<current_date
  ),
  bad_margin AS (
    SELECT 3, 'margin_low', 'warning',
           ('Margem baixa: ' || p.name)::text,
           ('Margem de ' || ROUND(((p.sale_price-p.cost_price)/NULLIF(p.sale_price,0))*100,1) || '% — vendeu ' || COALESCE(s30.qty,0) || ' un nos últimos 30d.')::text,
           '/produtos', p.id,
           ROUND(((p.sale_price-p.cost_price)/NULLIF(p.sale_price,0))*100,2)
    FROM products p
    LEFT JOIN (
      SELECT si.product_id, SUM(si.qty)::numeric AS qty
      FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.store_id=v_sid AND s.created_at>=now()-interval '30 days'
      GROUP BY si.product_id
    ) s30 ON s30.product_id=p.id
    WHERE p.store_id=v_sid AND p.is_active AND p.sale_price>0 AND p.cost_price <= p.sale_price
      AND ((p.sale_price-p.cost_price)/p.sale_price)*100 < 15
      AND COALESCE(s30.qty,0) > 0
  ),
  idle AS (
    SELECT 4, 'product_idle', 'info',
           ('Produto parado: ' || p.name)::text,
           (p.on_hand || ' un em estoque, sem venda há mais de 60 dias.')::text,
           '/produtos', p.id, p.on_hand::numeric
    FROM products p
    WHERE p.store_id=v_sid AND p.is_active AND p.on_hand>0
      AND NOT EXISTS (
        SELECT 1 FROM sale_items si JOIN sales s ON s.id=si.sale_id
        WHERE si.product_id=p.id AND s.store_id=v_sid AND s.created_at>=now()-interval '60 days'
      )
  ),
  unioned AS (
    SELECT * FROM neg_margin
    UNION ALL SELECT * FROM zero_stock
    UNION ALL SELECT * FROM payables
    UNION ALL SELECT * FROM low_stock
    UNION ALL SELECT * FROM receivables
    UNION ALL SELECT * FROM bad_margin
    UNION ALL SELECT * FROM idle
  )
  SELECT u.pr, u.kd, u.sv, u.ti, u.ds, u.lk, u.eid, u.mt
  FROM unioned u
  ORDER BY u.pr ASC,
           CASE u.sv WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END ASC
  LIMIT p_limit;
END;
$$;