-- =====================================================================
-- Bug real confirmado (via transação com ROLLBACK, nada foi alterado em
-- produção durante o diagnóstico): registrar uma venda com um customer_id
-- que não existe mais (ex: cliente excluído por outra aba/pessoa enquanto
-- a tela de Nova Venda já estava aberta com o cliente selecionado) faz
-- create_sale_atomic estourar a constraint de FK "sales_customer_id_fkey"
-- crua do Postgres. Esse erro não bate com nenhum dos códigos conhecidos
-- em sales-create/index.ts, então cai no fallback genérico "internal_error"
-- → "Não foi possível concluir a operação. Tente novamente em instantes."
-- na tela — exatamente o sintoma relatado.
--
-- Fix: valida o cliente explicitamente (mesmo padrão já usado pra produto)
-- e retorna 'cliente_invalido', com mensagem amigável tratada no
-- Edge Function e no mapa de erros do frontend.
--
-- Limpeza adicional: existiam 3 overloads de create_sale_atomic (6, 7 e 9
-- parâmetros) porque migrations antigas usaram CREATE OR REPLACE com uma
-- assinatura diferente (parâmetro novo) — no Postgres isso cria uma função
-- NOVA em vez de substituir a antiga. Confirmado que isso já causa erro de
-- "função ambígua" quando chamada por notação posicional (não é o caso do
-- Edge Function atual, que usa notação nomeada com os 9 parâmetros — mas é
-- uma bomba-relógio real caso algo mude). Só a versão de 9 parâmetros é
-- usada em todo o código (confirmado); as outras duas são removidas.
-- =====================================================================

DROP FUNCTION IF EXISTS public.create_sale_atomic(uuid, uuid, jsonb, jsonb, jsonb, numeric);
DROP FUNCTION IF EXISTS public.create_sale_atomic(uuid, uuid, jsonb, jsonb, jsonb, numeric, date);

CREATE OR REPLACE FUNCTION public.create_sale_atomic(
  p_store_id uuid, p_customer_id uuid, p_items jsonb, p_payments jsonb,
  p_delivery jsonb, p_discount numeric DEFAULT 0, p_due_date date DEFAULT NULL,
  p_sale_date timestamptz DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
      values (p_store_id, v_sale_id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', v_op_date, v_ctx.profile_id);

      v_paid_total := v_paid_total + v_amount;
      continue;
    end if;

    -- paid_at = v_op_date (à vista paga na data da venda — mesmo que retroativa)
    insert into public.payments(store_id, sale_id, method, amount, provider, external_tx_id, paid_at, created_by)
    values (p_store_id, v_sale_id, v_method, v_amount, v_pay->>'provider', v_pay->>'external_tx_id', v_op_date, v_ctx.profile_id);
    if v_method = 'pending' then
      v_pending_total := v_pending_total + v_amount;
    else
      v_paid_total := v_paid_total + v_amount;
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
