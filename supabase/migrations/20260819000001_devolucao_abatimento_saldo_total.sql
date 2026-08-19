-- =====================================================================
-- Devolução: "Abater do saldo total em aberto"
--
-- Hoje 'abatimento' só quita UMA venda (escolhida ou a mais antiga). Este
-- modo novo ('abatimento_total') distribui o valor da devolução em FIFO
-- por vencimento entre TODAS as vendas em aberto do cliente, sem o operador
-- escolher conta nenhuma. Reaproveita a mesma tabela `payments` já usada
-- pelo abatimento de conta única como fonte de verdade (nenhuma tabela nova
-- de "saldo do cliente") — só passa a rodar em loop e gravar `return_id` em
-- cada linha afetada, o que já é suficiente pra `revert_return_effects`
-- (função existente, não precisa de lógica nova) desfazer corretamente
-- devoluções que tocaram múltiplas vendas.
--
-- Também corrige 3 problemas reais encontrados na auditoria:
-- 1) 'abatimento' grava method='credit' no pagamento — mesmo valor usado
--    quando o cliente paga com crédito de fidelidade, conflitando com o
--    pedido explícito de ter uma classificação própria que nunca pareça
--    dinheiro recebido. Migra para method='return_offset' (só daqui pra
--    frente — linhas históricas não são tocadas).
-- 2) revert_return_effects monta o JSON de impacto dentro do loop com
--    `jsonb_build_object` simples, que SOBRESCREVE a cada volta — numa
--    devolução que afete 2+ vendas, só a última sobrevive no relatório de
--    reversão. Vira array.
-- 3) revert_sale_payment (botão "Estornar" avulso na tela da venda) deixa
--    reverter um pagamento de abatimento sem tocar em `returns`/auditoria,
--    dessincronizando tudo. Bloqueado com uma guarda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------

