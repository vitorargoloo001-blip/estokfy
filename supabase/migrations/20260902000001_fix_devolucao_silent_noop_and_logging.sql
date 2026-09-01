-- =====================================================================
-- Correção de duas falhas reais encontradas ao investigar "devolução não
-- cai no sistema" (relato de produção, loja DibaCell, clientes Sabrina/
-- Roland Garros/luquinhas tata):
--
-- 1) v_total_refund = 0 gera "sucesso" sem efeito nenhum
--    `INSERT INTO returns` e o estorno de estoque acontecem incondicional-
--    mente, ANTES de qualquer verificação de valor. Se v_total_refund
--    (soma de refund_amount * qty dos itens) ficar 0 -- campo "Valor unit."
--    deixado em branco/zerado por engano, por exemplo -- o `IF v_total_refund
--    > 0 THEN ... END IF` inteiro (crédito, dinheiro, abatimento) é pulado
--    silenciosamente. A função ainda retorna sucesso, o toast na tela diz
--    "Devolução registrada com sucesso!", o item volta pro estoque, mas
--    NADA muda na dívida do cliente -- e não sobra rastro nenhum de que
--    isso aconteceu (a devolução em si existe, com valor zero, mas nada
--    aponta o motivo na tela).
--    Auditoria em produção (132 devoluções conferidas) não achou nenhum
--    caso de v_total_refund = 0 até agora -- ou seja, não é a causa das
--    divergências já corrigidas manualmente (essas vieram de acerto fora
--    do sistema, confirmado pela própria loja). Mas é uma lacuna real que
--    pode causar exatamente esse sintoma no futuro, e falha de forma
--    silenciosa hoje -- por isso trava agora.
--    Fix: exige v_total_refund > 0 antes de criar a devolução.
--
-- 2) Tentativas de devolução que falham não deixam rastro nenhum
--    `process_return_with_credit` é chamado direto do frontend via
--    `supabase.rpc(...)`, sem edge function no meio -- diferente de
--    `create_sale_atomic`, que passa por `sales-create/index.ts` e loga em
--    `audit_logs` (action='blocked_payment_mismatch') toda tentativa
--    rejeitada pela trava de pagamento. Uma devolução que falha (ex:
--    'sem_divida_pendente' -- cliente sem conta em aberto no momento) só
--    aparece como um toast de erro na tela de quem tentou; se ninguém
--    prestar atenção no toast (ou se aconteceu antes de outra devolução já
--    ter zerado a dívida que essa tentativa esperava encontrar), não sobra
--    nenhum jeito de investigar depois o que aconteceu.
--    Fix: grava em audit_logs (action='devolucao_sem_efeito') logo antes de
--    lançar 'sem_divida_pendente', com o que foi tentado -- mesmo padrão já
--    usado por sales-create para pagamento divergente.
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
  -- validação de itens antes de qualquer INSERT (fix #1)
  v_items_total numeric := 0;
  v_item_check jsonb;
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

  -- Fix #1: calcula o total ANTES de criar qualquer coisa. Uma devolução
  -- com valor zero não deve existir -- se todos os itens vieram com
  -- refund_amount = 0, é quase certo um campo esquecido em branco, não uma
  -- devolução de brinde de verdade (brinde de verdade usa refund_mode
  -- diferente / desconto na venda, não devolução).
  FOR v_item_check IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_items_total := v_items_total + COALESCE((v_item_check->>'refund_amount')::numeric, 0);
  END LOOP;
  IF v_items_total <= 0 THEN
    RAISE EXCEPTION 'valor_devolucao_zero';
  END IF;

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
      IF NOT FOUND THEN
        -- Fix #2: grava a tentativa antes de abortar -- sem isso, "cliente
        -- sem dívida no momento" desaparece sem deixar rastro nenhum.
        INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
        VALUES (p_store_id, v_ctx.profile_id, 'devolucao_sem_efeito', 'customer', v_customer,
          jsonb_build_object('reason', 'sem_divida_pendente', 'refund_mode', p_refund_mode,
            'total_refund_tentado', v_total_refund, 'target_sale_id', p_target_sale_id));
        RAISE EXCEPTION 'sem_divida_pendente';
      END IF;

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
        EXIT WHEN v_remaining <= 0;
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

      IF NOT v_any_debt THEN
        -- Fix #2 (mesmo caso, modo abatimento_total)
        INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
        VALUES (p_store_id, v_ctx.profile_id, 'devolucao_sem_efeito', 'customer', v_customer,
          jsonb_build_object('reason', 'sem_divida_pendente', 'refund_mode', p_refund_mode,
            'total_refund_tentado', v_total_refund));
        RAISE EXCEPTION 'sem_divida_pendente';
      END IF;

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
