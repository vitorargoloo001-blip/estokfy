-- =====================================================================
-- Devolução: abater valor em dívida pendente (contas a receber)
-- Adiciona refund_mode 'abatimento' ao process_return_with_credit.
-- O valor da devolução paga (parcial ou totalmente) uma venda a prazo do
-- cliente. Não entra dinheiro no caixa (o reembolso cancela contra a dívida):
-- registra-se um pagamento method='credit' na venda alvo (sem cash_entries).
-- Sobra (devolução > dívida) vira crédito OU dinheiro, conforme p_surplus_mode.
-- =====================================================================

DROP FUNCTION IF EXISTS public.process_return_with_credit(uuid, uuid, uuid, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.process_return_with_credit(
  p_store_id uuid,
  p_sale_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_refund_mode text DEFAULT 'credit',     -- 'credit' | 'cash' | 'abatimento'
  p_target_sale_id uuid DEFAULT NULL,      -- dívida a abater (NULL = mais antiga)
  p_surplus_mode text DEFAULT 'credit'     -- sobra (devolução > dívida): 'credit' | 'cash'
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
  -- abatimento
  v_debt record;
  v_offset numeric := 0;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_surplus numeric := 0;
  v_target_sale uuid;
  v_debt_before numeric;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  IF v_ctx.store_id <> p_store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_ctx.role NOT IN ('owner','admin','manager','sales','stock') THEN
    RAISE EXCEPTION 'sem_permissao_para_troca';
  END IF;
  IF p_refund_mode NOT IN ('credit','cash','abatimento') THEN RAISE EXCEPTION 'modo_invalido'; END IF;
  IF p_surplus_mode NOT IN ('credit','cash') THEN RAISE EXCEPTION 'modo_sobra_invalido'; END IF;
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

  -- Destino do valor: crédito | dinheiro | abatimento em dívida
  IF v_total_refund > 0 THEN
    IF p_refund_mode = 'credit' THEN
      IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_credito'; END IF;
      v_credit_id := public.generate_customer_credit(
        p_store_id, v_customer, v_total_refund, 'devolucao',
        'Crédito de devolução', p_sale_id, v_return_id
      );

    ELSIF p_refund_mode = 'cash' THEN
      INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
      SELECT p_store_id, l.id, 'expense', 'devolucao', v_total_refund, 'return', v_return_id, 'Reembolso de devolução', v_ctx.profile_id
      FROM public.cash_ledger l WHERE l.store_id = p_store_id AND l.is_default = true LIMIT 1;

    ELSE  -- abatimento
      IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_abatimento'; END IF;

      IF p_target_sale_id IS NOT NULL THEN
        SELECT * INTO v_debt FROM public.sales
          WHERE id = p_target_sale_id AND store_id = p_store_id AND customer_id = v_customer
            AND amount_pending > 0 AND payment_status IN ('pending','partial') AND deleted_at IS NULL
          FOR UPDATE;
      ELSE
        SELECT * INTO v_debt FROM public.sales
          WHERE store_id = p_store_id AND customer_id = v_customer
            AND amount_pending > 0 AND payment_status IN ('pending','partial') AND deleted_at IS NULL
          ORDER BY COALESCE(due_date, sale_date), sale_date, created_at
          LIMIT 1 FOR UPDATE;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'sem_divida_pendente'; END IF;

      v_debt_before := v_debt.amount_pending;
      v_offset := least(v_total_refund, v_debt.amount_pending);
      v_new_paid := v_debt.amount_paid + v_offset;
      v_new_pending := greatest(v_debt.amount_pending - v_offset, 0);
      v_new_status := CASE WHEN v_new_pending <= 0 THEN 'paid' ELSE 'partial' END;
      v_target_sale := v_debt.id;

      -- registra o abatimento como pagamento via crédito (sem entrada de caixa)
      INSERT INTO public.payments(store_id, sale_id, method, amount, paid_at, note)
      VALUES (p_store_id, v_debt.id, 'credit', v_offset, now(),
              left('Abatimento por devolução' || COALESCE(' — ' || p_notes, ''), 500));

      -- ajusta o placeholder 'pending' da venda
      IF v_new_pending <= 0 THEN
        DELETE FROM public.payments WHERE sale_id = v_debt.id AND method = 'pending';
      ELSE
        UPDATE public.payments SET amount = v_new_pending WHERE sale_id = v_debt.id AND method = 'pending';
      END IF;

      UPDATE public.sales
        SET amount_paid = v_new_paid, amount_pending = v_new_pending, payment_status = v_new_status
        WHERE id = v_debt.id;

      INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
      VALUES (p_store_id, v_ctx.profile_id, 'abatimento_devolucao', 'sale', v_debt.id,
        jsonb_build_object('return_id', v_return_id, 'offset', v_offset,
          'debt_before', v_debt_before, 'debt_after', v_new_pending,
          'payment_status', v_new_status, 'customer_id', v_customer));

      -- sobra: devolução maior que a dívida
      v_surplus := v_total_refund - v_offset;
      IF v_surplus > 0 THEN
        IF p_surplus_mode = 'cash' THEN
          INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
          SELECT p_store_id, l.id, 'expense', 'devolucao', v_surplus, 'return', v_return_id, 'Troco de devolução (após abatimento)', v_ctx.profile_id
          FROM public.cash_ledger l WHERE l.store_id = p_store_id AND l.is_default = true LIMIT 1;
        ELSE
          v_credit_id := public.generate_customer_credit(
            p_store_id, v_customer, v_surplus, 'devolucao',
            'Crédito de devolução (após abatimento)', p_sale_id, v_return_id);
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  VALUES (p_store_id, v_ctx.profile_id, 'create', 'return', v_return_id,
    jsonb_build_object('sale_id', p_sale_id, 'reason', p_reason, 'total_refund', v_total_refund,
                       'refund_mode', p_refund_mode, 'credit_id', v_credit_id, 'customer_id', v_customer,
                       'target_sale_id', v_target_sale, 'abatido', v_offset, 'surplus', v_surplus));

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'total_refund', v_total_refund,
    'refund_mode', p_refund_mode,
    'credit_id', v_credit_id,
    'customer_id', v_customer,
    'target_sale_id', v_target_sale,
    'abatido', v_offset,
    'surplus', v_surplus
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_return_with_credit(uuid, uuid, uuid, text, jsonb, text, text, uuid, text) TO authenticated;
