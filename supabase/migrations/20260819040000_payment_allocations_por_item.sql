-- Baixa de contas a receber por item, além da já existente baixa por valor.
--
-- payment_allocations é uma sub-tabela informativa de payments: nunca é uma
-- segunda fonte de verdade do saldo. Saldo por item é sempre DERIVADO
-- (line_total - soma das alocações daquele item), então
-- Σ saldo_item = sales.amount_pending vale por construção, sem precisar de
-- reconciliação.
--
-- payments.sale_id continua NOT NULL (um pagamento nunca cobre duas
-- vendas) -- o mesmo padrão que BatchSettlePaymentDialog.tsx já usa hoje
-- pra "por valor" multi-venda (N vendas = N linhas em payments). A baixa
-- por item cobrindo vendas diferentes do mesmo cliente também vira N
-- chamadas de RPC, uma por venda, no frontend.

CREATE TABLE public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  payment_id uuid not null references public.payments(id) on delete cascade,
  sale_id uuid not null references public.sales(id),
  sale_item_id uuid not null references public.sale_items(id) on delete cascade,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

CREATE INDEX idx_payment_allocations_sale_item ON public.payment_allocations(sale_item_id);
CREATE INDEX idx_payment_allocations_sale ON public.payment_allocations(sale_id);
CREATE INDEX idx_payment_allocations_payment ON public.payment_allocations(payment_id);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

-- Só SELECT para authenticated, igual ao padrão de sale_items -- toda
-- escrita passa por RPC SECURITY DEFINER, nunca por insert/update direto
-- do cliente.
CREATE POLICY payment_allocations_select ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT store_id FROM public.profiles WHERE auth_user_id = auth.uid()));

