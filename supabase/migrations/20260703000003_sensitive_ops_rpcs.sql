-- =====================================================================
-- Permissões críticas — créditos, trocas e devoluções (RPCs)
--
-- Todas as RPCs abaixo exigem can_manage_sensitive_operations() e um
-- motivo com no mínimo 3 caracteres, seguindo exatamente o padrão já
-- usado por edit_sale_atomic/delete_sale_permanently. Nada é apagado
-- fisicamente — sempre status='cancelled' + autoria + motivo. Toda ação
-- é logada em audit_logs; devoluções/trocas também em
-- return_exchange_versions.
-- =====================================================================

-- 0) Pequeno ajuste em process_return_with_credit: linkar o pagamento de
--    "abatimento em dívida" de volta pro return_id, pra permitir reverter
--    isso depois sem precisar casar por texto do campo note.
CREATE OR REPLACE FUNCTION public.process_return_with_credit(
  p_store_id uuid, p_sale_id uuid, p_customer_id uuid, p_reason text, p_items jsonb,
  p_notes text DEFAULT NULL::text, p_refund_mode text DEFAULT 'credit'::text,
  p_target_sale_id uuid DEFAULT NULL::uuid, p_surplus_mode text DEFAULT 'credit'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

      INSERT INTO public.payments(store_id, sale_id, method, amount, paid_at, note, return_id)
      VALUES (p_store_id, v_debt.id, 'credit', v_offset, now(),
              left('Abatimento por devolução' || COALESCE(' — ' || p_notes, ''), 500), v_return_id);

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
    'return_id', v_return_id, 'total_refund', v_total_refund, 'refund_mode', p_refund_mode,
    'credit_id', v_credit_id, 'customer_id', v_customer, 'target_sale_id', v_target_sale,
    'abatido', v_offset, 'surplus', v_surplus
  );
END;
$function$;

-- =====================================================================
-- 1) CRÉDITOS
-- =====================================================================

