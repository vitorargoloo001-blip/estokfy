-- =====================================================================
-- Connect: RPC para relatórios de conciliação (PDF/Excel/CSV)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_reconciliation_report(
  p_store_id   UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_txns    jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager','finance','viewer')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  SELECT jsonb_build_object(
    'period_start',         p_start_date,
    'period_end',           p_end_date,
    'total_transactions',   COUNT(*),
    'total_amount',         COALESCE(SUM(bt.amount) FILTER (WHERE bt.transaction_type = 'credit'), 0),
    'reconciled_count',     COUNT(*) FILTER (WHERE bt.status = 'reconciled'),
    'reconciled_amount',    COALESCE(SUM(bt.amount) FILTER (WHERE bt.status = 'reconciled' AND bt.transaction_type = 'credit'), 0),
    'divergent_count',      COUNT(*) FILTER (WHERE bt.status = 'divergent'),
    'divergent_amount',     COALESCE(SUM(bt.amount) FILTER (WHERE bt.status = 'divergent' AND bt.transaction_type = 'credit'), 0),
    'pending_count',        COUNT(*) FILTER (WHERE bt.status = 'pending'),
    'pending_amount',       COALESCE(SUM(bt.amount) FILTER (WHERE bt.status = 'pending' AND bt.transaction_type = 'credit'), 0),
    'ignored_count',        COUNT(*) FILTER (WHERE bt.status = 'ignored'),
    'reconciliation_rate',  CASE
      WHEN COUNT(*) FILTER (WHERE bt.transaction_type = 'credit') > 0
        THEN round(
          COUNT(*) FILTER (WHERE bt.status = 'reconciled' AND bt.transaction_type = 'credit')::numeric
          / COUNT(*) FILTER (WHERE bt.transaction_type = 'credit') * 100
        , 1)
      ELSE 0
    END
  )
  INTO v_summary
  FROM public.bank_transactions bt
  WHERE bt.store_id = p_store_id
    AND bt.transaction_date BETWEEN p_start_date AND p_end_date;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                 bt.id,
        'transaction_date',   bt.transaction_date,
        'amount',             bt.amount,
        'method',             COALESCE(bt.method, 'other'),
        'description',        COALESCE(bt.description, '—'),
        'bank_name',          COALESCE(bt.bank_name, '—'),
        'status',             bt.status,
        'transaction_type',   bt.transaction_type,
        'sale_id',            COALESCE(rm.sale_id, bt.sale_id),
        'customer_name',      COALESCE(c.name, '—'),
        'match_type',         COALESCE(rm.match_type, '—'),
        'confidence_score',   rm.confidence_score,
        'confirmed_at',       rm.confirmed_at,
        'confirmed_by_email', u.email
      )
      ORDER BY bt.transaction_date DESC, bt.amount DESC
    ),
    '[]'::jsonb
  )
  INTO v_txns
  FROM public.bank_transactions bt
  LEFT JOIN public.reconciliation_matches rm
    ON rm.bank_transaction_id = bt.id AND rm.status = 'confirmed'
  LEFT JOIN public.sales s ON s.id = COALESCE(rm.sale_id, bt.sale_id)
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.profiles pr ON pr.id = rm.confirmed_by
  LEFT JOIN auth.users u ON u.id = pr.auth_user_id
  WHERE bt.store_id = p_store_id
    AND bt.transaction_date BETWEEN p_start_date AND p_end_date;

  RETURN jsonb_build_object(
    'summary',      v_summary,
    'transactions', v_txns
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reconciliation_report(UUID, DATE, DATE) TO authenticated;
