-- =====================================================================
-- Estokfy — Testes de Regressão: Contas a Receber / Reversão de Pagamento
-- =====================================================================
-- Motivação: relato de clientes de que uma venda quitada ("Pago") volta a
-- aparecer em "Contas a Receber" no dia seguinte, sem nenhuma ação
-- explícita. Auditoria completa do fluxo (settle_sale_payment,
-- edit_sale_atomic, triggers em sales/payments, cron do Connect,
-- sync offline) encontrou a causa raiz: editar uma venda já paga pelo
-- EditSaleDialog permitia, por descuido, trocar o campo "Status" para
-- "Pendente" — o que a RPC edit_sale_atomic interpreta como um estorno
-- explícito do pagamento (zera amount_paid, cria saída de caixa).
--
-- Corrigido em três camadas:
--   1) Frontend (EditSaleDialog.tsx, commit 771c3a8 + reforço posterior):
--      para vendas já pagas, o campo Status fica travado como "Pago" e só
--      é editável após clique explícito em "Marcar como não paga"; a
--      confirmação do estorno exige digitar a palavra ESTORNAR (não é
--      mais um simples checkbox clicável sem ler).
--   2) Backend (edit_sale_atomic, já existente): reversão pago→não-pago
--      exige p_confirm_revert_payment = true, senão lança
--      'CONFIRM_REVERT_PAYMENT_REQUIRED' e nada é alterado.
--   3) Rede de segurança (trg_sales_alert_payment_reverted, migration
--      20260805000001): QUALQUER UPDATE em sales que tire uma venda de
--      'paid' — por este ou por qualquer outro caminho, presente ou
--      futuro — gera notificação crítica imediata (visível no sino do
--      app em até 60s), fechando o cenário de "descobri dias depois".
--
-- Este arquivo tranca a garantia de dados: uma venda 'paid' NUNCA deve
-- voltar para pending/partial como efeito colateral de uma edição de
-- rotina (forma de pagamento, itens, desconto) — só quando o chamador
-- passa p_confirm_revert_payment = true explicitamente.
--
-- Como executar:
--   Via Supabase Dashboard → SQL Editor → colar e executar
--   Via CLI: psql $DB_URL -f supabase/tests/accounts_receivable_regression_tests.sql
--
-- ATENÇÃO: Este script é READ-ONLY na produção (usa ROLLBACK no final).
-- Todos os dados de teste são criados com store_id novo (gen_random_uuid())
-- dentro de BEGIN...ROLLBACK, não persistem.
--
-- Nota técnica: PL/pgSQL não suporta declarar PROCEDUREs locais dentro da
-- seção DECLARE de um bloco DO (isso quebraria em runtime apesar de
-- parecer razoável) — por isso as asserções abaixo são inline (IF/RAISE
-- NOTICE), não helpers reutilizáveis.
-- =====================================================================

BEGIN;

DO $outer$
DECLARE
  v_store      UUID := gen_random_uuid();
  v_user       UUID := gen_random_uuid();
  v_profile    UUID := gen_random_uuid();
  v_customer   UUID := gen_random_uuid();
  v_product    UUID := gen_random_uuid();
  v_ledger     UUID := gen_random_uuid();
  v_sale1      UUID := gen_random_uuid();
  v_sale2      UUID := gen_random_uuid();
  v_sale3      UUID := gen_random_uuid();
  v_items      JSONB;
  v_row        RECORD;
  v_count      INTEGER;
  v_errors     INTEGER := 0;
  v_tests      INTEGER := 0;