CREATE OR REPLACE FUNCTION public.edit_customer_credit(
  p_credit_id uuid,
  p_new_amount_generated numeric,
  p_new_reason text,
  p_edit_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_credit public.loyalty_credits%ROWTYPE;
  v_before jsonb;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no_store'; END IF;
  IF NOT public.can_manage_sensitive_operations(v_store) THEN
    RAISE EXCEPTION 'Sem permissão para editar créditos (somente owner/admin, ou manager se habilitado pela loja)' USING ERRCODE = '42501';
  END IF;
  IF p_edit_reason IS NULL OR length(btrim(p_edit_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da edição (mínimo 3 caracteres)';
  END IF;
  IF p_new_amount_generated IS NULL OR p_new_amount_generated < 0 THEN
    RAISE EXCEPTION 'Valor inválido';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_credit FROM public.loyalty_credits WHERE id = p_credit_id AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Crédito não encontrado'; END IF;
  IF v_credit.status = 'cancelled' THEN RAISE EXCEPTION 'Este crédito já está cancelado'; END IF;
  IF p_new_amount_generated < v_credit.amount_used THEN
    RAISE EXCEPTION 'O novo valor (%) não pode ser menor que o valor já utilizado (%)', p_new_amount_generated, v_credit.amount_used;
  END IF;

  v_before := to_jsonb(v_credit);

  UPDATE public.loyalty_credits
     SET amount_generated = p_new_amount_generated,
         reason = COALESCE(NULLIF(btrim(p_new_reason), ''), reason),
         status = CASE
           WHEN (p_new_amount_generated - amount_used) <= 0 THEN 'used'
           WHEN amount_used > 0 THEN 'partially_used'
           ELSE 'available'
         END
   WHERE id = p_credit_id;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_store, v_profile, 'edit', 'customer_credit', p_credit_id, v_before,
          (SELECT to_jsonb(lc) FROM public.loyalty_credits lc WHERE lc.id = p_credit_id) || jsonb_build_object('edit_reason', p_edit_reason));

  RETURN jsonb_build_object('ok', true, 'credit_id', p_credit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_customer_credit(uuid, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_customer_credit(
  p_credit_id uuid,
  p_cancel_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_credit public.loyalty_credits%ROWTYPE;
  v_before jsonb;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no_store'; END IF;
  IF NOT public.can_manage_sensitive_operations(v_store) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar créditos (somente owner/admin, ou manager se habilitado pela loja)' USING ERRCODE = '42501';
  END IF;
  IF p_cancel_reason IS NULL OR length(btrim(p_cancel_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento (mínimo 3 caracteres)';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_credit FROM public.loyalty_credits WHERE id = p_credit_id AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Crédito não encontrado'; END IF;
  IF v_credit.status = 'cancelled' THEN RAISE EXCEPTION 'Este crédito já está cancelado'; END IF;

  v_before := to_jsonb(v_credit);

  UPDATE public.loyalty_credits
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_profile, cancel_reason = p_cancel_reason
   WHERE id = p_credit_id;

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_store, v_profile, 'cancel', 'customer_credit', p_credit_id, v_before,
          jsonb_build_object('cancel_reason', p_cancel_reason, 'cancelled_by', v_profile));

  RETURN jsonb_build_object('ok', true, 'credit_id', p_credit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_credit(uuid, text) TO authenticated;

-- =====================================================================
-- 2) DEVOLUÇÕES — helper interno de reversão (reutilizado por edit/cancel)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.revert_return_effects(
  p_return_id uuid,
  p_store uuid,
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item record;
  v_cash record;
  v_payment record;
  v_ledger uuid;
  v_debt public.sales%ROWTYPE;
  v_real_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_impacts jsonb := '{}'::jsonb;
  v_cash_total numeric := 0;
BEGIN
  -- Bloqueia se algum crédito gerado por esta devolução já foi usado
  IF EXISTS (
    SELECT 1 FROM public.loyalty_credits WHERE source_return_id = p_return_id AND amount_used > 0
  ) THEN
    RAISE EXCEPTION 'Não é possível alterar: o crédito gerado por esta devolução já foi utilizado em uma venda. Reverta essa venda primeiro.';
  END IF;

  -- 1) Reverte estoque restaurado pelos itens
  FOR v_item IN SELECT * FROM public.return_items WHERE return_id = p_return_id LOOP
    IF v_item.restock THEN
      IF (SELECT on_hand FROM public.products WHERE id = v_item.product_id) - v_item.qty < 0 THEN
        RAISE EXCEPTION 'Não é possível alterar: o produto devolvido já foi vendido novamente e o estoque ficaria negativo.';
      END IF;
      UPDATE public.products SET on_hand = on_hand - v_item.qty, updated_at = now() WHERE id = v_item.product_id;
      INSERT INTO public.stock_movements(store_id, product_id, movement_type, qty, reference_type, reference_id, reason, created_by)
      VALUES (p_store, v_item.product_id, 'sale_out', -v_item.qty, 'return_revert', p_return_id, 'Estorno por edição/cancelamento de devolução', p_profile_id);
    END IF;
  END LOOP;
  v_impacts := v_impacts || jsonb_build_object('stock_reverted', true);

  -- 2) Cancela créditos gerados por esta devolução (nunca deleta)
  UPDATE public.loyalty_credits
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_profile_id,
         cancel_reason = 'Revertido por edição/cancelamento da devolução de origem'
   WHERE source_return_id = p_return_id AND status <> 'cancelled';

  -- 3) Reverte entradas de caixa (dinheiro) geradas por esta devolução
  FOR v_cash IN SELECT * FROM public.cash_entries WHERE reference_type = 'return' AND reference_id = p_return_id LOOP
    SELECT id INTO v_ledger FROM public.cash_ledger WHERE store_id = p_store AND is_default = true LIMIT 1;
    IF v_ledger IS NULL THEN SELECT id INTO v_ledger FROM public.cash_ledger WHERE store_id = p_store LIMIT 1; END IF;
    IF v_ledger IS NOT NULL THEN
      INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
      VALUES (p_store, v_ledger,
              CASE WHEN v_cash.entry_type = 'expense' THEN 'income' ELSE 'expense' END,
              'estorno_devolucao', v_cash.amount, 'return_revert', p_return_id,
              'Estorno por edição/cancelamento de devolução #' || substr(p_return_id::text,1,8), p_profile_id);
    END IF;
    v_cash_total := v_cash_total + v_cash.amount;
  END LOOP;
  IF v_cash_total > 0 THEN v_impacts := v_impacts || jsonb_build_object('cash_reverted', v_cash_total); END IF;

  -- 4) Reverte o abatimento em dívida, recalculando a venda a partir dos pagamentos reais restantes
  FOR v_payment IN SELECT * FROM public.payments WHERE return_id = p_return_id LOOP
    SELECT * INTO v_debt FROM public.sales WHERE id = v_payment.sale_id FOR UPDATE;
    IF FOUND THEN
      DELETE FROM public.payments WHERE id = v_payment.id;

      SELECT COALESCE(SUM(amount), 0) INTO v_real_paid
        FROM public.payments WHERE sale_id = v_debt.id AND method <> 'pending';

      v_new_pending := GREATEST(v_debt.net_total - v_real_paid, 0);
      v_new_status := CASE WHEN v_real_paid >= v_debt.net_total THEN 'paid' WHEN v_real_paid > 0 THEN 'partial' ELSE 'pending' END;

      IF v_new_pending <= 0 THEN
        DELETE FROM public.payments WHERE sale_id = v_debt.id AND method = 'pending';
      ELSIF EXISTS (SELECT 1 FROM public.payments WHERE sale_id = v_debt.id AND method = 'pending') THEN
        UPDATE public.payments SET amount = v_new_pending WHERE sale_id = v_debt.id AND method = 'pending';
      ELSE
        INSERT INTO public.payments(store_id, sale_id, method, amount, paid_at, note)
        VALUES (p_store, v_debt.id, 'pending', v_new_pending, now(), 'Saldo pendente (estorno de abatimento)');
      END IF;

      UPDATE public.sales SET amount_paid = v_real_paid, amount_pending = v_new_pending, payment_status = v_new_status WHERE id = v_debt.id;

      v_impacts := v_impacts || jsonb_build_object('abatimento_revertido', v_payment.amount, 'sale_id', v_debt.id);
    END IF;
  END LOOP;

  RETURN v_impacts;
END;
$$;

-- Sem GRANT EXECUTE para authenticated: só chamada internamente por
-- cancel_return_atomic/edit_return_atomic (que já validam permissão).

CREATE OR REPLACE FUNCTION public.cancel_return_atomic(
  p_return_id uuid,
  p_cancel_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_return public.returns%ROWTYPE;
  v_before jsonb;
  v_impacts jsonb;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no_store'; END IF;
  IF NOT public.can_manage_sensitive_operations(v_store) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar devoluções (somente owner/admin, ou manager se habilitado pela loja)' USING ERRCODE = '42501';
  END IF;
  IF p_cancel_reason IS NULL OR length(btrim(p_cancel_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento (mínimo 3 caracteres)';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_return FROM public.returns WHERE id = p_return_id AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devolução não encontrada'; END IF;
  IF v_return.status = 'cancelled' THEN RAISE EXCEPTION 'Esta devolução já está cancelada'; END IF;

  v_before := to_jsonb(v_return);

  v_impacts := public.revert_return_effects(p_return_id, v_store, v_profile);

  UPDATE public.returns
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_profile, cancel_reason = p_cancel_reason
   WHERE id = p_return_id;

  INSERT INTO public.return_exchange_versions(store_id, operation_type, operation_id, action, actor_profile_id, actor_user_id, reason, old_data, new_data, impacts)
  VALUES (v_store, 'return', p_return_id, 'cancelled', v_profile, v_user, p_cancel_reason, v_before,
          (SELECT to_jsonb(r) FROM public.returns r WHERE r.id = p_return_id), v_impacts);

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_store, v_profile, 'cancel', 'return', p_return_id, v_before, jsonb_build_object('cancel_reason', p_cancel_reason, 'impacts', v_impacts));

  RETURN jsonb_build_object('ok', true, 'return_id', p_return_id, 'impacts', v_impacts);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_return_atomic(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_return_atomic(
  p_return_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_items jsonb,
  p_notes text,
  p_refund_mode text,
  p_target_sale_id uuid,
  p_surplus_mode text,
  p_edit_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_return public.returns%ROWTYPE;
  v_before jsonb;
  v_impacts jsonb;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_restock boolean;
  v_refund numeric;
  v_total_refund numeric := 0;
  v_customer uuid := p_customer_id;
  v_credit_id uuid;
  v_debt record;
  v_offset numeric := 0;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_surplus numeric := 0;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no_store'; END IF;
  IF NOT public.can_manage_sensitive_operations(v_store) THEN
    RAISE EXCEPTION 'Sem permissão para editar devoluções (somente owner/admin, ou manager se habilitado pela loja)' USING ERRCODE = '42501';
  END IF;
  IF p_edit_reason IS NULL OR length(btrim(p_edit_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da edição (mínimo 3 caracteres)';
  END IF;
  IF p_refund_mode NOT IN ('credit','cash','abatimento') THEN RAISE EXCEPTION 'modo_invalido'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'sem_itens'; END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_return FROM public.returns WHERE id = p_return_id AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devolução não encontrada'; END IF;
  IF v_return.status = 'cancelled' THEN RAISE EXCEPTION 'Esta devolução está cancelada e não pode ser editada'; END IF;

  v_before := to_jsonb(v_return);

  -- Reverte efeitos antigos (estoque, crédito, caixa, abatimento)
  v_impacts := public.revert_return_effects(p_return_id, v_store, v_profile);

  DELETE FROM public.return_items WHERE return_id = p_return_id;

  -- Reaplica com os novos parâmetros (mesma lógica de process_return_with_credit)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::int;
    v_restock := COALESCE((v_item->>'restock')::boolean, true);
    v_refund := COALESCE((v_item->>'refund_amount')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'qty_invalida'; END IF;

    SELECT * INTO v_product FROM public.products
      WHERE id = (v_item->>'product_id')::uuid AND store_id = v_store FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'produto_invalido'; END IF;

    INSERT INTO public.return_items(return_id, sale_item_id, product_id, qty, restock, refund_amount)
    VALUES (p_return_id, NULLIF(v_item->>'sale_item_id','')::uuid, v_product.id, v_qty, v_restock, v_refund);

    IF v_restock THEN
      INSERT INTO public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by)
      VALUES (v_store, v_product.id, 'return_in', v_qty, v_product.cost_price, 'return', p_return_id, v_profile);
      UPDATE public.products SET on_hand = on_hand + v_qty, updated_at = now() WHERE id = v_product.id;
    END IF;

    v_total_refund := v_total_refund + v_refund;
  END LOOP;

  IF v_total_refund > 0 THEN
    IF p_refund_mode = 'credit' THEN
      IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_credito'; END IF;
      v_credit_id := public.generate_customer_credit(
        v_store, v_customer, v_total_refund, 'devolucao', 'Crédito de devolução (editado)', v_return.sale_id, p_return_id
      );

    ELSIF p_refund_mode = 'cash' THEN
      INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
      SELECT v_store, l.id, 'expense', 'devolucao', v_total_refund, 'return', p_return_id, 'Reembolso de devolução (editado)', v_profile
      FROM public.cash_ledger l WHERE l.store_id = v_store AND l.is_default = true LIMIT 1;

    ELSE  -- abatimento
      IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_abatimento'; END IF;

      IF p_target_sale_id IS NOT NULL THEN
        SELECT * INTO v_debt FROM public.sales
          WHERE id = p_target_sale_id AND store_id = v_store AND customer_id = v_customer
            AND amount_pending > 0 AND payment_status IN ('pending','partial') AND deleted_at IS NULL
          FOR UPDATE;
      ELSE
        SELECT * INTO v_debt FROM public.sales
          WHERE store_id = v_store AND customer_id = v_customer
            AND amount_pending > 0 AND payment_status IN ('pending','partial') AND deleted_at IS NULL
          ORDER BY COALESCE(due_date, sale_date), sale_date, created_at
          LIMIT 1 FOR UPDATE;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'sem_divida_pendente'; END IF;

      v_offset := least(v_total_refund, v_debt.amount_pending);
      v_new_paid := v_debt.amount_paid + v_offset;
      v_new_pending := greatest(v_debt.amount_pending - v_offset, 0);
      v_new_status := CASE WHEN v_new_pending <= 0 THEN 'paid' ELSE 'partial' END;

      INSERT INTO public.payments(store_id, sale_id, method, amount, paid_at, note, return_id)
      VALUES (v_store, v_debt.id, 'credit', v_offset, now(),
              left('Abatimento por devolução (editado)' || COALESCE(' — ' || p_notes, ''), 500), p_return_id);

      IF v_new_pending <= 0 THEN
        DELETE FROM public.payments WHERE sale_id = v_debt.id AND method = 'pending';
      ELSE
        UPDATE public.payments SET amount = v_new_pending WHERE sale_id = v_debt.id AND method = 'pending';
      END IF;

      UPDATE public.sales SET amount_paid = v_new_paid, amount_pending = v_new_pending, payment_status = v_new_status WHERE id = v_debt.id;

      v_surplus := v_total_refund - v_offset;
      IF v_surplus > 0 THEN
        IF p_surplus_mode = 'cash' THEN
          INSERT INTO public.cash_entries(store_id, ledger_id, entry_type, category, amount, reference_type, reference_id, description, created_by)
          SELECT v_store, l.id, 'expense', 'devolucao', v_surplus, 'return', p_return_id, 'Troco de devolução (editado, após abatimento)', v_profile
          FROM public.cash_ledger l WHERE l.store_id = v_store AND l.is_default = true LIMIT 1;
        ELSE
          v_credit_id := public.generate_customer_credit(
            v_store, v_customer, v_surplus, 'devolucao', 'Crédito de devolução (editado, após abatimento)', v_return.sale_id, p_return_id);
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.returns SET reason = p_reason, notes = p_notes WHERE id = p_return_id;

  INSERT INTO public.return_exchange_versions(store_id, operation_type, operation_id, action, actor_profile_id, actor_user_id, reason, old_data, new_data, impacts)
  VALUES (v_store, 'return', p_return_id, 'edited', v_profile, v_user, p_edit_reason, v_before,
          (SELECT to_jsonb(r) FROM public.returns r WHERE r.id = p_return_id),
          v_impacts || jsonb_build_object('new_total_refund', v_total_refund, 'new_refund_mode', p_refund_mode));

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_store, v_profile, 'edit', 'return', p_return_id, v_before,
          jsonb_build_object('edit_reason', p_edit_reason, 'new_total_refund', v_total_refund, 'new_refund_mode', p_refund_mode));

  RETURN jsonb_build_object('ok', true, 'return_id', p_return_id, 'total_refund', v_total_refund, 'credit_id', v_credit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_return_atomic(uuid, uuid, text, jsonb, text, text, uuid, text, text) TO authenticated;

-- =====================================================================
-- 3) TROCAS
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cancel_exchange_atomic(
  p_exchange_id uuid,
  p_cancel_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_exchange public.exchanges%ROWTYPE;
  v_before jsonb;
  v_sale_result jsonb := '{}'::jsonb;
  v_return_result jsonb := '{}'::jsonb;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no_store'; END IF;
  IF NOT public.can_manage_sensitive_operations(v_store) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar trocas (somente owner/admin, ou manager se habilitado pela loja)' USING ERRCODE = '42501';
  END IF;
  IF p_cancel_reason IS NULL OR length(btrim(p_cancel_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento (mínimo 3 caracteres)';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_exchange FROM public.exchanges WHERE id = p_exchange_id AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Troca não encontrada'; END IF;
  IF v_exchange.status = 'cancelled' THEN RAISE EXCEPTION 'Esta troca já está cancelada'; END IF;

  v_before := to_jsonb(v_exchange);

  -- 1) Desfaz a venda nova (reverte estoque/caixa/uso do crédito) — RPC já existente e testada
  IF v_exchange.new_sale_id IS NOT NULL THEN
    v_sale_result := public.delete_sale_permanently(v_exchange.new_sale_id, 'Cancelamento de troca: ' || p_cancel_reason);
  END IF;

  -- 2) Desfaz a devolução vinculada (reverte estoque + cancela o crédito gerado,
  --    já sem uso pendente pois delete_sale_permanently reverteu o consumo acima)
  IF v_exchange.return_id IS NOT NULL THEN
    v_return_result := public.cancel_return_atomic(v_exchange.return_id, 'Cancelamento de troca: ' || p_cancel_reason);
  END IF;

  UPDATE public.exchanges
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_profile, cancel_reason = p_cancel_reason
   WHERE id = p_exchange_id;

  INSERT INTO public.return_exchange_versions(store_id, operation_type, operation_id, action, actor_profile_id, actor_user_id, reason, old_data, new_data, impacts)
  VALUES (v_store, 'exchange', p_exchange_id, 'cancelled', v_profile, v_user, p_cancel_reason, v_before,
          (SELECT to_jsonb(e) FROM public.exchanges e WHERE e.id = p_exchange_id),
          jsonb_build_object('sale_reversal', v_sale_result, 'return_reversal', v_return_result));

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_store, v_profile, 'cancel', 'exchange', p_exchange_id, v_before, jsonb_build_object('cancel_reason', p_cancel_reason));

  RETURN jsonb_build_object('ok', true, 'exchange_id', p_exchange_id, 'sale_reversal', v_sale_result, 'return_reversal', v_return_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_exchange_atomic(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_exchange_reason(
  p_exchange_id uuid,
  p_new_reason text,
  p_new_notes text,
  p_edit_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store uuid := public.get_my_store_id();
  v_user uuid := auth.uid();
  v_profile uuid;
  v_exchange public.exchanges%ROWTYPE;
  v_before jsonb;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no_store'; END IF;
  IF NOT public.can_manage_sensitive_operations(v_store) THEN
    RAISE EXCEPTION 'Sem permissão para editar trocas (somente owner/admin, ou manager se habilitado pela loja)' USING ERRCODE = '42501';
  END IF;
  IF p_edit_reason IS NULL OR length(btrim(p_edit_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da edição (mínimo 3 caracteres)';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_exchange FROM public.exchanges WHERE id = p_exchange_id AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Troca não encontrada'; END IF;
  IF v_exchange.status = 'cancelled' THEN RAISE EXCEPTION 'Esta troca está cancelada e não pode ser editada'; END IF;

  v_before := to_jsonb(v_exchange);

  UPDATE public.exchanges SET reason = p_new_reason, notes = p_new_notes WHERE id = p_exchange_id;

  INSERT INTO public.return_exchange_versions(store_id, operation_type, operation_id, action, actor_profile_id, actor_user_id, reason, old_data, new_data)
  VALUES (v_store, 'exchange', p_exchange_id, 'edited', v_profile, v_user, p_edit_reason, v_before,
          (SELECT to_jsonb(e) FROM public.exchanges e WHERE e.id = p_exchange_id));

  INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
  VALUES (v_store, v_profile, 'edit', 'exchange', p_exchange_id, v_before, jsonb_build_object('edit_reason', p_edit_reason));

  RETURN jsonb_build_object('ok', true, 'exchange_id', p_exchange_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_exchange_reason(uuid, text, text, text) TO authenticated;
