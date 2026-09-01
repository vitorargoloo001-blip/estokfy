-- =====================================================================
-- Fix: no modo 'abatimento_total' (abater saldo total em aberto), o loop
-- de distribuição FIFO incrementava v_total_before para TODA venda que o
-- cursor buscasse, incluindo a primeira venda buscada DEPOIS que v_remaining
-- já tinha chegado a zero -- essa venda nunca recebe nenhuma alocação (o
-- EXIT acontece logo em seguida), mas seu amount_pending inteiro já tinha
-- sido somado a v_total_before antes do EXIT.
--
-- Isso não afeta nenhum valor gravado (amount_paid/amount_pending das vendas
-- reais ficam corretos -- só as que efetivamente recebem alocação são
-- atualizadas). O problema é só no campo 'balance_before' do audit_logs
-- ('abatimento_saldo_total'), que fica maior do que a soma real das vendas
-- processadas -- confirmado comparando o log com o estado real das vendas
-- em produção (a diferença bate exatamente com o amount_pending da próxima
-- venda em aberto que ficou de fora do lote).
--
-- Fix: só soma a v_total_before as vendas que o loop realmente processa.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.process_return_with_credit(
  p_store_id uuid,
  p_sale_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_refund_mode text DEFAULT 'credit',
  p_target_sale_id uuid DEFAULT NULL,
  p_surplus_mode text DEFAULT 'credit'
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
  v_debt record;
  v_offset numeric := 0;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_surplus numeric := 0;
  v_target_sale uuid;
  v_debt_before numeric;
  v_remaining numeric;
  v_alloc numeric;
  v_total_before numeric := 0;
  v_distribution jsonb := '[]'::jsonb;
  v_any_debt boolean := false;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();
  IF v_ctx.store_id <> p_store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_ctx.role NOT IN ('owner','admin','manager','sales','stock') THEN
    RAISE EXCEPTION 'sem_permissao_para_troca';
  END IF;
  IF p_refund_mode NOT IN ('credit','cash','abatimento','abatimento_total') THEN RAISE EXCEPTION 'modo_invalido'; END IF;
  IF p_surplus_mode NOT IN ('credit','cash') THEN RAISE EXCEPTION 'modo_sobra_invalido'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'sem_itens'; END IF;

  IF v_customer IS NULL AND p_sale_id IS NOT NULL THEN
    SELECT customer_id INTO v_customer FROM public.sales
      WHERE id = p_sale_id AND store_id = p_store_id;
  END IF;

  INSERT INTO public.returns(id, store_id, sale_id, status, reason, notes, created_by, refund_mode)
  VALUES (v_return_id, p_store_id, p_sale_id, 'approved', p_reason, p_notes, v_ctx.profile_id, p_refund_mode);

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

    ELSIF p_refund_mode = 'abatimento' THEN
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
      VALUES (p_store_id, v_debt.id, 'return_offset', v_offset, now(),
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

    ELSE -- p_refund_mode = 'abatimento_total'
      IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_abatimento'; END IF;

      v_remaining := v_total_refund;

      FOR v_debt IN
        SELECT * FROM public.sales
         WHERE store_id = p_store_id AND customer_id = v_customer
           AND amount_pending > 0 AND payment_status IN ('pending','partial') AND deleted_at IS NULL
         ORDER BY COALESCE(due_date, sale_date), sale_date, created_at
         FOR UPDATE
      LOOP
        v_any_debt := true;
        EXIT WHEN v_remaining <= 0;                       -- fix: checa ANTES de contar essa venda em v_total_before
        v_total_before := v_total_before + v_debt.amount_pending;

        v_alloc := least(v_remaining, v_debt.amount_pending);
        v_new_paid := v_debt.amount_paid + v_alloc;
        v_new_pending := greatest(v_debt.amount_pending - v_alloc, 0);
        v_new_status := CASE WHEN v_new_pending <= 0 THEN 'paid' ELSE 'partial' END;

        INSERT INTO public.payments(store_id, sale_id, method, amount, paid_at, note, return_id)
        VALUES (p_store_id, v_debt.id, 'return_offset', v_alloc, now(),
                left('Abatimento em saldo total por devolução' || COALESCE(' — ' || p_notes, ''), 500), v_return_id);

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
          jsonb_build_object('return_id', v_return_id, 'offset', v_alloc,
            'debt_before', v_debt.amount_pending, 'debt_after', v_new_pending,
            'payment_status', v_new_status, 'customer_id', v_customer, 'mode', 'abatimento_total'));

        v_distribution := v_distribution || jsonb_build_array(jsonb_build_object(
          'sale_id', v_debt.id, 'debt_before', v_debt.amount_pending, 'applied', v_alloc, 'debt_after', v_new_pending));

        v_offset := v_offset + v_alloc;
        v_remaining := v_remaining - v_alloc;
      END LOOP;

      IF NOT v_any_debt THEN RAISE EXCEPTION 'sem_divida_pendente'; END IF;

      v_surplus := v_remaining;

      INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
      VALUES (p_store_id, v_ctx.profile_id, 'abatimento_saldo_total', 'return', v_return_id,
        jsonb_build_object('customer_id', v_customer, 'total_refund', v_total_refund,
          'total_applied', v_offset, 'balance_before', v_total_before,
          'balance_after', v_total_before - v_offset, 'distribution', v_distribution, 'surplus', v_surplus));

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
    'abatido', v_offset, 'surplus', v_surplus,
    'balance_before', v_total_before, 'balance_after', v_total_before - v_offset, 'distribution', v_distribution
  );
