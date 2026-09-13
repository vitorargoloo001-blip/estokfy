-- =====================================================================
-- FISCAL — vendas que ainda não têm nota lançada
--
-- Fecha o pedido de "registro automático": em vez de inventar documento
-- fiscal para toda venda (o que exigiria afrouxar invoice_number e o
-- índice anti-duplicidade, e encheria a base de rascunhos falsos em loja
-- que não emite nota em toda venda), o sistema aponta sozinho o que está
-- faltando e traz a nota pré-preenchida a partir da venda.
--
-- Assim nada é esquecido — que é o objetivo do módulo — sem registrar
-- número de nota que ainda não existe.
--
-- Só leitura. Não escreve em nada.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.list_sales_without_fiscal_document(
  p_store_id uuid,
  p_year int DEFAULT NULL,
  p_month int DEFAULT NULL,
  p_limit int DEFAULT 200
) RETURNS TABLE (
  sale_id uuid,
  sale_date date,
  net_total numeric,
  customer_id uuid,
  customer_name text,
  seller_name text,
  payment_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_fiscal_manage(p_store_id);

  RETURN QUERY
  SELECT
    s.id,
    s.sale_date,
    s.net_total,
    s.customer_id,
    c.name::text,
    pr.full_name::text,
    s.payment_status::text
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.profiles pr ON pr.id = s.created_by
  WHERE s.store_id = p_store_id
    AND s.deleted_at IS NULL
    AND s.status <> 'cancelled'
    AND (p_year IS NULL OR EXTRACT(YEAR FROM s.sale_date) = p_year)
    AND (p_month IS NULL OR EXTRACT(MONTH FROM s.sale_date) = p_month)
    -- sem nota ativa vinculada (nota cancelada não conta: a venda volta a
    -- precisar de documento)
    AND NOT EXISTS (
      SELECT 1 FROM public.fiscal_documents fd
       WHERE fd.sale_id = s.id
         AND fd.fiscal_status <> 'cancelled'
    )
  ORDER BY s.sale_date DESC, s.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 200), 1000));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.list_sales_without_fiscal_document(uuid, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sales_without_fiscal_document(uuid, int, int, int) TO authenticated;
