-- =====================================================================
-- Tela de Vendas: status de conciliação visível para a vendedora.
--
-- A etiqueta "Confirmado pelo banco / Aguardando banco" lia
-- reconciliation_matches direto, mas a política de leitura dessa tabela só
-- inclui owner/admin/manager/finance. Para a vendedora (role 'sales') a
-- leitura voltava vazia e toda venda em Pix ficava "Aguardando banco" mesmo
-- depois de confirmada.
--
-- Em vez de abrir a tabela inteira (nota, justificativa, transação), esta
-- função devolve só o status de cada pagamento, da loja de quem chama.
-- Quando há mais de uma sugestão para o mesmo pagamento, vale a confirmada,
-- depois a divergente, depois a pendente. Sugestões ignoradas não contam.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_payments_bank_status(p_payment_ids uuid[])
RETURNS TABLE(payment_id uuid, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (rm.payment_id) rm.payment_id, rm.status
  FROM public.reconciliation_matches rm
  WHERE rm.payment_id = ANY(p_payment_ids[1:500])
    AND rm.store_id = public.get_my_store_id()
    AND rm.status IN ('pending','confirmed','disputed')
  ORDER BY rm.payment_id,
           CASE rm.status WHEN 'confirmed' THEN 0 WHEN 'disputed' THEN 1 ELSE 2 END,
           rm.created_at DESC
$$;

REVOKE EXECUTE ON FUNCTION public.get_payments_bank_status(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payments_bank_status(uuid[]) TO authenticated;
