
CREATE OR REPLACE FUNCTION public.create_return_atomic(
  p_store_id uuid,
  p_sale_id uuid,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  
  IF v_ctx.store_id <> p_store_id THEN
    RAISE EXCEPTION 'store_invalida';
  END IF;
  IF v_ctx.role NOT IN ('owner','admin','manager','sales','stock') THEN
    RAISE EXCEPTION 'sem_permissao_para_troca';
  END IF;

  IF p_sale_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.sales WHERE id = p_sale_id AND store_id = p_store_id) THEN
      RAISE EXCEPTION 'venda_nao_encontrada';
    END IF;
  END IF;

  INSERT INTO public.returns(id, store_id, sale_id, status, reason, notes, created_by)
  VALUES (v_return_id, p_store_id, p_sale_id, 'approved', p_reason, p_notes, v_ctx.profile_id);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::int;
    v_restock := coalesce((v_item->>'restock')::boolean, false);
    v_refund := coalesce((v_item->>'refund_amount')::numeric, 0);

    IF v_qty <= 0 THEN RAISE EXCEPTION 'qty_invalida'; END IF;

    SELECT * INTO v_product
      FROM public.products
      WHERE id = (v_item->>'product_id')::uuid
        AND store_id = p_store_id
      FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'produto_invalido'; END IF;

    INSERT INTO public.return_items(return_id, sale_item_id, product_id, qty, restock, refund_amount)
    VALUES (
      v_return_id,
      NULLIF(v_item->>'sale_item_id','')::uuid,
      v_product.id,
      v_qty,
      v_restock,
      v_refund
    );

    IF v_restock THEN
      INSERT INTO public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by)
      VALUES (p_store_id, v_product.id, 'return_in', v_qty, v_product.cost_price, 'return', v_return_id, v_ctx.profile_id);

      UPDATE public.products
        SET on_hand = on_hand + v_qty, updated_at = now()
        WHERE id = v_product.id;
    END IF;

    v_total_refund := v_total_refund + v_refund;
  END LOOP;

  IF v_total_refund > 0 THEN
    INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
    SELECT p_store_id, l.id, 'expense', 'devolucao', v_total_refund, 'return', v_return_id, 'Reembolso de devolução', v_ctx.profile_id
    FROM public.cash_ledger l
    WHERE l.store_id = p_store_id AND l.is_default = true
    LIMIT 1;
  END IF;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'create', 'return', v_return_id, 
    jsonb_build_object('sale_id', p_sale_id, 'reason', p_reason, 'total_refund', v_total_refund));

  RETURN v_return_id;
END;
$$;
