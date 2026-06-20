-- =====================================================================
-- Connect: Sandbox — cenário completo
-- Gera 40+ transações com todos os cenários possíveis:
-- PIX, Cartão, TED, Boleto, Dinheiro
-- Divergências de todos os tipos, duplicidades, atrasos
-- Gate: apenas vitorargoloo001@gmail.com
-- =====================================================================

CREATE OR REPLACE FUNCTION public.connect_seed_scenario_completo(p_store_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email     TEXT;
  v_conn_pix       UUID;
  v_conn_card      UUID;
  v_conn_cash      UUID;
  v_txn_ids        UUID[];
  v_match_id       UUID;
  v_sale_ids       UUID[];
  v_sale_id        UUID;
  v_today          DATE := CURRENT_DATE;
  v_txns_created   INT := 0;
  v_matches_created INT := 0;
  v_alerts_created INT := 0;
BEGIN
  -- ── Gate de segurança ────────────────────────────────────────────
  SELECT u.email INTO v_user_email
  FROM auth.users u WHERE u.id = auth.uid();

  IF v_user_email IS DISTINCT FROM 'vitorargoloo001@gmail.com' THEN
    RAISE EXCEPTION 'Acesso negado: somente o super admin pode gerar o cenário completo';
  END IF;

  -- ── Limpar dados demo anteriores desta loja ───────────────────────
  DELETE FROM public.connect_alerts  WHERE store_id = p_store_id;
  DELETE FROM public.reconciliation_matches
    WHERE store_id = p_store_id
      AND bank_transaction_id IN (
        SELECT bt.id FROM public.bank_transactions bt
        JOIN public.bank_connections bc ON bc.id = bt.bank_connection_id
        WHERE bt.store_id = p_store_id
          AND bc.bank_name IN ('Banco PIX Sandbox','Cartão Sandbox','Dinheiro/Boleto Sandbox','Banco Sandbox Demo')
      );
  DELETE FROM public.bank_transactions
    WHERE store_id = p_store_id
      AND bank_connection_id IN (
        SELECT id FROM public.bank_connections
        WHERE store_id = p_store_id
          AND bank_name IN ('Banco PIX Sandbox','Cartão Sandbox','Dinheiro/Boleto Sandbox','Banco Sandbox Demo')
      );
  DELETE FROM public.bank_connections
    WHERE store_id = p_store_id
      AND bank_name IN ('Banco PIX Sandbox','Cartão Sandbox','Dinheiro/Boleto Sandbox','Banco Sandbox Demo');

  -- ── Criar 3 conexões bancárias ───────────────────────────────────
  INSERT INTO public.bank_connections (id, store_id, bank_name, bank_code, account_holder, status, is_active, last_sync_at)
  VALUES (gen_random_uuid(), p_store_id, 'Banco PIX Sandbox', '077', 'LOJA DEMO LTDA', 'connected', true, now())
  RETURNING id INTO v_conn_pix;

  INSERT INTO public.bank_connections (id, store_id, bank_name, bank_code, account_holder, status, is_active, last_sync_at)
  VALUES (gen_random_uuid(), p_store_id, 'Cartão Sandbox', '341', 'LOJA DEMO LTDA', 'connected', true, now())
  RETURNING id INTO v_conn_card;

  INSERT INTO public.bank_connections (id, store_id, bank_name, bank_code, account_holder, status, is_active, last_sync_at)
  VALUES (gen_random_uuid(), p_store_id, 'Dinheiro/Boleto Sandbox', '001', 'LOJA DEMO LTDA', 'connected', true, now())
  RETURNING id INTO v_conn_cash;

  -- ── Buscar vendas reais da loja para vincular ─────────────────────
  SELECT ARRAY(
    SELECT id FROM public.sales
    WHERE store_id = p_store_id
      AND payment_status NOT IN ('cancelled')
    ORDER BY sale_date DESC
    LIMIT 15
  ) INTO v_sale_ids;

  -- ── BLOCO 1: PIX conciliados automaticamente (10 transações) ──────
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 0,  250.00, 'credit', 'pix', 'PIX RECEBIDO MARIA SILVA',        'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 1,  1250.00,'credit', 'pix', 'PIX RECEBIDO JOAO SANTOS',        'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 2,   89.90, 'credit', 'pix', 'PIX RECEBIDO ANA COSTA',          'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 3,  3200.00,'credit', 'pix', 'PIX RECEBIDO PEDRO ALVES',        'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 4,   450.00,'credit', 'pix', 'PIX RECEBIDO LUCIA MENDES',       'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 5,   780.50,'credit', 'pix', 'PIX RECEBIDO CARLOS FERREIRA',    'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 7,  1890.00,'credit', 'pix', 'PIX RECEBIDO JULIA RODRIGUES',    'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 8,   320.00,'credit', 'pix', 'PIX RECEBIDO MARCOS LIMA',        'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 10, 5400.00,'credit', 'pix', 'PIX RECEBIDO EMPRESA XYZ LTDA',   'Banco PIX Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 12,  675.00,'credit', 'pix', 'PIX RECEBIDO FERNANDA OLIVEIRA',  'Banco PIX Sandbox', 'reconciled');
  v_txns_created := v_txns_created + 10;

  -- ── BLOCO 2: Cartão crédito/débito conciliados manualmente (8 txns) ──
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 1,  398.00, 'credit', 'credit_card', 'VENDA CRÉDITO MASTERCARD **** 1234', 'Cartão Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 2,  1100.00,'credit', 'credit_card', 'VENDA CRÉDITO VISA **** 5678',       'Cartão Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 3,   290.00,'credit', 'debit_card',  'VENDA DÉBITO ELO **** 9012',         'Cartão Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 5,   870.00,'credit', 'credit_card', 'VENDA CRÉDITO VISA **** 3456',       'Cartão Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 6,  2450.00,'credit', 'credit_card', 'VENDA CRÉDITO AMEX **** 7890',       'Cartão Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 8,   560.00,'credit', 'debit_card',  'VENDA DÉBITO MASTERCARD **** 2345',  'Cartão Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 9,   195.00,'credit', 'credit_card', 'VENDA CRÉDITO HIPERCARD **** 6789',  'Cartão Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 11, 3780.00,'credit', 'credit_card', 'VENDA CRÉDITO VISA **** 0123',       'Cartão Sandbox', 'reconciled');
  v_txns_created := v_txns_created + 8;

  -- ── BLOCO 3: TED/Boleto conciliados (6 txns) ─────────────────────
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 2,  4500.00,'credit', 'ted',    'TED EMPRESA ATACADO NORTE LTDA',       'Dinheiro/Boleto Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 6,  2200.00,'credit', 'ted',    'TED DISTRIBUIDORA SUL SA',             'Dinheiro/Boleto Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 4,   980.00,'credit', 'boleto', 'BOLETO 350.9321.4401 MARIA J SILVA',   'Dinheiro/Boleto Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 7,  1650.00,'credit', 'boleto', 'BOLETO 350.9321.4402 PEDRO C ALVES',   'Dinheiro/Boleto Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 3,   420.00,'credit', 'money',  'DEPOSITO EM ESPECIE AG 0042',          'Dinheiro/Boleto Sandbox', 'reconciled'),
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 9,   850.00,'credit', 'money',  'DEPOSITO EM ESPECIE AG 0042',          'Dinheiro/Boleto Sandbox', 'reconciled');
  v_txns_created := v_txns_created + 6;

  -- ── BLOCO 4: Recebimentos atrasados — pendentes sem match (5 txns) ─
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_pix,  v_today - 45, 1290.00,'credit', 'pix',    'PIX RECEBIDO ATRASADO ROBERTO NUNES',     'Banco PIX Sandbox', 'pending'),
    (gen_random_uuid(), p_store_id, v_conn_pix,  v_today - 38, 3450.00,'credit', 'pix',    'PIX RECEBIDO ATRASADO EMPRESA ABC',        'Banco PIX Sandbox', 'pending'),
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 60, 5800.00,'credit', 'boleto', 'BOLETO VENCIDO 350.9321.9901 ATRASADO',   'Dinheiro/Boleto Sandbox', 'pending'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 30, 2100.00,'credit', 'credit_card', 'VENDA CRÉDITO ATRASADA VISA **** 4444','Cartão Sandbox', 'pending'),
    (gen_random_uuid(), p_store_id, v_conn_pix,  v_today - 22,  890.00,'credit', 'pix',    'PIX RECEBIDO 30 DIAS ATRAS CLAUDIO',      'Banco PIX Sandbox', 'pending');
  v_txns_created := v_txns_created + 5;

  -- ── BLOCO 5: Divergências — todos os tipos (6 txns) ──────────────
  -- 5a. Valor diferente (cliente errou o valor no PIX)
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status, divergence_type, divergence_reason)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 1, 249.00,'credit','pix',
     'PIX RECEBIDO ANA LUIZA - VALOR ERRADO', 'Banco PIX Sandbox', 'divergent',
     'amount_different', 'Valor enviado foi R$ 249,00 porém venda é de R$ 250,00');
  v_txns_created := v_txns_created + 1;

  -- 5b. Data diferente (pagamento feito no dia seguinte)
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status, divergence_type, divergence_reason)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_card, v_today, 1500.00,'credit','credit_card',
     'VENDA CRÉDITO DATA INCOMPATÍVEL **** 5555', 'Cartão Sandbox', 'divergent',
     'date_different', 'Liquidação do cartão ocorreu D+1 após a venda');
  v_txns_created := v_txns_created + 1;

  -- 5c. Cliente não encontrado
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status, divergence_type, divergence_reason)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 3, 720.00,'credit','pix',
     'PIX RECEBIDO SEM IDENTIFICACAO 11999887766', 'Banco PIX Sandbox', 'divergent',
     'customer_not_found', 'Chave PIX não cadastrada no sistema');
  v_txns_created := v_txns_created + 1;

  -- 5d. Pagamento duplicado (mesmo valor, mesma data, mesmo pagador)
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status, divergence_type, divergence_reason)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today - 2, 450.00,'credit','pix',
     'PIX RECEBIDO LUCIA MENDES - DUPLICADO', 'Banco PIX Sandbox', 'divergent',
     'duplicate_payment', 'Mesmo pagador e valor do dia -4, possível duplicidade');
  v_txns_created := v_txns_created + 1;

  -- 5e. Recebimento sem venda (pagamento não identificado)
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status, divergence_type, divergence_reason)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 5, 9800.00,'credit','ted',
     'TED ORIGEM DESCONHECIDA HOLDING XYZ', 'Dinheiro/Boleto Sandbox', 'divergent',
     'receipt_without_sale', 'TED de origem não identificada sem venda correspondente');
  v_txns_created := v_txns_created + 1;

  -- 5f. Recebimento suspeito (valor muito alto, horário incomum)
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status, divergence_type, divergence_reason)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_pix, v_today, 48500.00,'credit','pix',
     'PIX RECEBIDO VALOR ATIPICO EMPRESA ANONIMA', 'Banco PIX Sandbox', 'divergent',
     'receipt_without_sale', 'Valor muito acima da média histórica da loja');
  v_txns_created := v_txns_created + 1;

  -- ── BLOCO 6: Pendentes com sugestão automática (5 txns) ──────────
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_pix,  v_today,     330.00,'credit','pix',    'PIX RECEBIDO AGUARDANDO REVISAO',         'Banco PIX Sandbox', 'pending'),
    (gen_random_uuid(), p_store_id, v_conn_pix,  v_today - 1, 2780.00,'credit','pix',   'PIX RECEBIDO EMPRESA BETA',               'Banco PIX Sandbox', 'pending'),
    (gen_random_uuid(), p_store_id, v_conn_card, v_today - 2,  645.00,'credit','debit_card', 'VENDA DEBITO PENDENTE **** 7777',     'Cartão Sandbox', 'pending'),
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 1, 1100.00,'credit','boleto', 'BOLETO PAGO 350.9321.5501 PENDENTE',     'Dinheiro/Boleto Sandbox', 'pending'),
    (gen_random_uuid(), p_store_id, v_conn_pix,  v_today - 3,  480.00,'credit','pix',   'PIX RECEBIDO AGUARDANDO CONFIRMACAO',     'Banco PIX Sandbox', 'pending');
  v_txns_created := v_txns_created + 5;

  -- ── BLOCO 7: Ignoradas (3 txns) ──────────────────────────────────
  INSERT INTO public.bank_transactions (id, store_id, bank_connection_id, transaction_date, amount, transaction_type, method, description, bank_name, status)
  VALUES
    (gen_random_uuid(), p_store_id, v_conn_pix,  v_today - 15, 0.01,'credit','pix',    'PIX RECEBIDO TESTE 1 CENTAVO',            'Banco PIX Sandbox', 'ignored'),
    (gen_random_uuid(), p_store_id, v_conn_cash, v_today - 20, 50.00,'credit','money', 'DEPOSITO FUNCIONARIO REEMBOLSO INTERNO',  'Dinheiro/Boleto Sandbox', 'ignored'),
    (gen_random_uuid(), p_store_id, v_conn_pix,  v_today - 10, 10.00,'credit','pix',   'PIX ESTORNO RETORNADO',                   'Banco PIX Sandbox', 'ignored');
  v_txns_created := v_txns_created + 3;

  -- ── Criar matches para transações reconciliadas ───────────────────
  -- Vincular às primeiras 10 vendas reais se existirem
  IF array_length(v_sale_ids, 1) >= 1 THEN
    -- Match determinístico para as primeiras transações reconciliadas
    WITH reconciled_txns AS (
      SELECT bt.id AS tx_id, row_number() OVER (ORDER BY bt.transaction_date DESC) AS rn
      FROM public.bank_transactions bt
      JOIN public.bank_connections bc ON bc.id = bt.bank_connection_id
      WHERE bt.store_id = p_store_id
        AND bt.status = 'reconciled'
        AND bc.bank_name IN ('Banco PIX Sandbox','Cartão Sandbox','Dinheiro/Boleto Sandbox')
    )
    INSERT INTO public.reconciliation_matches (
      store_id, bank_transaction_id, sale_id,
      match_type, confidence_score, status, match_reason,
      confirmed_by, confirmed_at
    )
    SELECT
      p_store_id,
      rt.tx_id,
      v_sale_ids[LEAST(rt.rn, array_length(v_sale_ids, 1))],
      CASE WHEN rt.rn <= 5 THEN 'deterministic' WHEN rt.rn <= 12 THEN 'heuristic' ELSE 'fuzzy' END,
      CASE WHEN rt.rn <= 5 THEN 100 WHEN rt.rn <= 12 THEN FLOOR(85 + random() * 10)::int ELSE FLOOR(60 + random() * 20)::int END,
      'confirmed',
      CASE WHEN rt.rn <= 5 THEN 'Conciliação determinística: valor e data exatos'
           WHEN rt.rn <= 12 THEN 'Conciliação heurística: valor e cliente compatíveis'
           ELSE 'Conciliação fuzzy: similaridade parcial' END,
      (SELECT id FROM public.profiles WHERE store_id = p_store_id LIMIT 1),
      now() - (rt.rn || ' hours')::interval
    FROM reconciled_txns rt
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_matches_created = ROW_COUNT;
  END IF;

  -- ── Criar matches pendentes (com sugestão) ────────────────────────
  IF array_length(v_sale_ids, 1) >= 6 THEN
    WITH pending_txns AS (
      SELECT bt.id AS tx_id, row_number() OVER (ORDER BY bt.transaction_date DESC) AS rn
      FROM public.bank_transactions bt
      JOIN public.bank_connections bc ON bc.id = bt.bank_connection_id
      WHERE bt.store_id = p_store_id
        AND bt.status = 'pending'
        AND bc.bank_name IN ('Banco PIX Sandbox','Cartão Sandbox','Dinheiro/Boleto Sandbox')
      LIMIT 5
    )
    INSERT INTO public.reconciliation_matches (
      store_id, bank_transaction_id, sale_id,
      match_type, confidence_score, status, match_reason
    )
    SELECT
      p_store_id,
      pt.tx_id,
      v_sale_ids[LEAST(5 + pt.rn, array_length(v_sale_ids, 1))],
      'heuristic',
      FLOOR(55 + random() * 35)::int,
      'pending',
      'Sugestão automática: valor e data próximos'
    FROM pending_txns pt
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_match_id = ROW_COUNT;
  END IF;

  -- ── Criar alertas para o cenário ─────────────────────────────────

  -- Alerta: cenário completo ativo
  INSERT INTO public.connect_alerts (store_id, alert_type, severity, title, message)
  VALUES (p_store_id, 'demo', 'info',
    'Cenário Completo Ativo',
    'Foram geradas ' || v_txns_created || ' transações de demonstração cobrindo todos os fluxos: PIX, Cartão, TED, Boleto, Dinheiro, Divergências e Duplicidades.');
  v_alerts_created := v_alerts_created + 1;

  -- Alerta: divergências pendentes
  INSERT INTO public.connect_alerts (store_id, alert_type, severity, title, message, entity_type)
  VALUES (p_store_id, 'divergent_transaction', 'error',
    '6 Divergências Detectadas',
    'O cenário inclui 6 transações divergentes de diferentes tipos: valor incorreto, data incompatível, cliente não identificado, pagamento duplicado e recebimentos suspeitos.',
    'bank_transaction');
  v_alerts_created := v_alerts_created + 1;

  -- Alerta: pagamento duplicado
  INSERT INTO public.connect_alerts (store_id, alert_type, severity, title, message, entity_type)
  VALUES (p_store_id, 'duplicate_payment', 'warning',
    'Possível Pagamento Duplicado',
    'Detectado PIX de R$ 450,00 de LUCIA MENDES em data próxima a pagamento anterior de mesmo valor. Verifique na Central de Divergências.',
    'bank_transaction');
  v_alerts_created := v_alerts_created + 1;

  -- Alerta: recebimento suspeito
  INSERT INTO public.connect_alerts (store_id, alert_type, severity, title, message, entity_type)
  VALUES (p_store_id, 'suspicious_receipt', 'error',
    'Recebimento Suspeito: R$ 48.500,00',
    'TED de valor atípico (R$ 48.500,00) recebido de origem desconhecida "EMPRESA ANONIMA". Recomendamos verificação imediata.',
    'bank_transaction');
  v_alerts_created := v_alerts_created + 1;

  -- Alerta: recebimentos atrasados
  INSERT INTO public.connect_alerts (store_id, alert_type, severity, title, message)
  VALUES (p_store_id, 'pending_too_long', 'warning',
    '5 Recebimentos Não Conciliados (>30 dias)',
    'Existem 5 transações com mais de 30 dias sem conciliação. A mais antiga é de ' || (v_today - 60) || '. Revise na aba Pendentes.',
    '');
  v_alerts_created := v_alerts_created + 1;

  -- Alerta: taxa de conciliação abaixo de 80%
  INSERT INTO public.connect_alerts (store_id, alert_type, severity, title, message)
  VALUES (p_store_id, 'low_reconciliation_rate', 'warning',
    'Taxa de Conciliação Abaixo de 80%',
    'O cenário de demonstração tem taxa de ~60% para mostrar como o sistema alerta quando a conciliação está abaixo do ideal.',
    '');
  v_alerts_created := v_alerts_created + 1;

  RETURN jsonb_build_object(
    'transactions_created', v_txns_created,
    'matches_created',      v_matches_created,
    'alerts_created',       v_alerts_created,
    'connections_created',  3,
    'scenario', jsonb_build_array(
      'PIX: 15 transações',
      'Cartão Crédito/Débito: 8 transações',
      'TED/Boleto/Dinheiro: 6 transações',
      'Recebimentos atrasados: 5 transações',
      'Divergências (6 tipos): 6 transações',
      'Ignoradas: 3 transações'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_seed_scenario_completo(UUID) TO authenticated;
