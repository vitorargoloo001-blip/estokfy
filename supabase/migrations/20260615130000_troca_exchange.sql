-- =====================================================================
-- ETAPA 2: TROCA (exchange) atômica.
-- Devolve item(ns) -> gera crédito (origin='troca') -> cria a venda do novo
-- produto reaproveitando create_sale_atomic, com o crédito como DESCONTO.
-- Diferença: sobra = saldo credor (fica disponível) | falta = a pagar (via p_payments,
-- inclusive 'pending' => contas a receber). Tudo automático: estoque, financeiro,
-- contas a receber, auditoria.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.process_exchange_atomic(
  p_store_id uuid,
  p_sale_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_return_items jsonb,
  p_new_items jsonb,
  p_payments jsonb DEFAULT '[]'::jsonb,
  p_delivery jsonb DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_customer uuid := p_customer_id;
  v_return jsonb;
  v_return_value numeric := 0;
  v_credit_id uuid;
  v_new_sale_id uuid;
  v_new_gross numeric := 0;
  v_item jsonb;
  v_prod record;
  v_credit_apply numeric := 0;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  IF v_ctx.store_id <> p_store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;

  IF v_customer IS NULL AND p_sale_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer FROM public.sales WHERE id = p_sale_id AND store_id = p_store_id;
  END IF;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_troca'; END IF;
  IF p_new_items IS NULL OR jsonb_array_length(p_new_items) = 0 THEN RAISE EXCEPTION 'sem_itens_novos'; END IF;

  -- 1) Devolução -> gera crédito (reusa rotina já testada), depois marca origem 'troca'
  v_return := public.process_return_with_credit(
    p_store_id, p_sale_id, v_customer, p_reason, p_return_items, p_notes, 'credit'
  );
  v_return_value := COALESCE((v_return->>'total_refund')::numeric, 0);
  v_credit_id := NULLIF(v_return->>'credit_id','')::uuid;
  IF v_credit_id IS NOT NULL THEN
    UPDATE public.loyalty_credits SET origin = 'troca', reason = 'Crédito de troca'
     WHERE id = v_credit_id;
  END IF;

  -- 2) Valor bruto dos novos itens
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_items)
  LOOP
    SELECT * INTO v_prod FROM public.products
      WHERE id = (v_item->>'product_id')::uuid AND store_id = p_store_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'produto_invalido'; END IF;
    v_new_gross := v_new_gross + COALESCE(NULLIF(v_item->>'unit_price','')::numeric, v_prod.sale_price) * (v_item->>'qty')::int;
  END LOOP;

  -- 3) Crédito da troca aplicado ao novo produto (limitado ao valor do novo)
  v_credit_apply := LEAST(v_return_value, v_new_gross);

  -- 4) Cria a venda do novo produto: crédito vira DESCONTO; diferença via p_payments
  v_new_sale_id := public.create_sale_atomic(
    p_store_id, v_customer, p_new_items, COALESCE(p_payments, '[]'::jsonb),
    COALESCE(p_delivery, jsonb_build_object('method','pickup','shipping_fee',0,'delivery_cost',0)),
    v_credit_apply, NULL, NULL, COALESCE(p_notes, 'Troca')
  );

  -- 5) Consome o crédito da troca referente ao desconto aplicado (registra utilização)
  IF v_credit_apply > 0 AND v_credit_id IS NOT NULL THEN
    UPDATE public.loyalty_credits
       SET amount_used = amount_used + v_credit_apply,
           status = CASE WHEN (amount_generated - (amount_used + v_credit_apply)) <= 0 THEN 'used' ELSE 'partially_used' END
     WHERE id = v_credit_id;
    INSERT INTO public.loyalty_credit_uses(store_id, credit_id, customer_id, sale_id, amount_applied)
    VALUES (p_store_id, v_credit_id, v_customer, v_new_sale_id, v_credit_apply);
  END IF;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'create', 'exchange', v_new_sale_id,
    jsonb_build_object('return_id', v_return->>'return_id', 'new_sale_id', v_new_sale_id,
      'new_gross', v_new_gross, 'credit_generated', v_return_value, 'credit_applied', v_credit_apply,
      'difference_to_pay', GREATEST(v_new_gross - v_return_value, 0),
      'leftover_credit', GREATEST(v_return_value - v_new_gross, 0)));

  RETURN jsonb_build_object(
    'return_id', v_return->>'return_id',
    'new_sale_id', v_new_sale_id,
    'new_gross', v_new_gross,
    'credit_generated', v_return_value,
    'credit_applied', v_credit_apply,
    'difference_to_pay', GREATEST(v_new_gross - v_return_value, 0),
    'leftover_credit', GREATEST(v_return_value - v_new_gross, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_exchange_atomic(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text) TO authenticated;