BEGIN
  RAISE NOTICE '=== Estokfy — Regressão: Contas a Receber não reabre sozinha ===';

  -- ────────────────────────────────────────────────────────────
  -- SETUP
  -- ────────────────────────────────────────────────────────────
  INSERT INTO public.stores (id, name, trade_name, access_enabled, created_at)
  VALUES (v_store, 'Loja Teste AR', 'Teste AR', true, now());

  INSERT INTO public.profiles (id, auth_user_id, store_id, role, full_name, is_active)
  VALUES (v_profile, v_user, v_store, 'owner', 'Owner Teste AR', true);

  INSERT INTO public.customers (id, store_id, name)
  VALUES (v_customer, v_store, 'Cliente Teste AR');

  INSERT INTO public.products (id, store_id, name, sku, on_hand, cost_price, sale_price, is_active)
  VALUES (v_product, v_store, 'Produto Teste AR', 'SKU-AR-1', 1000, 10, 50, true);

  INSERT INTO public.cash_ledger (id, store_id, name, is_default)
  VALUES (v_ledger, v_store, 'Caixa Teste AR', true);

  -- Simula auth.uid() = v_user para as RPCs SECURITY DEFINER
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_items := jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 2, 'unit_price', 50));

  -- ────────────────────────────────────────────────────────────
  -- TESTE 1: settle_sale_payment quita totalmente uma venda pendente
  -- ────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- Teste 1: settle_sale_payment (pending -> paid) ---';

  INSERT INTO public.sales (id, store_id, customer_id, status, gross_total, discount_total, shipping_fee,
    net_total, cost_total, profit_gross, created_by, payment_status, amount_paid, amount_pending)
  VALUES (v_sale1, v_store, v_customer, 'paid', 100, 0, 0, 100, 20, 80, v_profile, 'pending', 0, 100);

  INSERT INTO public.sale_items (sale_id, product_id, qty, unit_price, unit_cost, line_total)
  VALUES (v_sale1, v_product, 2, 50, 10, 100);

  -- paid_at é intencionalmente retroagido 10 min: evita colidir com o
  -- unique index cash_entries_sale_dedup_uniq (store_id, reference_type,
  -- reference_id, amount, occurred_at_minute) — que não distingue
  -- entry_type — contra o estorno de mesmo valor lançado no Teste 4.
  PERFORM public.settle_sale_payment(
    p_sale_id => v_sale1,
    p_payments => jsonb_build_array(jsonb_build_object('method', 'pix', 'amount', 100)),
    p_paid_at => now() - interval '10 minutes'
  );

  SELECT * INTO v_row FROM public.sales WHERE id = v_sale1;

  v_tests := v_tests + 1;
  IF v_row.payment_status = 'paid' THEN
    RAISE NOTICE '✅ Venda 1: payment_status = paid após quitação total';
  ELSE
    RAISE NOTICE '❌ FALHA: Venda 1 payment_status = % (esperado paid)', v_row.payment_status;
    v_errors := v_errors + 1;
  END IF;

  v_tests := v_tests + 1;
  IF v_row.amount_paid = 100 AND v_row.amount_pending = 0 THEN
    RAISE NOTICE '✅ Venda 1: amount_paid=100 / amount_pending=0 após quitação total';
  ELSE
    RAISE NOTICE '❌ FALHA: Venda 1 amount_paid=% amount_pending=% (esperado 100/0)', v_row.amount_paid, v_row.amount_pending;
    v_errors := v_errors + 1;
  END IF;

  -- ────────────────────────────────────────────────────────────
  -- TESTE 2: editar venda já paga sem tocar no status preserva o pagamento
  -- (regressão direta do bug relatado)
  -- ────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- Teste 2: edit_sale_atomic em venda paga, sem mudar status ---';

  PERFORM public.edit_sale_atomic(
    p_sale_id => v_sale1,
    p_reason => 'Corrigindo forma de pagamento (edição de rotina)',
    p_customer_id => v_customer,
    p_created_at => now(),
    p_discount_total => 0,
    p_shipping_fee => 0,
    p_notes => 'obs de teste',
    p_payment_method => 'credit_card',
    p_payment_status => 'paid',
    p_items => v_items,
    p_allow_negative_stock => false,
    p_confirm_revert_payment => false
  );

  SELECT * INTO v_row FROM public.sales WHERE id = v_sale1;

  v_tests := v_tests + 1;
  IF v_row.payment_status = 'paid' AND v_row.amount_paid = 100 AND v_row.amount_pending = 0 THEN
    RAISE NOTICE '✅ Venda 1: permanece paid/100/0 após edição de rotina (forma de pagamento, itens, obs)';
  ELSE
    RAISE NOTICE '❌ FALHA: Venda 1 pós-edição = %/%/%  (esperado paid/100/0)', v_row.payment_status, v_row.amount_paid, v_row.amount_pending;
    v_errors := v_errors + 1;
  END IF;

  -- Edição de rotina (continua paid) não deve disparar o alerta de reversão
  SELECT COUNT(*) INTO v_count FROM public.notifications
   WHERE store_id = v_store AND entity_type = 'sale' AND entity_id = v_sale1
     AND type = 'sale_payment_reverted';

  v_tests := v_tests + 1;
  IF v_count = 0 THEN
    RAISE NOTICE '✅ Venda 1: nenhum alerta de reversão disparado por edição de rotina';
  ELSE
    RAISE NOTICE '❌ FALHA: alerta de reversão disparou sem reversão real (%)', v_count;
    v_errors := v_errors + 1;
  END IF;

  -- ────────────────────────────────────────────────────────────
  -- TESTE 3: tentar reverter pagamento SEM confirmação explícita
  -- deve falhar e não alterar nada
  -- ────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- Teste 3: reversão implícita (sem p_confirm_revert_payment) deve ser bloqueada ---';

  v_tests := v_tests + 1;
  BEGIN
    PERFORM public.edit_sale_atomic(
      p_sale_id => v_sale1,
      p_reason => 'Tentativa de mudar status sem querer',
      p_customer_id => v_customer,
      p_created_at => now(),
      p_discount_total => 0,
      p_shipping_fee => 0,
      p_notes => null,
      p_payment_method => 'credit_card',
      p_payment_status => 'pending',
      p_items => v_items,
      p_allow_negative_stock => false,
      p_confirm_revert_payment => false
    );
    RAISE NOTICE '❌ FALHA: edit_sale_atomic deveria ter lançado CONFIRM_REVERT_PAYMENT_REQUIRED';
    v_errors := v_errors + 1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'CONFIRM_REVERT_PAYMENT_REQUIRED%' THEN
      RAISE NOTICE '✅ Reversão implícita bloqueada corretamente: %', SQLERRM;
    ELSE
      RAISE NOTICE '❌ FALHA: exceção inesperada: %', SQLERRM;
      v_errors := v_errors + 1;
    END IF;
  END;

  SELECT * INTO v_row FROM public.sales WHERE id = v_sale1;

  v_tests := v_tests + 1;
  IF v_row.payment_status = 'paid' AND v_row.amount_paid = 100 THEN
    RAISE NOTICE '✅ Venda 1: continua paid/100 após tentativa bloqueada (nada mudou)';
  ELSE
    RAISE NOTICE '❌ FALHA: Venda 1 mudou mesmo com a tentativa bloqueada: %/%', v_row.payment_status, v_row.amount_paid;
    v_errors := v_errors + 1;
  END IF;

  -- ────────────────────────────────────────────────────────────
  -- TESTE 4: reversão EXPLÍCITA (p_confirm_revert_payment = true) é permitida
  -- (ação intencional do usuário deve funcionar e gerar estorno de caixa)
  -- ────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- Teste 4: reversão explícita (com confirmação) é permitida ---';

  PERFORM public.edit_sale_atomic(
    p_sale_id => v_sale1,
    p_reason => 'Cliente pediu estorno, marcando como não paga de propósito',
    p_customer_id => v_customer,
    p_created_at => now(),
    p_discount_total => 0,
    p_shipping_fee => 0,
    p_notes => null,
    p_payment_method => 'credit_card',
    p_payment_status => 'pending',
    p_items => v_items,
    p_allow_negative_stock => false,
    p_confirm_revert_payment => true
  );

  SELECT * INTO v_row FROM public.sales WHERE id = v_sale1;

  v_tests := v_tests + 1;
  IF v_row.payment_status = 'pending' AND v_row.amount_paid = 0 AND v_row.amount_pending = v_row.net_total THEN
    RAISE NOTICE '✅ Venda 1: reversão explícita aplicada corretamente (pending/0/%)', v_row.net_total;
  ELSE
    RAISE NOTICE '❌ FALHA: Venda 1 pós-reversão explícita = %/%/%  (esperado pending/0/%)', v_row.payment_status, v_row.amount_paid, v_row.amount_pending, v_row.net_total;
    v_errors := v_errors + 1;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.cash_entries
   WHERE reference_type = 'sale' AND reference_id = v_sale1 AND entry_type = 'expense';

  v_tests := v_tests + 1;
  IF v_count >= 1 THEN
    RAISE NOTICE '✅ Venda 1: estorno de caixa foi registrado (% lançamento(s))', v_count;
  ELSE
    RAISE NOTICE '❌ FALHA: nenhum lançamento de estorno de caixa encontrado';
    v_errors := v_errors + 1;
  END IF;

  -- Rede de segurança (trg_sales_alert_payment_reverted): mesmo uma
  -- reversão EXPLÍCITA e permitida deve gerar alerta crítico imediato,
  -- para o dono da loja ver o que aconteceu sem precisar descobrir depois.
  SELECT COUNT(*) INTO v_count FROM public.notifications
   WHERE store_id = v_store AND entity_type = 'sale' AND entity_id = v_sale1
     AND type = 'sale_payment_reverted' AND severity = 'critical';

  v_tests := v_tests + 1;
  IF v_count >= 1 THEN
    RAISE NOTICE '✅ Venda 1: notificação crítica de reversão foi criada';
  ELSE
    RAISE NOTICE '❌ FALHA: nenhuma notificação de reversão encontrada (trg_sales_alert_payment_reverted)';
    v_errors := v_errors + 1;
  END IF;

  -- E a tentativa BLOQUEADA do Teste 3 não deve ter gerado alerta nenhum
  -- (nada mudou no banco, então o trigger nem deveria ter disparado).
  SELECT COUNT(*) INTO v_count FROM public.notifications
   WHERE store_id = v_store AND entity_type = 'sale' AND entity_id = v_sale1
     AND type = 'sale_payment_reverted';

  v_tests := v_tests + 1;
  IF v_count = 1 THEN
    RAISE NOTICE '✅ Venda 1: exatamente 1 notificação de reversão (nenhuma duplicada pela tentativa bloqueada)';
  ELSE
    RAISE NOTICE '❌ FALHA: esperado 1 notificação de reversão, encontrado %', v_count;
    v_errors := v_errors + 1;
  END IF;

  -- ────────────────────────────────────────────────────────────
  -- TESTE 5: pagamento parcial não é zerado por edição de rotina
  -- (regressão do bug corrigido em 2026-06-25, fix_edit_sale_atomic_partial)
  -- ────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- Teste 5: edição de rotina em venda parcial preserva amount_paid ---';

  INSERT INTO public.sales (id, store_id, customer_id, status, gross_total, discount_total, shipping_fee,
    net_total, cost_total, profit_gross, created_by, payment_status, amount_paid, amount_pending)
  VALUES (v_sale2, v_store, v_customer, 'paid', 200, 0, 0, 200, 40, 160, v_profile, 'pending', 0, 200);

  INSERT INTO public.sale_items (sale_id, product_id, qty, unit_price, unit_cost, line_total)
  VALUES (v_sale2, v_product, 4, 50, 10, 200);

  PERFORM public.settle_sale_payment(
    p_sale_id => v_sale2,
    p_payments => jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 80))
  );

  SELECT * INTO v_row FROM public.sales WHERE id = v_sale2;

  v_tests := v_tests + 1;
  IF v_row.payment_status = 'partial' AND v_row.amount_paid = 80 THEN
    RAISE NOTICE '✅ Venda 2: partial/80 após pagamento parcial';
  ELSE
    RAISE NOTICE '❌ FALHA: Venda 2 pós-parcial = %/%  (esperado partial/80)', v_row.payment_status, v_row.amount_paid;
    v_errors := v_errors + 1;
  END IF;

  PERFORM public.edit_sale_atomic(
    p_sale_id => v_sale2,
    p_reason => 'Corrigindo observação (edição de rotina, sem tocar status)',
    p_customer_id => v_customer,
    p_created_at => now(),
    p_discount_total => 0,
    p_shipping_fee => 0,
    p_notes => 'nota atualizada',
    p_payment_method => 'cash',
    p_payment_status => 'partial',
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', 4, 'unit_price', 50)),
    p_allow_negative_stock => false,
    p_confirm_revert_payment => false
  );

  SELECT * INTO v_row FROM public.sales WHERE id = v_sale2;

  v_tests := v_tests + 1;
  IF v_row.payment_status = 'partial' AND v_row.amount_paid = 80 AND v_row.amount_pending = 120 THEN
    RAISE NOTICE '✅ Venda 2: continua partial/80/120 após edição de rotina (pagamento real preservado)';
  ELSE
    RAISE NOTICE '❌ FALHA: Venda 2 pós-edição = %/%/%  (esperado partial/80/120)', v_row.payment_status, v_row.amount_paid, v_row.amount_pending;
    v_errors := v_errors + 1;
  END IF;

  -- ────────────────────────────────────────────────────────────
  -- TESTE 6: settle_sale_payment recusa quitar venda já paga
  -- ────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- Teste 6: settle_sale_payment bloqueia venda já quitada ---';

  INSERT INTO public.sales (id, store_id, customer_id, status, gross_total, discount_total, shipping_fee,
    net_total, cost_total, profit_gross, created_by, payment_status, amount_paid, amount_pending)
  VALUES (v_sale3, v_store, v_customer, 'paid', 50, 0, 0, 50, 10, 40, v_profile, 'paid', 50, 0);

  v_tests := v_tests + 1;
  BEGIN
    PERFORM public.settle_sale_payment(
      p_sale_id => v_sale3,
      p_payments => jsonb_build_array(jsonb_build_object('method', 'pix', 'amount', 50))
    );
    RAISE NOTICE '❌ FALHA: settle_sale_payment deveria ter lançado venda_ja_quitada';
    v_errors := v_errors + 1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'venda_ja_quitada%' THEN
      RAISE NOTICE '✅ settle_sale_payment bloqueou corretamente: %', SQLERRM;
    ELSE
      RAISE NOTICE '❌ FALHA: exceção inesperada: %', SQLERRM;
      v_errors := v_errors + 1;
    END IF;
  END;

  SELECT * INTO v_row FROM public.sales WHERE id = v_sale3;

  v_tests := v_tests + 1;
  IF v_row.payment_status = 'paid' AND v_row.amount_paid = 50 THEN
    RAISE NOTICE '✅ Venda 3: continua paid/50 (nenhuma duplicação de pagamento)';
  ELSE
    RAISE NOTICE '❌ FALHA: Venda 3 mudou: %/%', v_row.payment_status, v_row.amount_paid;
    v_errors := v_errors + 1;
  END IF;

  -- ────────────────────────────────────────────────────────────
  -- RESULTADO FINAL
  -- ────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTADO: % testes, % falha(s) ===', v_tests, v_errors;
  IF v_errors = 0 THEN
    RAISE NOTICE '✅ TODOS OS TESTES PASSARAM — venda paga não reabre sem ação explícita';
  ELSE
    RAISE EXCEPTION '❌ % TESTE(S) FALHARAM — ver NOTICEs acima', v_errors;
  END IF;
END;
$outer$;

-- Garante que nenhuma mudança persiste (testes são não-destrutivos)
ROLLBACK;
