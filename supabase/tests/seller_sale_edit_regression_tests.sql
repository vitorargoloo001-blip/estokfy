-- =====================================================================
-- Estokfy — Testes de Regressão: vendedora edita as próprias vendas
-- e correção da forma de pagamento (migration 20261014000001).
-- Rodar dentro de BEGIN ... ROLLBACK (não persiste nada). Os resultados
-- são devolvidos pelo SELECT final: ok = false indica falha.
-- =====================================================================

CREATE TEMP TABLE IF NOT EXISTS seller_tests(name text, ok boolean, detail text);

DO $t$
DECLARE
  v_store    uuid := gen_random_uuid();
  v_ledger   uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_product  uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid(); u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();     u_s uuid := gen_random_uuid();
  p_owner uuid := gen_random_uuid(); p_a uuid := gen_random_uuid();
  p_b uuid := gen_random_uuid();     p_s uuid := gen_random_uuid();
  s_a uuid := gen_random_uuid(); s_b uuid := gen_random_uuid();
  pay_a uuid := gen_random_uuid(); pay_b uuid := gen_random_uuid();
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 1, 'unit_price', 100));
  v_err text;
  v_t0 timestamptz;
  v_created timestamptz;
  v_method text;
  v_cash text;
  v_cnt int;
BEGIN
  INSERT INTO public.stores (id, name, trade_name, access_enabled, created_at)
  VALUES (v_store, 'Loja Teste Vendedora', 'Teste V', true, now());
  INSERT INTO public.profiles (id, auth_user_id, store_id, role, full_name, is_active) VALUES
    (p_owner, u_owner, v_store, 'owner', 'Dono', true),
    (p_a, u_a, v_store, 'sales', 'Vendedora A', true),
    (p_b, u_b, v_store, 'sales', 'Vendedora B', true),
    (p_s, u_s, v_store, 'stock', 'Estoque', true);
  INSERT INTO public.customers (id, store_id, name) VALUES (v_customer, v_store, 'Cliente Teste');
  INSERT INTO public.products (id, store_id, name, sku, on_hand, cost_price, sale_price, is_active)
  VALUES (v_product, v_store, 'Produto Teste', 'SKU-V', 1000, 20, 100, true);
  INSERT INTO public.cash_ledger (id, store_id, name, is_default) VALUES (v_ledger, v_store, 'Caixa Teste', true);

  INSERT INTO public.sales (id, store_id, customer_id, status, gross_total, discount_total, shipping_fee,
    net_total, cost_total, profit_gross, created_by, payment_status, amount_paid, amount_pending) VALUES
    (s_a, v_store, v_customer, 'paid', 100, 0, 0, 100, 20, 80, p_a, 'paid', 100, 0),
    (s_b, v_store, v_customer, 'paid', 100, 0, 0, 100, 20, 80, p_b, 'paid', 100, 0);
  INSERT INTO public.sale_items (sale_id, product_id, qty, unit_price, unit_cost, line_total) VALUES
    (s_a, v_product, 1, 100, 20, 100), (s_b, v_product, 1, 100, 20, 100);
  INSERT INTO public.payments (id, store_id, sale_id, method, amount, paid_at) VALUES
    (pay_a, v_store, s_a, 'cash', 100, now()), (pay_b, v_store, s_b, 'cash', 100, now());
  INSERT INTO public.cash_entries (store_id, ledger_id, entry_type, category, amount, payment_method, reference_type, reference_id, created_by, occurred_at, description) VALUES
    (v_store, v_ledger, 'income', 'venda', 100, 'cash', 'sale', s_a, p_a, now(), 'teste A'),
    (v_store, v_ledger, 'income', 'venda', 100, 'cash', 'sale', s_b, p_b, now(), 'teste B');

  SELECT created_at INTO v_t0 FROM public.sales WHERE id = s_a;

  -- 1) Vendedora A edita a própria venda (data enviada deve ser ignorada)
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  BEGIN
    PERFORM public.edit_sale_atomic(s_a, 'Ajuste de observação', v_customer, now() - interval '3 days',
      0, 0, 'obs nova', 'cash', 'paid', v_items, false, false);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  SELECT created_at INTO v_created FROM public.sales WHERE id = s_a;
  INSERT INTO seller_tests VALUES ('vendedora edita a própria venda', v_err IS NULL, coalesce(v_err, 'ok'));
  INSERT INTO seller_tests VALUES ('data da venda não muda ao editar como vendedora', v_created = v_t0, v_created::text);

  -- 2) Vendedora A tenta editar a venda da vendedora B
  BEGIN
    PERFORM public.edit_sale_atomic(s_b, 'Tentativa indevida', v_customer, NULL,
      0, 0, NULL, 'cash', 'paid', v_items, false, false);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO seller_tests VALUES ('vendedora não edita venda de outra', v_err LIKE 'SOMENTE_PROPRIA_VENDA%', coalesce(v_err, 'passou'));

  -- 3) Vendedora A tenta estornar o pagamento da própria venda
  BEGIN
    PERFORM public.edit_sale_atomic(s_a, 'Tentativa de estorno', v_customer, NULL,
      0, 0, NULL, 'cash', 'pending', v_items, false, true);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO seller_tests VALUES ('vendedora não estorna pagamento', v_err LIKE 'VENDEDOR_SEM_ESTORNO%', coalesce(v_err, 'passou'));

  -- 4) Papel de estoque continua sem permissão
  PERFORM set_config('request.jwt.claim.sub', u_s::text, true);
  BEGIN
    PERFORM public.edit_sale_atomic(s_a, 'Estoque tentando', v_customer, NULL,
      0, 0, NULL, 'cash', 'paid', v_items, false, false);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO seller_tests VALUES ('papel estoque continua bloqueado', v_err LIKE 'Sem permissão%', coalesce(v_err, 'passou'));

  -- 5) Dono edita qualquer venda (inclusive a da vendedora B)
  PERFORM set_config('request.jwt.claim.sub', u_owner::text, true);
  BEGIN
    PERFORM public.edit_sale_atomic(s_b, 'Ajuste do dono', v_customer, NULL,
      0, 0, NULL, 'cash', 'paid', v_items, false, false);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO seller_tests VALUES ('dono edita venda de qualquer vendedora', v_err IS NULL, coalesce(v_err, 'ok'));

  -- 6) Vendedora A corrige a forma do próprio recebimento: dinheiro -> pix
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  BEGIN
    PERFORM public.correct_sale_payment_method(pay_a, 'pix', 'Cliente pagou no Pix');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  SELECT method INTO v_method FROM public.payments WHERE id = pay_a;
  SELECT payment_method INTO v_cash FROM public.cash_entries WHERE reference_id = s_a AND entry_type = 'income' LIMIT 1;
  INSERT INTO seller_tests VALUES ('vendedora corrige forma do próprio recebimento', v_err IS NULL AND v_method = 'pix', coalesce(v_err, v_method));
  INSERT INTO seller_tests VALUES ('correção espelha no caixa', v_cash = 'pix', coalesce(v_cash, 'null'));

  -- 7) Vendedora A tenta corrigir recebimento da vendedora B
  BEGIN
    PERFORM public.correct_sale_payment_method(pay_b, 'pix', 'Tentativa indevida');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO seller_tests VALUES ('vendedora não corrige recebimento de outra', v_err LIKE 'SOMENTE_PROPRIA_VENDA%', coalesce(v_err, 'passou'));

  -- 8) Forma inválida (pendente não é forma de recebimento)
  BEGIN
    PERFORM public.correct_sale_payment_method(pay_a, 'pending', 'Teste de forma inválida');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO seller_tests VALUES ('forma inválida é recusada', v_err = 'forma_pagamento_invalida', coalesce(v_err, 'passou'));

  -- 9) Motivo curto é recusado
  BEGIN
    PERFORM public.correct_sale_payment_method(pay_a, 'cash', 'x');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO seller_tests VALUES ('motivo curto é recusado', v_err LIKE 'Informe o motivo%', coalesce(v_err, 'passou'));

  -- 10) Papel de estoque não corrige forma
  PERFORM set_config('request.jwt.claim.sub', u_s::text, true);
  BEGIN
    PERFORM public.correct_sale_payment_method(pay_a, 'cash', 'Estoque tentando');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO seller_tests VALUES ('papel estoque não corrige forma', v_err LIKE 'Sem permissão%', coalesce(v_err, 'passou'));

  -- 11) Permissões: anon não executa nenhuma das duas RPCs
  INSERT INTO seller_tests VALUES ('anon sem EXECUTE em edit_sale_atomic',
    NOT has_function_privilege('anon', 'public.edit_sale_atomic(uuid,text,uuid,timestamp with time zone,numeric,numeric,text,text,text,jsonb,boolean,boolean)', 'EXECUTE'), 'verificar');
  INSERT INTO seller_tests VALUES ('anon sem EXECUTE em correct_sale_payment_method',
    NOT has_function_privilege('anon', 'public.correct_sale_payment_method(uuid,text,text)', 'EXECUTE'), 'verificar');

  -- 12) Uma única versão de cada função (sem overload antigo)
  SELECT count(*) INTO v_cnt FROM pg_proc WHERE proname IN ('edit_sale_atomic', 'correct_sale_payment_method') AND pronamespace = 'public'::regnamespace;
  INSERT INTO seller_tests VALUES ('uma única versão de cada RPC', v_cnt = 2, v_cnt::text);

  -- 13) payments.created_at existe e tem default
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'created_at' AND column_default IS NOT NULL;
  INSERT INTO seller_tests VALUES ('payments.created_at com default', v_cnt = 1, v_cnt::text);
END;
$t$;

SELECT name, ok, detail FROM seller_tests ORDER BY name;
