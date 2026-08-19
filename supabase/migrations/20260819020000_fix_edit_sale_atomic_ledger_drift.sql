-- edit_sale_atomic: fecha dois mecanismos reais encontrados em produção (4
-- vendas) onde sales.amount_paid/pending ficava correto mas o livro-razão
-- de payments ficava desatualizado:
--
-- 1) Editar uma venda "pendente" para "paga" sem trocar a forma de
--    pagamento no formulário insere um payments.method='pending' pra uma
--    venda com payment_status='paid' (o dropdown "Forma" no
--    EditSaleDialog carregava o método do último payment, que numa venda
--    pendente é sempre a própria linha placeholder 'pending' — corrigido
--    também no frontend). Trava nova: rejeita p_payment_method='pending'
--    quando p_payment_status='paid'.
--
-- 2) Reduzir o total da venda (itens virando brinde/desconto) abaixo do
--    que já tinha sido pago de verdade (crédito/pix) deixava
--    sales.amount_paid corretamente limitado ao novo net_total, mas a
--    linha de payments antiga continuava com o valor maior original —
--    igual ao Case 5 (paid→paid) desta mesma função, que já ajusta o
--    payment mais recente pro novo total, aqui generalizado pra reduzir
--    (ou remover) as linhas reais mais recentes até o ledger bater com o
--    novo total, em vez de deixar sobra sem destino.