END;
$$;

-- edit_return_atomic tem o mesmo loop -- mesmo fix, só no bloco 'abatimento_total'.
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
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_remaining numeric;
  v_alloc numeric;
  v_total_before numeric := 0;
  v_distribution jsonb := '[]'::jsonb;
  v_any_debt boolean := false;
BEGIN
  IF v_store IS NULL THEN RAISE EXCEPTION 'no_store'; END IF;
  IF NOT public.can_manage_sensitive_operations(v_store) THEN
    RAISE EXCEPTION 'Sem permissão para editar devoluções (somente owner/admin, ou manager se habilitado pela loja)' USING ERRCODE = '42501';
  END IF;
  IF p_edit_reason IS NULL OR length(btrim(p_edit_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da edição (mínimo 3 caracteres)';
  END IF;
  IF p_refund_mode NOT IN ('credit','cash','abatimento','abatimento_total') THEN RAISE EXCEPTION 'modo_invalido'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'sem_itens'; END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  SELECT * INTO v_return FROM public.returns WHERE id = p_return_id AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devolução não encontrada'; END IF;
  IF v_return.status = 'cancelled' THEN RAISE EXCEPTION 'Esta devolução está cancelada e não pode ser editada'; END IF;

  v_before := to_jsonb(v_return);

  v_impacts := public.revert_return_effects(p_return_id, v_store, v_profile);

  DELETE FROM public.return_items WHERE return_id = p_return_id;

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

    ELSIF p_refund_mode = 'abatimento' THEN
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
      VALUES (v_store, v_debt.id, 'return_offset', v_offset, now(),
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

    ELSE -- p_refund_mode = 'abatimento_total'
      IF v_customer IS NULL THEN RAISE EXCEPTION 'cliente_obrigatorio_para_abatimento'; END IF;

      v_remaining := v_total_refund;

      FOR v_debt IN
        SELECT * FROM public.sales
         WHERE store_id = v_store AND customer_id = v_customer
           AND amount_pending > 0 AND payment_status IN ('pending','partial') AND deleted_at IS NULL
         ORDER BY COALESCE(due_date, sale_date), sale_date, created_at
         FOR UPDATE
      LOOP
        v_any_debt := true;
        EXIT WHEN v_remaining <= 0;                       -- fix: mesmo ajuste do process_return_with_credit
        v_total_before := v_total_before + v_debt.amount_pending;

        v_alloc := least(v_remaining, v_debt.amount_pending);
        v_new_paid := v_debt.amount_paid + v_alloc;
        v_new_pending := greatest(v_debt.amount_pending - v_alloc, 0);
        v_new_status := CASE WHEN v_new_pending <= 0 THEN 'paid' ELSE 'partial' END;

        INSERT INTO public.payments(store_id, sale_id, method, amount, paid_at, note, return_id)
        VALUES (v_store, v_debt.id, 'return_offset', v_alloc, now(),
                left('Abatimento em saldo total por devolução (editado)' || COALESCE(' — ' || p_notes, ''), 500), p_return_id);

        IF v_new_pending <= 0 THEN
          DELETE FROM public.payments WHERE sale_id = v_debt.id AND method = 'pending';
        ELSE
          UPDATE public.payments SET amount = v_new_pending WHERE sale_id = v_debt.id AND method = 'pending';
        END IF;

        UPDATE public.sales
          SET amount_paid = v_new_paid, amount_pending = v_new_pending, payment_status = v_new_status
          WHERE id = v_debt.id;

        INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
        VALUES (v_store, v_profile, 'abatimento_devolucao', 'sale', v_debt.id,
          jsonb_build_object('return_id', p_return_id, 'offset', v_alloc,
            'debt_before', v_debt.amount_pending, 'debt_after', v_new_pending,
            'payment_status', v_new_status, 'customer_id', v_customer, 'mode', 'abatimento_total', 'edited', true));

        v_distribution := v_distribution || jsonb_build_array(jsonb_build_object(
          'sale_id', v_debt.id, 'debt_before', v_debt.amount_pending, 'applied', v_alloc, 'debt_after', v_new_pending));

        v_offset := v_offset + v_alloc;
        v_remaining := v_remaining - v_alloc;
      END LOOP;

      IF NOT v_any_debt THEN RAISE EXCEPTION 'sem_divida_pendente'; END IF;

      v_surplus := v_remaining;

      INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
      VALUES (v_store, v_profile, 'abatimento_saldo_total', 'return', p_return_id,
        jsonb_build_object('customer_id', v_customer, 'total_refund', v_total_refund,
          'total_applied', v_offset, 'balance_before', v_total_before,
          'balance_after', v_total_before - v_offset, 'distribution', v_distribution, 'surplus', v_surplus, 'edited', true));

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

  UPDATE public.returns SET reason = p_reason, notes = p_notes, refund_mode = p_refund_mode WHERE id = p_return_id;

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

-- =====================================================================
-- Correção retroativa de dados: 18 vendas na produção (loja DibaCell)
-- onde amount_pending já estava divergente de net_total - amount_paid
-- desde antes do guard anti-divergência existir (bug histórico documentado
-- no CLAUDE.md, "Receivable balance invariant" -- confirmado 0 ocorrências
-- novas desde 2026-08-19). Aplicada manualmente em produção via API
-- (owner da loja, sem credencial de service_role disponível) em
-- 2026-09-01 -- ver audit_logs, action='data_fix_receivable_invariant',
-- para o antes/depois completo das 18 linhas. Este bloco reaplica a mesma
-- correção de forma idempotente (WHERE já filtra por divergência real),
-- então é seguro rodar de novo aqui ou em qualquer outra loja afetada.
-- =====================================================================

UPDATE public.sales s
SET
  amount_pending = GREATEST(s.net_total - s.amount_paid, 0),
  payment_status = CASE
    WHEN s.amount_paid <= 0 THEN 'pending'
    WHEN s.amount_paid >= s.net_total THEN 'paid'
    ELSE 'partial'
  END
WHERE s.deleted_at IS NULL
  AND ABS(s.amount_pending - GREATEST(s.net_total - s.amount_paid, 0)) > 0.01;

-- Sincroniza a linha de pagamento 'pending' (placeholder de contas a
-- receber) de cada venda corrigida acima, mesma lógica usada pelas RPCs
-- de baixa (settle_sale_payment, process_return_with_credit): remove
-- quando não sobra pendência, ajusta o valor quando sobra.
DELETE FROM public.payments p
USING public.sales s
WHERE p.sale_id = s.id
  AND p.method = 'pending'
  AND s.deleted_at IS NULL
  AND s.amount_pending <= 0;

UPDATE public.payments p
SET amount = s.amount_pending
FROM public.sales s
WHERE p.sale_id = s.id
  AND p.method = 'pending'
  AND s.deleted_at IS NULL
  AND s.amount_pending > 0
  AND p.amount <> s.amount_pending;
