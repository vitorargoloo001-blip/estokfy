
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
  v_sale public.sales%ROWTYPE;
  v_items_snap jsonb;
  v_payments_snap jsonb;
  v_loyalty_result jsonb := '{}'::jsonb;
  v_impacts jsonb := '{}'::jsonb;
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
    SELECT * INTO v_sale FROM public.sales
      WHERE id = p_sale_id AND store_id = p_store_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'venda_nao_encontrada';
    END IF;
    IF v_sale.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'venda_ja_estornada';
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

  -- ============================================================
  -- NOVO: Estornar venda original quando vinculada
  -- ============================================================
  IF p_sale_id IS NOT NULL THEN
    -- Snapshot itens
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', si.id, 'product_id', si.product_id, 'qty', si.qty,
              'unit_price', si.unit_price, 'unit_cost', si.unit_cost, 'line_total', si.line_total)), '[]'::jsonb)
      INTO v_items_snap
      FROM public.sale_items si WHERE si.sale_id = p_sale_id;

    -- Snapshot pagamentos
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', p.id, 'method', p.method, 'amount', p.amount, 'paid_at', p.paid_at)), '[]'::jsonb)
      INTO v_payments_snap
      FROM public.payments p WHERE p.sale_id = p_sale_id;

    -- Reverter usos de crédito de fidelidade desta venda
    BEGIN
      v_loyalty_result := public.revert_loyalty_credit_uses_for_sale(p_sale_id);
      v_impacts := v_impacts || jsonb_build_object('loyalty', v_loyalty_result);
    EXCEPTION WHEN OTHERS THEN
      v_impacts := v_impacts || jsonb_build_object('loyalty_error', SQLERRM);
    END;

    v_impacts := v_impacts
      || jsonb_build_object(
        'refund_total', v_total_refund,
        'stock_restock_partial', true,
        'cash_reverted', v_total_refund,
        'receivable_cancelled', COALESCE(v_sale.amount_pending, 0)
      );

    -- Audit log (sale_audit_logs)
    INSERT INTO public.sale_audit_logs (
      sale_id, store_id, actor_profile_id, actor_user_id, reason, changes, before_json
    ) VALUES (
      p_sale_id, p_store_id, v_ctx.profile_id, auth.uid(),
      'Estorno por devolução/troca',
      jsonb_build_object('action','refunded_by_return','return_id', v_return_id, 'reason', p_reason),
      to_jsonb(v_sale)
    );

    -- Insert deletion log (auditoria persistente)
    INSERT INTO public.sale_deletion_logs (
      sale_id, store_id, deleted_by, deleted_by_user_id, deletion_reason,
      original_sale_data, original_items, original_payments,
      original_total, original_amount_paid, original_payment_status, original_payment_method,
      original_customer_id, impacts
    ) VALUES (
      p_sale_id, p_store_id, v_ctx.profile_id, auth.uid(),
      'Devolvida/trocada: ' || p_reason,
      to_jsonb(v_sale), v_items_snap, v_payments_snap,
      v_sale.net_total, v_sale.amount_paid, v_sale.payment_status,
      (SELECT method FROM public.payments WHERE sale_id = p_sale_id ORDER BY amount DESC LIMIT 1),
      v_sale.customer_id, v_impacts
    );

    -- Soft-cancel a venda: marca como refunded e zera pendência
    UPDATE public.sales
       SET deleted_at = now(),
           deleted_by = v_ctx.profile_id,
           deletion_reason = 'Devolvida/trocada: ' || p_reason,
           status = 'refunded',
           amount_pending = 0
     WHERE id = p_sale_id;

    -- Recalcular fidelidade do cliente
    IF v_sale.customer_id IS NOT NULL THEN
      BEGIN
        PERFORM public.recalc_loyalty_for_customer(v_sale.customer_id);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'create', 'return', v_return_id,
    jsonb_build_object('sale_id', p_sale_id, 'reason', p_reason, 'total_refund', v_total_refund, 'sale_refunded', p_sale_id IS NOT NULL));

  RETURN v_return_id;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_sales_status_active
  ON public.sales(store_id, status) WHERE deleted_at IS NULL;