CREATE OR REPLACE FUNCTION public.edit_sale_atomic(p_sale_id uuid, p_reason text, p_customer_id uuid, p_created_at timestamp with time zone, p_discount_total numeric, p_shipping_fee numeric, p_notes text, p_payment_method text, p_payment_status text, p_items jsonb, p_allow_negative_stock boolean DEFAULT false, p_confirm_revert_payment boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store uuid := get_my_store_id();
  v_role text := get_my_role();
  v_profile uuid;
  v_user uuid := auth.uid();
  v_sale public.sales%ROWTYPE;
  v_before jsonb;
  v_old_items jsonb;
  v_new_items jsonb := COALESCE(p_items, '[]'::jsonb);
  v_item jsonb;
  v_product_id uuid;
  v_qty int;
  v_unit_price numeric;
  v_unit_cost numeric;
  v_gross numeric := 0;
  v_cost numeric := 0;
  v_net numeric;
  v_on_hand int;
  v_old_qty int;
  v_changes jsonb := '{}'::jsonb;
  v_loyalty_used numeric := 0;
  v_loyalty_total numeric := 0;
  v_default_ledger uuid;
  v_old_pm text;
  -- used for partial-payment handling
  v_preserved_paid numeric;
  v_remaining numeric;
  -- ledger reconciliation (fecha o total abaixo do já pago de verdade)
  v_real_ledger_sum numeric;
  v_excess numeric;
  v_pay_row record;
  v_reduce numeric;
  v_cash_row record;
  -- derived payment fields for the final UPDATE
  v_new_amount_paid numeric;
  v_new_amount_pending numeric;
  v_new_payment_status text;
BEGIN
  IF v_role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'Sem permissão para editar vendas (somente owner/admin/manager)' USING ERRCODE='42501';
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = v_user AND store_id = v_store LIMIT 1;

  IF v_profile IS NULL THEN
    SELECT id INTO v_profile FROM public.profiles
     WHERE store_id = v_store AND role = 'owner' AND is_active = true
     ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_profile IS NULL THEN
    SELECT id INTO v_profile FROM public.profiles
     WHERE store_id = v_store AND is_active = true
     ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Erro ao registrar movimentação: usuário inválido.' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id AND store_id = v_store FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada'; END IF;
  IF v_sale.status = 'cancelled' THEN RAISE EXCEPTION 'Venda cancelada não pode ser editada'; END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da edição (mínimo 3 caracteres)';
  END IF;
  IF jsonb_array_length(v_new_items) = 0 THEN
    RAISE EXCEPTION 'A venda precisa ter ao menos um item';
  END IF;
  IF p_payment_status NOT IN ('paid','pending','partial') THEN
    RAISE EXCEPTION 'Status de pagamento inválido';
  END IF;
  IF p_payment_status = 'paid' AND p_payment_method = 'pending' THEN
    RAISE EXCEPTION 'metodo_pagamento_invalido_para_quitacao';
  END IF;

  v_before := to_jsonb(v_sale);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', si.product_id, 'qty', si.qty,
    'unit_price', si.unit_price, 'unit_cost', si.unit_cost
  )), '[]'::jsonb) INTO v_old_items
  FROM public.sale_items si WHERE si.sale_id = p_sale_id;

  SELECT COALESCE(SUM(amount_used),0), COALESCE(SUM(amount_generated),0)
    INTO v_loyalty_used, v_loyalty_total
    FROM public.loyalty_credits WHERE source_sale_id = p_sale_id;

  -- Revert old stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_old_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_old_qty := (v_item->>'qty')::int;
    UPDATE public.products SET on_hand = on_hand + v_old_qty WHERE id = v_product_id AND store_id = v_store;
  END LOOP;

  DELETE FROM public.stock_movements
   WHERE store_id = v_store AND reference_type = 'sale' AND reference_id = p_sale_id;
  DELETE FROM public.sale_items WHERE sale_id = p_sale_id;

  -- Apply new stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_new_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::int;
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantidade inválida em um item'; END IF;
    IF v_unit_price < 0 THEN RAISE EXCEPTION 'Preço unitário negativo não permitido'; END IF;

    SELECT on_hand, cost_price INTO v_on_hand, v_unit_cost
      FROM public.products WHERE id = v_product_id AND store_id = v_store FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto inexistente nesta loja'; END IF;

    IF v_on_hand - v_qty < 0 THEN
      IF NOT p_allow_negative_stock OR v_role NOT IN ('owner','admin') THEN
        RAISE EXCEPTION 'Estoque insuficiente para o produto (saldo %, necessário %). Apenas owner/admin podem confirmar estoque negativo.', v_on_hand, v_qty;
      END IF;
    END IF;

    UPDATE public.products SET on_hand = on_hand - v_qty WHERE id = v_product_id;

    INSERT INTO public.sale_items (sale_id, product_id, qty, unit_price, unit_cost, line_total)
    VALUES (p_sale_id, v_product_id, v_qty, v_unit_price, v_unit_cost, v_unit_price * v_qty);

    INSERT INTO public.stock_movements (store_id, product_id, movement_type, qty, unit_cost, reason, reference_type, reference_id, created_by)
    VALUES (v_store, v_product_id, 'sale_out', -v_qty, v_unit_cost, 'Edição de venda', 'sale', p_sale_id, v_profile);

    v_gross := v_gross + (v_unit_price * v_qty);
    v_cost := v_cost + (v_unit_cost * v_qty);
  END LOOP;

  v_net := v_gross - COALESCE(p_discount_total,0) + COALESCE(p_shipping_fee,0);
  IF v_net < 0 THEN RAISE EXCEPTION 'Total da venda não pode ser negativo'; END IF;

  v_old_pm := NULL;
  SELECT method INTO v_old_pm FROM public.payments WHERE sale_id = p_sale_id ORDER BY paid_at DESC LIMIT 1;

  SELECT id INTO v_default_ledger FROM public.cash_ledger WHERE store_id = v_store AND is_default = true LIMIT 1;
  IF v_default_ledger IS NULL THEN
    SELECT id INTO v_default_ledger FROM public.cash_ledger WHERE store_id = v_store LIMIT 1;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- PAYMENT HANDLING
  -- Compute what the preserved amount_paid is for partial sales.
  -- For partial: keep existing cash payments, only adjust the 'pending' placeholder.
  -- ──────────────────────────────────────────────────────────────────────────

  -- Amount already received in real cash (excludes 'pending' placeholder row)
  v_preserved_paid := COALESCE(v_sale.amount_paid, 0);

  -- Case 1: paid → non-paid (explicit revert with confirmation)
  IF v_sale.payment_status = 'paid' AND p_payment_status <> 'paid' THEN
    IF NOT p_confirm_revert_payment THEN
      RAISE EXCEPTION 'CONFIRM_REVERT_PAYMENT_REQUIRED: a venda já estava paga; confirme para estornar a entrada de caixa';
    END IF;

    IF v_default_ledger IS NOT NULL THEN
      INSERT INTO public.cash_entries (store_id, ledger_id, entry_type, category, amount, payment_method, description, reference_type, reference_id, created_by)
      VALUES (v_store, v_default_ledger, 'expense', 'venda', COALESCE(v_sale.amount_paid, v_sale.net_total),
              v_old_pm, 'Estorno por edição de venda — Motivo: '||p_reason, 'sale', p_sale_id, v_profile);
    END IF;

    DELETE FROM public.payments WHERE sale_id = p_sale_id;
    v_preserved_paid := 0;
  END IF;

  -- Case 2: pending (no prior cash) → paid
  IF v_sale.payment_status = 'pending' AND p_payment_status = 'paid' THEN
    DELETE FROM public.payments WHERE sale_id = p_sale_id;
    INSERT INTO public.payments (store_id, sale_id, method, amount, paid_at)
    VALUES (v_store, p_sale_id, COALESCE(p_payment_method,'cash'), v_net, now());

    IF v_default_ledger IS NOT NULL THEN
      INSERT INTO public.cash_entries (store_id, ledger_id, entry_type, category, amount, payment_method, description, reference_type, reference_id, created_by)
      VALUES (v_store, v_default_ledger, 'income', 'venda', v_net, COALESCE(p_payment_method,'cash'),
              'Recebimento por edição de venda — Motivo: '||p_reason, 'sale', p_sale_id, v_profile);
    END IF;

    v_preserved_paid := v_net;
  END IF;

  -- Case 3: partial → paid
  -- Keep existing real payments; only delete the 'pending' placeholder and add
  -- a cash entry for the remaining balance (avoids double-counting).
  IF v_sale.payment_status = 'partial' AND p_payment_status = 'paid' THEN
    DELETE FROM public.payments WHERE sale_id = p_sale_id AND method = 'pending';

    v_remaining := GREATEST(v_net - v_preserved_paid, 0);
    IF v_remaining > 0 THEN
      INSERT INTO public.payments (store_id, sale_id, method, amount, paid_at)
      VALUES (v_store, p_sale_id, COALESCE(p_payment_method,'cash'), v_remaining, now());

      IF v_default_ledger IS NOT NULL THEN
        INSERT INTO public.cash_entries (store_id, ledger_id, entry_type, category, amount, payment_method, description, reference_type, reference_id, created_by)
        VALUES (v_store, v_default_ledger, 'income', 'venda', v_remaining, COALESCE(p_payment_method,'cash'),
                'Recebimento por edição de venda (saldo restante) — Motivo: '||p_reason, 'sale', p_sale_id, v_profile);
      END IF;
    END IF;

    v_preserved_paid := v_net;
  END IF;

  -- Case 4: partial → still partial/pending (not marking as paid)
  -- Fix: update the 'pending' placeholder row to reflect the new remaining balance.
  -- Do NOT reset amount_paid — real payments already made must be preserved.
  IF v_sale.payment_status = 'partial' AND p_payment_status <> 'paid' THEN
    v_remaining := GREATEST(v_net - v_preserved_paid, 0);
    IF v_remaining <= 0 THEN
      -- Existing payments already cover the (now smaller) total → remove placeholder
      DELETE FROM public.payments WHERE sale_id = p_sale_id AND method = 'pending';
    ELSE
      UPDATE public.payments SET amount = v_remaining
       WHERE sale_id = p_sale_id AND method = 'pending';
    END IF;
    -- v_preserved_paid stays as-is (real payments are unchanged)
  END IF;

  -- Case 5: paid → paid (update payment amount and cash entry)
  IF v_sale.payment_status = 'paid' AND p_payment_status = 'paid' THEN
    UPDATE public.payments SET method = COALESCE(p_payment_method, method), amount = v_net
     WHERE id = (SELECT id FROM public.payments WHERE sale_id = p_sale_id ORDER BY paid_at DESC LIMIT 1);

    UPDATE public.cash_entries
       SET amount = v_net,
           payment_method = COALESCE(p_payment_method, payment_method),
           description = COALESCE(description,'') || ' [editado: '||p_reason||']'
     WHERE id = (
       SELECT id FROM public.cash_entries
        WHERE reference_type='sale' AND reference_id=p_sale_id AND entry_type='income'
        ORDER BY occurred_at DESC LIMIT 1
     );

    v_preserved_paid := v_net;
  END IF;

  -- Reconcilia o ledger real de pagamentos quando a edição reduziu o total
  -- abaixo do que já tinha sido pago de verdade (ex.: itens virando brinde
  -- depois de já ter recebido via crédito/pix). Sem isso, sales.amount_paid
  -- ficava corretamente limitado ao novo net_total mas os payments reais
  -- continuavam com o valor antigo maior — confirmado em 2 vendas de
  -- produção. Reduz (ou remove) as linhas reais mais recentes até bater.
  -- Checa a soma real da tabela payments (não v_preserved_paid, que os
  -- Cases 2/3/5 acima já forçam para v_net antes de chegar aqui).
  SELECT COALESCE(SUM(amount), 0) INTO v_real_ledger_sum
    FROM public.payments WHERE sale_id = p_sale_id AND method <> 'pending';

  IF v_real_ledger_sum > v_net THEN
    v_excess := v_real_ledger_sum - v_net;

    INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
    VALUES (v_store, v_profile, 'payment_reduced_by_edit', 'sale', p_sale_id,
      jsonb_build_object('ledger_real_antes', v_real_ledger_sum, 'novo_total', v_net,
        'excedente_ajustado', v_excess, 'motivo_edicao', p_reason));

    FOR v_pay_row IN
      SELECT * FROM public.payments
       WHERE sale_id = p_sale_id AND method <> 'pending'
       ORDER BY paid_at DESC
       FOR UPDATE
    LOOP
      EXIT WHEN v_excess <= 0;
      v_reduce := LEAST(v_pay_row.amount, v_excess);
      IF v_reduce >= v_pay_row.amount THEN
        DELETE FROM public.payments WHERE id = v_pay_row.id;
      ELSE
        UPDATE public.payments SET amount = amount - v_reduce WHERE id = v_pay_row.id;
      END IF;

      -- Espelha a mesma redução no cash_entries correspondente — método
      -- 'credit' nunca gera cash_entries (nada a fazer nesse caso).
      IF v_pay_row.method <> 'credit' THEN
        SELECT * INTO v_cash_row FROM public.cash_entries
         WHERE reference_type = 'sale' AND reference_id = p_sale_id
           AND entry_type = 'income' AND payment_method = v_pay_row.method
         ORDER BY occurred_at DESC LIMIT 1 FOR UPDATE;
        IF FOUND THEN
          IF v_reduce >= v_cash_row.amount THEN
            DELETE FROM public.cash_entries WHERE id = v_cash_row.id;
          ELSE
            UPDATE public.cash_entries SET amount = amount - v_reduce WHERE id = v_cash_row.id;
          END IF;
        END IF;
      END IF;

      v_excess := v_excess - v_reduce;
    END LOOP;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- Derive final payment fields for the UPDATE
  -- ──────────────────────────────────────────────────────────────────────────

  -- Cap preserved_paid at new v_net (edge: total decreased below what was paid)
  v_preserved_paid := LEAST(v_preserved_paid, v_net);

  IF p_payment_status = 'paid' OR v_preserved_paid >= v_net THEN
    v_new_payment_status := 'paid';
    v_new_amount_paid    := v_net;
    v_new_amount_pending := 0;
  ELSIF v_preserved_paid > 0 THEN
    v_new_payment_status := 'partial';
    v_new_amount_paid    := v_preserved_paid;
    v_new_amount_pending := v_net - v_preserved_paid;
  ELSE
    v_new_payment_status := p_payment_status;  -- 'pending' for brand-new unpaid sales
    v_new_amount_paid    := 0;
    v_new_amount_pending := v_net;
  END IF;

  UPDATE public.sales SET
    customer_id    = p_customer_id,
    created_at     = COALESCE(p_created_at, created_at),
    discount_total = COALESCE(p_discount_total, 0),
    shipping_fee   = COALESCE(p_shipping_fee, 0),
    notes          = p_notes,
    gross_total    = v_gross,
    cost_total     = v_cost,
    net_total      = v_net,
    profit_gross   = v_net - v_cost,
    payment_status = v_new_payment_status,
    amount_paid    = v_new_amount_paid,
    amount_pending = v_new_amount_pending,
    status         = CASE WHEN v_new_payment_status = 'paid' THEN 'paid' ELSE COALESCE(status,'paid') END
  WHERE id = p_sale_id;

  IF v_loyalty_used = 0 AND p_customer_id IS NOT NULL THEN
    BEGIN
      PERFORM public.recalc_loyalty_for_customer(p_customer_id);
    EXCEPTION WHEN undefined_function THEN NULL;
    END;
  END IF;

  v_changes := jsonb_build_object(
    'gross_total',    jsonb_build_object('old', v_sale.gross_total,    'new', v_gross),
    'net_total',      jsonb_build_object('old', v_sale.net_total,      'new', v_net),
    'discount_total', jsonb_build_object('old', v_sale.discount_total, 'new', p_discount_total),
    'shipping_fee',   jsonb_build_object('old', v_sale.shipping_fee,   'new', p_shipping_fee),
    'payment_status', jsonb_build_object('old', v_sale.payment_status, 'new', v_new_payment_status),
    'amount_paid',    jsonb_build_object('old', v_sale.amount_paid,    'new', v_new_amount_paid),
    'amount_pending', jsonb_build_object('old', v_sale.amount_pending, 'new', v_new_amount_pending),
    'customer_id',    jsonb_build_object('old', v_sale.customer_id,    'new', p_customer_id),
    'items_old',      v_old_items,
    'items_new',      v_new_items,
    'loyalty_recalculated', (v_loyalty_used = 0 AND p_customer_id IS NOT NULL),
    'loyalty_used_blocked_recalc', (v_loyalty_used > 0)
  );

  INSERT INTO public.sale_audit_logs (store_id, sale_id, actor_profile_id, actor_user_id, reason, changes, before_json, after_json)
  VALUES (v_store, p_sale_id, v_profile, v_user, p_reason, v_changes,
          v_before, (SELECT to_jsonb(s) FROM public.sales s WHERE s.id = p_sale_id));

  RETURN jsonb_build_object(
    'ok', true,
    'sale_id', p_sale_id,
    'net_total', v_net,
    'payment_status', v_new_payment_status,
    'amount_paid', v_new_amount_paid,
    'amount_pending', v_new_amount_pending,
    'loyalty_recalculated', (v_loyalty_used = 0 AND p_customer_id IS NOT NULL),
    'loyalty_blocked', (v_loyalty_used > 0)
  );
END;
$function$;