-- Helper interno (não é chamado pelo frontend): distribui p_amount FIFO
-- entre os itens em aberto de UMA venda. Dentro de uma venda só, todos os
-- itens nascem no mesmo instante -- não existe "mais antigo" de verdade --
-- então ORDER BY id só precisa ser determinístico, não precisa ter
-- significado. Depende do chamador já ter travado a venda (FOR UPDATE em
-- public.sales) -- sale_items não tem writer concorrente fora de RPC, então
-- a trava da venda já serializa isso.
CREATE OR REPLACE FUNCTION public._allocate_payment_fifo_within_sale(p_payment_id uuid, p_sale_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_remaining numeric := p_amount;
  v_item record;
  v_alloc numeric;
  v_store_id uuid;
begin
  if p_amount is null or p_amount <= 0 then return; end if;

  select store_id into v_store_id from public.sales where id = p_sale_id;

  for v_item in
    select si.id,
      si.line_total - coalesce((
        select sum(pa.amount) from public.payment_allocations pa where pa.sale_item_id = si.id
      ), 0) as saldo
    from public.sale_items si
    where si.sale_id = p_sale_id
    order by si.id
  loop
    exit when v_remaining <= 0;
    if v_item.saldo <= 0 then continue; end if;
    v_alloc := least(v_item.saldo, v_remaining);
    insert into public.payment_allocations(store_id, payment_id, sale_id, sale_item_id, amount)
    values (v_store_id, p_payment_id, p_sale_id, v_item.id, v_alloc);
    v_remaining := v_remaining - v_alloc;
  end loop;
end;
$function$;

-- settle_sale_payment: mesma assinatura (sem DROP, não muda parâmetro) --
-- só acrescenta a chamada ao helper depois de cada pagamento real inserido.
-- Isso faz o "por valor" (inclusive em lote, via BatchSettlePaymentDialog)
-- ganhar alocação por item sem nenhuma mudança de frontend.
CREATE OR REPLACE FUNCTION public.settle_sale_payment(p_sale_id uuid, p_payments jsonb, p_paid_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx record;
  v_sale record;
  v_pay jsonb;
  v_method text;
  v_amount numeric;
  v_added numeric := 0;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_note text;
  v_cash_desc text;
  v_payment_id uuid;
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'observacao_muito_longa';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.store_id <> v_ctx.store_id then raise exception 'store_invalida'; end if;
  if v_ctx.role not in ('owner','admin','manager','sales','finance') then
    raise exception 'sem_permissao_para_quitar';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'venda_ja_quitada';
  end if;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    v_method := (v_pay->>'method')::text;
    v_amount := (v_pay->>'amount')::numeric;
    if v_method = 'pending' then raise exception 'metodo_invalido_para_quitacao'; end if;
    if v_amount is null or v_amount <= 0 then continue; end if;

    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at, note)
    values (v_sale.store_id, v_sale.id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', p_paid_at, v_note)
    returning id into v_payment_id;

    perform public._allocate_payment_fifo_within_sale(v_payment_id, v_sale.id, v_amount);

    v_cash_desc := 'Recebimento de venda (quitação)';
    if v_note is not null then
      v_cash_desc := v_cash_desc || ' — Obs: ' || v_note;
    end if;

    insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
    select v_sale.store_id, l.id, 'income', 'venda', v_amount, v_method, 'sale', v_sale.id, v_cash_desc, v_ctx.profile_id, p_paid_at
    from public.cash_ledger l
    where l.store_id = v_sale.store_id and l.is_default = true
    limit 1;

    v_added := v_added + v_amount;
  end loop;

  if v_added <= 0 then raise exception 'pagamento_invalido'; end if;

  -- Trava: nunca aceitar mais do que a dívida real (lida sob FOR UPDATE acima).
  -- Sem isso, o excesso era absorvido em amount_paid sem erro, quebrando
  -- amount_paid + amount_pending = net_total (confirmado em 46 vendas de
  -- produção via o recebimento em lote de BatchSettlePaymentDialog.tsx).
  if v_added > v_sale.amount_pending + 0.01 then
    raise exception 'valor_maior_que_saldo_devedor';
  end if;

  v_new_paid := v_sale.amount_paid + v_added;
  v_new_pending := greatest(v_sale.amount_pending - v_added, 0);

  if v_new_pending <= 0 then
    delete from public.payments
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'paid';
  elsif v_new_paid > 0 then
    update public.payments
       set amount = v_new_pending
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'partial';
  else
    v_new_status := 'pending';
  end if;

  update public.sales
     set amount_paid = v_new_paid,
         amount_pending = v_new_pending,
         payment_status = v_new_status
   where id = v_sale.id;

  insert into public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (v_sale.store_id, v_ctx.profile_id, 'settle', 'sale', v_sale.id,
    jsonb_build_object('added',v_added,'paid',v_new_paid,'pending',v_new_pending,'payment_status',v_new_status,'note',v_note));

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status,
    'note', v_note
  );
end;
$function$;

-- create_sale_atomic: mesma assinatura -- acrescenta a chamada ao helper
-- depois de cada pagamento real (credit ou não, exceto 'pending') inserido,
-- pra uma venda já criada parcialmente paga nascer com os itens já
-- corretamente alocados.
CREATE OR REPLACE FUNCTION public.create_sale_atomic(p_store_id uuid, p_customer_id uuid, p_items jsonb, p_payments jsonb, p_delivery jsonb, p_discount numeric DEFAULT 0, p_due_date date DEFAULT NULL::date, p_sale_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx record;
  v_sale_id uuid := gen_random_uuid();
  v_gross numeric := 0; v_cost numeric := 0; v_net numeric := 0; v_profit numeric := 0;
  v_item jsonb; v_pay jsonb; v_product record; v_category_name text;
  v_qty int; v_unit_price numeric; v_line_total numeric;
  v_ship_fee numeric := coalesce((p_delivery->>'shipping_fee')::numeric,0);
  v_delivery_cost numeric := coalesce((p_delivery->>'delivery_cost')::numeric,0);
  v_paid_total numeric := 0; v_pending_total numeric := 0;
  v_method text; v_amount numeric; v_payment_status text;
  v_op_date timestamptz;
  v_sale_date date;
  v_real_now timestamptz := now();
  v_is_retroactive boolean;
  v_notes text := nullif(btrim(coalesce(p_notes,'')), '');
  v_credit_remaining numeric;
  v_credit_apply numeric;
  v_credit_row record;
  v_payment_id uuid;
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();
  if v_ctx.store_id <> p_store_id then raise exception 'store_invalida'; end if;
  if v_ctx.role not in ('owner','admin','manager','sales') then raise exception 'sem_permissao_para_vender'; end if;

  if p_customer_id is not null then
    if not exists (select 1 from public.customers where id = p_customer_id and store_id = p_store_id) then
      raise exception 'cliente_invalido';
    end if;
  end if;

  v_op_date := coalesce(p_sale_date, v_real_now);
  if v_op_date > v_real_now + interval '1 minute' then raise exception 'data_futura_invalida'; end if;
  v_sale_date := (v_op_date AT TIME ZONE 'America/Sao_Paulo')::date;
  v_is_retroactive := v_sale_date < (v_real_now AT TIME ZONE 'America/Sao_Paulo')::date;

  if v_notes is not null and length(v_notes) > 1000 then v_notes := substring(v_notes from 1 for 1000); end if;

  insert into public.sales(id, store_id, customer_id, status, discount_total, created_by, due_date, created_at, registered_at, sale_date, notes)
  values (v_sale_id, p_store_id, p_customer_id, 'paid', coalesce(p_discount,0), v_ctx.profile_id, p_due_date, v_real_now, v_real_now, v_sale_date, v_notes);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::int;
    select * into v_product from public.products
     where id = (v_item->>'product_id')::uuid and store_id = p_store_id and is_active = true
     for update;
    if not found then raise exception 'produto_invalido'; end if;
    if v_qty <= 0 then raise exception 'qty_invalida'; end if;
    if v_product.on_hand < v_qty then raise exception 'estoque_insuficiente'; end if;
    v_unit_price := coalesce(nullif(v_item->>'unit_price','')::numeric, v_product.sale_price);
    v_line_total := v_unit_price * v_qty;
    select name into v_category_name from public.categories where id = v_product.category_id;
    insert into public.sale_items(sale_id, product_id, qty, unit_price, unit_cost, line_total,
      product_name_snapshot, product_sku_snapshot, product_category_snapshot)
    values (v_sale_id, v_product.id, v_qty, v_unit_price, v_product.cost_price, v_line_total,
      v_product.name, v_product.sku, v_category_name);
    insert into public.stock_movements(store_id, product_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by, created_at, reason)
    values (p_store_id, v_product.id, 'sale_out', -v_qty, v_product.cost_price, 'sale', v_sale_id, v_ctx.profile_id, v_real_now,
            case when v_is_retroactive then 'Venda retroativa data ' || v_sale_date else null end);
    update public.products set on_hand = on_hand - v_qty, updated_at = now() where id = v_product.id;
    v_gross := v_gross + v_line_total;
    v_cost := v_cost + (v_product.cost_price * v_qty);
  end loop;

  v_net := v_gross - coalesce(p_discount,0) + v_ship_fee;
  v_profit := v_net - v_cost;

  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    v_method := (v_pay->>'method')::text;
    v_amount := (v_pay->>'amount')::numeric;
    if v_amount is null or v_amount <= 0 then continue; end if;

    if v_method = 'credit' then
      if p_customer_id is null then raise exception 'credito_sem_cliente'; end if;

      v_credit_remaining := v_amount;
      for v_credit_row in
        select * from public.loyalty_credits
         where store_id = p_store_id
           and customer_id = p_customer_id
           and status in ('available','partially_used')
           and amount_available > 0
         order by generated_at asc
         for update
      loop
        exit when v_credit_remaining <= 0;
        v_credit_apply := least(v_credit_row.amount_available, v_credit_remaining);

        update public.loyalty_credits
           set amount_used = amount_used + v_credit_apply,
               status = case
                 when (amount_generated - (amount_used + v_credit_apply)) <= 0 then 'used'
                 else 'partially_used'
               end
         where id = v_credit_row.id;

        insert into public.loyalty_credit_uses(store_id, credit_id, customer_id, sale_id, amount_applied)
        values (p_store_id, v_credit_row.id, p_customer_id, v_sale_id, v_credit_apply);

        v_credit_remaining := v_credit_remaining - v_credit_apply;
      end loop;

      if v_credit_remaining > 0 then raise exception 'credito_insuficiente'; end if;

      insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at, created_by)
      values (p_store_id, v_sale_id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', v_op_date, v_ctx.profile_id)
      returning id into v_payment_id;

      perform public._allocate_payment_fifo_within_sale(v_payment_id, v_sale_id, v_amount);

      v_paid_total := v_paid_total + v_amount;
      continue;
    end if;

    -- paid_at = v_op_date (à vista paga na data da venda — mesmo que retroativa)
    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at, created_by)
    values (p_store_id, v_sale_id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', v_op_date, v_ctx.profile_id)
    returning id into v_payment_id;
    if v_method = 'pending' then
      v_pending_total := v_pending_total + v_amount;
    else
      v_paid_total := v_paid_total + v_amount;
      perform public._allocate_payment_fifo_within_sale(v_payment_id, v_sale_id, v_amount);
      insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
      select p_store_id, l.id, 'income', 'venda', v_amount, v_method, 'sale', v_sale_id,
             case when v_is_retroactive then 'Recebimento venda retroativa ' || v_sale_date else 'Recebimento de venda' end,
             v_ctx.profile_id, v_op_date
      from public.cash_ledger l where l.store_id = p_store_id and l.is_default = true limit 1;
    end if;
  end loop;

  if v_pending_total <= 0 then v_payment_status := 'paid';
  elsif v_paid_total <= 0 then v_payment_status := 'pending';
  else v_payment_status := 'partial'; end if;

  -- Trava: nunca gravar amount_paid/amount_pending que não fechem com o
  -- net_total real (recalculado acima a partir do preço real dos produtos).
  -- Sem isso, um p_payments divergente do total dos itens era aceito sem
  -- erro (confirmado em 265 vendas de produção pagas a mais que o net_total
  -- real). ABS(...) em vez de round(...,2) <> round(...,2) evita falso
  -- positivo em divergência sub-centavo que cruza fronteira de arredondamento.
  if abs(v_paid_total + v_pending_total - v_net) > 0.01 then
    raise exception 'pagamentos_nao_batem_com_total';
  end if;

  update public.sales
    set gross_total = v_gross, shipping_fee = v_ship_fee, net_total = v_net,
        cost_total = v_cost, profit_gross = v_profit,
        amount_paid = v_paid_total, amount_pending = v_pending_total,
        payment_status = v_payment_status
    where id = v_sale_id;

  if p_delivery is not null then
    insert into public.deliveries(store_id, sale_id, method, status, tracking_code, external_delivery_id, delivery_cost, created_at)
    values (p_store_id, v_sale_id, coalesce(p_delivery->>'method','pickup'), 'pending',
            p_delivery->>'tracking_code', p_delivery->>'external_delivery_id', v_delivery_cost, v_real_now);
  end if;

  insert into public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (p_store_id, v_ctx.profile_id, 'create', 'sale', v_sale_id,
    jsonb_build_object('gross',v_gross,'net',v_net,'profit',v_profit,
      'paid',v_paid_total,'pending',v_pending_total,'payment_status',v_payment_status,
      'sale_date', v_sale_date, 'registered_at', v_real_now,
      'retroactive', v_is_retroactive, 'notes', v_notes));

  return v_sale_id;
end; $function$;

-- edit_sale_atomic: mesma assinatura -- adiciona só a reconstrução da
-- alocação por item no final, depois que sale_items já foi recriado (as
-- alocações antigas já morreram sozinhas via ON DELETE CASCADE quando os
-- sale_items antigos foram apagados no começo da função). Atribui à linha
-- de payments real mais recente. Trade-off deliberado: editar os itens de
-- uma venda paga/parcial perde o rastro de "qual pagamento original
-- financiou qual item específico" -- aceitável porque os itens antigos
-- deixam de existir como linhas distintas; o que importa
-- (Σ saldo_item = amount_pending) fica garantido depois de toda edição.
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
  -- reconstrução da alocação por item
  v_latest_payment_id uuid;
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

  -- Reconstrói a alocação por item depois que os itens foram recriados
  -- (o delete de sale_items acima já limpou as alocações antigas sozinho,
  -- via ON DELETE CASCADE em sale_item_id). Ver comentário no topo da
  -- migration sobre a perda de rastreabilidade exata nesse caso.
  IF v_new_amount_paid > 0 THEN
    SELECT id INTO v_latest_payment_id FROM public.payments
     WHERE sale_id = p_sale_id AND method <> 'pending'
     ORDER BY paid_at DESC LIMIT 1;
    IF v_latest_payment_id IS NOT NULL THEN
      PERFORM public._allocate_payment_fifo_within_sale(v_latest_payment_id, p_sale_id, v_new_amount_paid);
    END IF;
  END IF;

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

-- Nova RPC: baixa por item, dentro de uma venda só (mesmo escopo de
-- settle_sale_payment -- payments.sale_id é NOT NULL, então uma seleção de
-- itens cobrindo várias vendas do cliente vira uma chamada por venda no
-- frontend, igual ao BatchSettlePaymentDialog já faz hoje pra "por valor").
CREATE OR REPLACE FUNCTION public.settle_sale_items_payment(p_sale_id uuid, p_item_allocations jsonb, p_method text, p_paid_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx record;
  v_sale record;
  v_alloc jsonb;
  v_sale_item_id uuid;
  v_amount numeric;
  v_item_balance numeric;
  v_total numeric := 0;
  v_payment_id uuid;
  v_new_paid numeric;
  v_new_pending numeric;
  v_new_status text;
  v_note text;
  v_cash_desc text;
begin
  perform public.require_active_profile();
  select * into v_ctx from public.current_profile();

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'observacao_muito_longa';
  end if;

  if p_method is null or p_method = 'pending' then
    raise exception 'metodo_invalido_para_quitacao';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'venda_nao_encontrada'; end if;
  if v_sale.store_id <> v_ctx.store_id then raise exception 'store_invalida'; end if;
  if v_ctx.role not in ('owner','admin','manager','sales','finance') then
    raise exception 'sem_permissao_para_quitar';
  end if;
  if v_sale.payment_status = 'paid' then
    raise exception 'venda_ja_quitada';
  end if;

  if p_item_allocations is null or jsonb_array_length(p_item_allocations) = 0 then
    raise exception 'nenhum_item_selecionado';
  end if;

  -- Rejeita sale_item_id duplicado no mesmo request -- sem isso, duas
  -- entradas pro mesmo item passariam a validação individualmente (cada
  -- uma sozinha cabe no saldo) mas juntas ultrapassariam o saldo real.
  if (select count(*) from jsonb_array_elements(p_item_allocations)) <>
     (select count(distinct (elem->>'sale_item_id')) from jsonb_array_elements(p_item_allocations) elem) then
    raise exception 'item_duplicado_na_requisicao';
  end if;

  for v_alloc in select * from jsonb_array_elements(p_item_allocations)
  loop
    v_sale_item_id := (v_alloc->>'sale_item_id')::uuid;
    v_amount := (v_alloc->>'amount')::numeric;
    if v_amount is null or v_amount <= 0 then continue; end if;

    if not exists (select 1 from public.sale_items where id = v_sale_item_id and sale_id = p_sale_id) then
      raise exception 'item_nao_pertence_a_venda';
    end if;

    select li.line_total - coalesce((
      select sum(pa.amount) from public.payment_allocations pa where pa.sale_item_id = li.id
    ), 0) into v_item_balance
    from public.sale_items li
    where li.id = v_sale_item_id;

    if v_amount > coalesce(v_item_balance, 0) + 0.01 then
      raise exception 'valor_maior_que_saldo_devedor_do_item';
    end if;

    v_total := v_total + v_amount;
  end loop;

  if v_total <= 0 then raise exception 'pagamento_invalido'; end if;

  -- Defesa em profundidade: confere de novo no nível da venda (mesma trava
  -- de settle_sale_payment), mesmo que a soma dos itens já não devesse
  -- ultrapassar isso.
  if v_total > v_sale.amount_pending + 0.01 then
    raise exception 'valor_maior_que_saldo_devedor';
  end if;

  v_cash_desc := 'Recebimento de venda (baixa por item)';
  if v_note is not null then
    v_cash_desc := v_cash_desc || ' — Obs: ' || v_note;
  end if;

  insert into public.payments(store_id, sale_id, method, amount, paid_at, note, created_by)
  values (v_sale.store_id, v_sale.id, p_method, v_total, p_paid_at, v_note, v_ctx.profile_id)
  returning id into v_payment_id;

  insert into public.cash_entries(store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, description, created_by, occurred_at)
  select v_sale.store_id, l.id, 'income', 'venda', v_total, p_method, 'sale', v_sale.id, v_cash_desc, v_ctx.profile_id, p_paid_at
  from public.cash_ledger l
  where l.store_id = v_sale.store_id and l.is_default = true
  limit 1;

  for v_alloc in select * from jsonb_array_elements(p_item_allocations)
  loop
    v_sale_item_id := (v_alloc->>'sale_item_id')::uuid;
    v_amount := (v_alloc->>'amount')::numeric;
    if v_amount is null or v_amount <= 0 then continue; end if;

    insert into public.payment_allocations(store_id, payment_id, sale_id, sale_item_id, amount)
    values (v_sale.store_id, v_payment_id, p_sale_id, v_sale_item_id, v_amount);
  end loop;

  v_new_paid := v_sale.amount_paid + v_total;
  v_new_pending := greatest(v_sale.amount_pending - v_total, 0);

  if v_new_pending <= 0 then
    delete from public.payments
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'paid';
  elsif v_new_paid > 0 then
    update public.payments
       set amount = v_new_pending
     where sale_id = v_sale.id and method = 'pending';
    v_new_status := 'partial';
  else
    v_new_status := 'pending';
  end if;

  update public.sales
     set amount_paid = v_new_paid,
         amount_pending = v_new_pending,
         payment_status = v_new_status
   where id = v_sale.id;

  insert into public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, after_json)
  values (v_sale.store_id, v_ctx.profile_id, 'settle_by_item', 'sale', v_sale.id,
    jsonb_build_object('payment_id', v_payment_id, 'added', v_total, 'paid', v_new_paid,
      'pending', v_new_pending, 'payment_status', v_new_status, 'note', v_note,
      'item_allocations', p_item_allocations));

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'payment_id', v_payment_id,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status,
    'note', v_note
  );
end;
$function$;
