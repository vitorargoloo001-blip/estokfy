-- =====================================================================
-- Trocas & Devoluções com crédito ao cliente
-- Reaproveita a carteira existente (loyalty_credits) como crédito único.
-- ETAPA 1: origem do crédito + gerar crédito + devolução por item com crédito
-- =====================================================================

-- 1) Origem do crédito: 'loyalty' (fidelidade) | 'devolucao' | 'troca'
ALTER TABLE public.loyalty_credits
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'loyalty';
ALTER TABLE public.loyalty_credits
  ADD COLUMN IF NOT EXISTS source_return_id uuid;

-- 2) Gerar um crédito para o cliente (usado por devolução e, depois, pela troca)
CREATE OR REPLACE FUNCTION public.generate_customer_credit(
  p_store_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_origin text DEFAULT 'devolucao',
  p_reason text DEFAULT NULL,
  p_source_sale_id uuid DEFAULT NULL,
  p_source_return_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_credit_id uuid := gen_random_uuid();
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  IF v_ctx.store_id <> p_store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_ctx.role NOT IN ('owner','admin','manager','sales','stock') THEN
    RAISE EXCEPTION 'sem_permissao_para_troca';
  END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_credito'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'valor_invalido'; END IF;
  IF p_origin NOT IN ('loyalty','devolucao','troca') THEN RAISE EXCEPTION 'origem_invalida'; END IF;

  INSERT INTO public.loyalty_credits(
    id, store_id, customer_id, amount_generated, amount_used,
    reason, status, origin, source_sale_id, source_return_id, generated_at, created_at
  ) VALUES (
    v_credit_id, p_store_id, p_customer_id, round(p_amount, 2), 0,
    COALESCE(p_reason, CASE p_origin
      WHEN 'troca' THEN 'Crédito de troca'
      WHEN 'devolucao' THEN 'Crédito de devolução'
      ELSE 'Crédito' END),
    'available', p_origin, p_source_sale_id, p_source_return_id, now(), now()
  );

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'create', 'customer_credit', v_credit_id,
    jsonb_build_object('amount', round(p_amount,2), 'origin', p_origin, 'customer_id', p_customer_id,
                       'source_sale_id', p_source_sale_id, 'source_return_id', p_source_return_id));

  RETURN v_credit_id;
END;
$$;

-- 3) Devolução POR ITEM, gerando CRÉDITO (ou reembolso em dinheiro).
--    Não cancela a venda inteira (diferente da rotina antiga create_return_atomic).
CREATE OR REPLACE FUNCTION public.process_return_with_credit(
  p_store_id uuid,
  p_sale_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_refund_mode text DEFAULT 'credit'   -- 'credit' | 'cash'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx record;
  v_return_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product record;
  v_qty int;
  v_restock boolean;
  v_refund numeric;
  v_total_refund numeric := 0;
  v_customer uuid := p_customer_id;
  v_credit_id uuid;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  IF v_ctx.store_id <> p_store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_ctx.role NOT IN ('owner','admin','manager','sales','stock') THEN
    RAISE EXCEPTION 'sem_permissao_para_troca';
  END IF;
  IF p_refund_mode NOT IN ('credit','cash') THEN RAISE EXCEPTION 'modo_invalido'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'sem_itens'; END IF;

  -- cliente: usa o informado ou o da venda
  IF v_customer IS NULL AND p_sale_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer FROM public.sales
      WHERE id = p_sale_id AND store_id = p_store_id;
  END IF;

  INSERT INTO public.returns(id, store_id, sale_id, status, reason, notes, created_by)
  VALUES (v_return_id, p_store_id, p_sale_id, 'approved', p_reason, p_notes, v_ctx.profile_id);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::int;
    v_restock := COALESCE((v_item->>'restock')::boolean, true);
    v_refund := COALESCE((v_item->>'refund_amount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'qty_invalida'; END IF;

    SELECT * INTO v_product FROM public.products
      WHERE id = (v_item->>'product_id')::uuid AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'produto_invalido'; END IF;

    INSERT INTO public.return_items(return_id, sale_item_id, product_id, qty, restock, refund_amount)
    VALUES (v_return_id, NULLIF(v_item->>'sale_item_id','')::uuid, v_product.id, v_qty, v_restock, v_refund);

    IF v_restock THEN
      INSERT INTO public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by)
      VALUES (p_store_id, v_product.id, 'return_in', v_qty, v_product.cost_price, 'return', v_return_id, v_ctx.profile_id);
      UPDATE public.products SET on_hand = on_hand + v_qty, updated_at = now() WHERE id = v_product.id;
    END IF;

    v_total_refund := v_total_refund + v_refund;
  END LOOP;

  -- Devolução do valor: crédito ao cliente OU saída de caixa
  IF v_total_refund > 0 THEN
    IF p_refund_mode = 'credit' THEN
      IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_credito'; END IF;
      v_credit_id := public.generate_customer_credit(
        p_store_id, v_customer, v_total_refund, 'devolucao',
        'Crédito de devolução', p_sale_id, v_return_id
      );
    ELSE
      INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
      SELECT p_store_id, l.id, 'expense', 'devolucao', v_total_refund, 'return', v_return_id, 'Reembolso de devolução', v_ctx.profile_id
      FROM public.cash_ledger l WHERE l.store_id = p_store_id AND l.is_default = true LIMIT 1;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'create', 'return', v_return_id,
    jsonb_build_object('sale_id', p_sale_id, 'reason', p_reason, 'total_refund', v_total_refund,
                       'refund_mode', p_refund_mode, 'credit_id', v_credit_id, 'customer_id', v_customer));

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'total_refund', v_total_refund,
    'refund_mode', p_refund_mode,
    'credit_id', v_credit_id,
    'customer_id', v_customer
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_customer_credit(uuid, uuid, numeric, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_return_with_credit(uuid, uuid, uuid, text, jsonb, text, text) TO authenticated;