-- Discriminador direto do modo usado, pra edição não precisar mais inferir
-- por efeito colateral (o probe antigo usava .maybeSingle() em payments,
-- que quebra em runtime quando a devolução afeta mais de uma venda).
-- NULL = devoluções anteriores a esta migration; o frontend mantém o
-- fallback de inferência só pra essas.
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS refund_mode text;
ALTER TABLE public.returns DROP CONSTRAINT IF EXISTS returns_refund_mode_check;
ALTER TABLE public.returns ADD CONSTRAINT returns_refund_mode_check
  CHECK (refund_mode IS NULL OR refund_mode IN ('credit','cash','abatimento','abatimento_total'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check
  CHECK (method = ANY (ARRAY['pix','cash','card','credit_card','debit_card','transfer','pending','credit','return_offset']::text[]));

-- ---------------------------------------------------------------------
-- process_return_with_credit — mesma assinatura de hoje, CREATE OR REPLACE
-- substitui em produção sem criar overload novo (parâmetros idênticos).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_return_with_credit(
  p_store_id uuid,
  p_sale_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_refund_mode text DEFAULT 'credit',     -- 'credit' | 'cash' | 'abatimento' | 'abatimento_total'
  p_target_sale_id uuid DEFAULT NULL,      -- dívida a abater no modo 'abatimento' (NULL = mais antiga)
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
  -- abatimento (conta única)
  v_debt record;
  v_offset numeric := 0;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_surplus numeric := 0;
  v_target_sale uuid;
  v_debt_before numeric;
  -- abatimento_total (FIFO em múltiplas contas)
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

    ELSE -- p_refund_mode = 'abatimento_total': distribui em FIFO por vencimento
         -- entre TODAS as vendas em aberto do cliente, sem escolha manual.
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
        v_total_before := v_total_before + v_debt.amount_pending;
        EXIT WHEN v_remaining <= 0;

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

GRANT EXECUTE ON FUNCTION public.process_return_with_credit(uuid, uuid, uuid, text, jsonb, text, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- edit_return_atomic — mesma assinatura de hoje, mesmo tratamento.
-- revert_return_effects (chamada logo no início) já desfaz corretamente
-- uma distribuição em múltiplas vendas graças ao fix aplicado abaixo.
-- ---------------------------------------------------------------------
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
  -- abatimento_total
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

  -- Reverte efeitos antigos (estoque, crédito, caixa, abatimento — inclusive
  -- distribuição em múltiplas vendas, já generalizado nesta função).
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
        v_total_before := v_total_before + v_debt.amount_pending;
        EXIT WHEN v_remaining <= 0;

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

GRANT EXECUTE ON FUNCTION public.edit_return_atomic(uuid, uuid, text, jsonb, text, text, uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- revert_return_effects — fix: o JSON de impacto do abatimento estava
-- dentro do loop usando `||` sobre chaves fixas, o que SOBRESCREVE a cada
-- volta. Vira array, sem mudar a lógica de reversão em si (que já
-- recalcula cada venda a partir da soma real dos pagamentos restantes —
-- é essa parte que garante a reversão exata, e já funciona pra N vendas).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_return_effects(p_return_id uuid, p_store uuid, p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_abatimento_list jsonb := '[]'::jsonb;
  v_abatimento_total numeric := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.loyalty_credits WHERE source_return_id = p_return_id AND amount_used > 0
  ) THEN
    RAISE EXCEPTION 'Não é possível alterar: o crédito gerado por esta devolução já foi utilizado em uma venda. Reverta essa venda primeiro.';
  END IF;

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

  UPDATE public.loyalty_credits
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_profile_id,
         cancel_reason = 'Revertido por edição/cancelamento da devolução de origem'
   WHERE source_return_id = p_return_id AND status <> 'cancelled';

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

  -- Reverte o(s) abatimento(s) em dívida, recalculando cada venda a partir
  -- dos pagamentos reais restantes (não da dívida atual) — funciona igual
  -- pra 1 venda (modo antigo) ou N vendas (FIFO em saldo total).
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

      v_abatimento_list := v_abatimento_list || jsonb_build_array(jsonb_build_object('sale_id', v_debt.id, 'amount', v_payment.amount));
      v_abatimento_total := v_abatimento_total + v_payment.amount;
    END IF;
  END LOOP;
  IF v_abatimento_total > 0 THEN
    v_impacts := v_impacts || jsonb_build_object('abatimento_revertido_total', v_abatimento_total, 'abatimentos', v_abatimento_list);
  END IF;

  RETURN v_impacts;
END;
$$;

-- ---------------------------------------------------------------------
-- revert_sale_payment — guarda contra estornar avulsamente (na tela da
-- venda) um pagamento que pertence a uma devolução. Sem isso dá pra
-- dessincronizar `returns`/auditoria sem passar por editar/cancelar a
-- devolução. Puramente aditivo, não toca em pagamento histórico existente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_sale_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ctx RECORD;
  v_pmt RECORD;
  v_sale RECORD;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();

  IF v_ctx.role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'sem_permissao_para_estornar';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'motivo_obrigatorio';
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pagamento_nao_encontrado'; END IF;
  IF v_pmt.store_id <> v_ctx.store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_pmt.method = 'pending' THEN RAISE EXCEPTION 'nao_e_um_pagamento_real'; END IF;
  IF v_pmt.return_id IS NOT NULL THEN
    RAISE EXCEPTION 'pagamento_vinculado_a_devolucao_use_editar_ou_cancelar_a_devolucao';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = v_pmt.sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'venda_nao_encontrada'; END IF;

  DELETE FROM public.payments WHERE id = p_payment_id;

  DELETE FROM public.cash_entries
   WHERE id = (
     SELECT id FROM public.cash_entries
      WHERE store_id = v_sale.store_id
        AND reference_type = 'sale' AND reference_id = v_sale.id
        AND entry_type = 'income'
        AND payment_method = v_pmt.method
        AND amount = v_pmt.amount
        AND occurred_at = v_pmt.paid_at
      LIMIT 1
   );

  v_new_paid := GREATEST(v_sale.amount_paid - v_pmt.amount, 0);
  v_new_pending := GREATEST(v_sale.net_total - v_new_paid, 0);

  IF v_new_pending <= 0 THEN
    v_new_status := 'paid';
    DELETE FROM public.payments WHERE sale_id = v_sale.id AND method = 'pending';
  ELSE
    v_new_status := CASE WHEN v_new_paid > 0 THEN 'partial' ELSE 'pending' END;
    IF EXISTS (SELECT 1 FROM public.payments WHERE sale_id = v_sale.id AND method = 'pending') THEN
      UPDATE public.payments SET amount = v_new_pending WHERE sale_id = v_sale.id AND method = 'pending';
    ELSE
      INSERT INTO public.payments (store_id, sale_id, method, amount, paid_at)
      VALUES (v_sale.store_id, v_sale.id, 'pending', v_new_pending, v_sale.created_at);
    END IF;
  END IF;

  UPDATE public.sales
     SET amount_paid = v_new_paid, amount_pending = v_new_pending, payment_status = v_new_status
   WHERE id = v_sale.id;

  INSERT INTO public.sale_audit_logs (store_id, sale_id, actor_profile_id, actor_user_id, reason, changes, before_json, after_json)
  VALUES (
    v_sale.store_id, v_sale.id, v_ctx.profile_id, auth.uid(),
    p_reason,
    jsonb_build_object('reverted_payment_id', p_payment_id, 'reverted_amount', v_pmt.amount, 'reverted_method', v_pmt.method),
    jsonb_build_object('amount_paid', v_sale.amount_paid, 'amount_pending', v_sale.amount_pending, 'payment_status', v_sale.payment_status),
    jsonb_build_object('amount_paid', v_new_paid, 'amount_pending', v_new_pending, 'payment_status', v_new_status)
  );

  RETURN jsonb_build_object(
    'sale_id', v_sale.id,
    'reverted_amount', v_pmt.amount,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status
  );
END;
$$;
