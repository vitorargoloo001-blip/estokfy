-- Add tenant isolation check to connect_search_sales_for_match
CREATE OR REPLACE FUNCTION public.connect_search_sales_for_match(
  p_store_id    UUID,
  p_amount      NUMERIC DEFAULT NULL,
  p_date        DATE    DEFAULT NULL,
  p_query       TEXT    DEFAULT NULL,
  p_limit       INTEGER DEFAULT 20
)
RETURNS TABLE (
  id             UUID,
  sale_number    TEXT,
  sale_date      DATE,
  net_total      NUMERIC,
  customer_name  TEXT,
  payment_status TEXT,
  amount_diff    NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.id::text,
    s.sale_date::date,
    s.net_total,
    COALESCE(c.name, 'Cliente não identificado'),
    s.payment_status,
    CASE WHEN p_amount IS NOT NULL THEN ABS(s.net_total - p_amount) ELSE NULL END
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  WHERE s.store_id = p_store_id
    AND s.deleted_at IS NULL
    AND s.status NOT IN ('cancelled','refunded','returned')
    AND (p_amount IS NULL OR ABS(s.net_total - p_amount) <= p_amount * 0.20)
    AND (p_date   IS NULL OR ABS(s.sale_date::date - p_date) <= 30)
    AND (p_query  IS NULL
         OR c.name ILIKE '%' || p_query || '%'
         OR s.notes ILIKE '%' || p_query || '%')
  ORDER BY
    CASE WHEN p_amount IS NOT NULL THEN ABS(s.net_total - p_amount) ELSE 0 END,
    CASE WHEN p_date   IS NOT NULL THEN ABS(s.sale_date::date - p_date) ELSE 0 END,
    s.sale_date DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_search_sales_for_match(UUID, NUMERIC, DATE, TEXT, INTEGER) TO authenticated;
