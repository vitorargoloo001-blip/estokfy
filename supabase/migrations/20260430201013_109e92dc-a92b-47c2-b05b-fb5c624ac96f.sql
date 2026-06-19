CREATE OR REPLACE FUNCTION public.loyalty_recalc_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid := get_my_store_id();
  v_goal numeric;
  v_credit numeric;
  v_new_credits_count int := 0;
  v_new_credits_amount numeric := 0;
  v_progress_changes int := 0;
  v_sample jsonb;
BEGIN
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'Sem loja no contexto';
  END IF;

  SELECT COALESCE((settings->>'goal_amount')::numeric, 1000),
         COALESCE((settings->>'credit_amount')::numeric, 80)
    INTO v_goal, v_credit
    FROM store_settings
   WHERE store_id = v_store AND category = 'loyalty'
   LIMIT 1;

  v_goal   := COALESCE(v_goal, 1000);
  v_credit := COALESCE(v_credit, 80);

  WITH paid_totals AS (
    SELECT s.customer_id,
           COALESCE(SUM(s.amount_paid), 0) AS total_paid
      FROM sales s
     WHERE s.store_id = v_store
       AND s.customer_id IS NOT NULL
     GROUP BY s.customer_id
  ),
  expected AS (
    SELECT pt.customer_id,
           pt.total_paid,
           FLOOR(pt.total_paid / v_goal)::int AS expected_milestones
      FROM paid_totals pt
  ),
  current_credits AS (
    SELECT customer_id, COUNT(*)::int AS existing_milestones
      FROM loyalty_credits
     WHERE store_id = v_store
       AND status <> 'cancelled'
     GROUP BY customer_id
  ),
  diff AS (
    SELECT e.customer_id,
           e.total_paid,
           e.expected_milestones,
           COALESCE(cc.existing_milestones, 0) AS existing_milestones,
           GREATEST(0, e.expected_milestones - COALESCE(cc.existing_milestones, 0)) AS new_milestones
      FROM expected e
      LEFT JOIN current_credits cc ON cc.customer_id = e.customer_id
  )
  SELECT
    COALESCE(SUM(new_milestones), 0)::int,
    COALESCE(SUM(new_milestones * v_credit), 0)::numeric,
    COUNT(*) FILTER (WHERE new_milestones > 0)::int
  INTO v_new_credits_count, v_new_credits_amount, v_progress_changes
  FROM diff;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
    INTO v_sample
    FROM (
      SELECT c.name AS customer_name,
             d.total_paid,
             d.existing_milestones,
             d.expected_milestones,
             d.new_milestones,
             (d.new_milestones * v_credit) AS new_credit_amount
        FROM (
          SELECT e.customer_id,
                 e.total_paid,
                 e.expected_milestones,
                 COALESCE(cc.existing_milestones, 0) AS existing_milestones,
                 GREATEST(0, e.expected_milestones - COALESCE(cc.existing_milestones, 0)) AS new_milestones
            FROM (
              SELECT s.customer_id, COALESCE(SUM(s.amount_paid), 0) AS total_paid,
                     FLOOR(COALESCE(SUM(s.amount_paid), 0) / v_goal)::int AS expected_milestones
                FROM sales s
               WHERE s.store_id = v_store AND s.customer_id IS NOT NULL
               GROUP BY s.customer_id
            ) e
            LEFT JOIN (
              SELECT customer_id, COUNT(*)::int AS existing_milestones
                FROM loyalty_credits
               WHERE store_id = v_store AND status <> 'cancelled'
               GROUP BY customer_id
            ) cc ON cc.customer_id = e.customer_id
        ) d
        JOIN customers c ON c.id = d.customer_id
       WHERE d.new_milestones > 0
       ORDER BY d.new_milestones DESC, d.total_paid DESC
       LIMIT 10
    ) x;

  RETURN jsonb_build_object(
    'goal_amount', v_goal,
    'credit_amount', v_credit,
    'customers_affected', v_progress_changes,
    'new_credits_count', v_new_credits_count,
    'new_credits_amount', v_new_credits_amount,
    'sample', v_sample
  );
END;
$$;