-- =====================================================================
-- Connect: Sandbox V2 — gera alertas demo + seed atualizado para criar
--          alertas via trigger ao inserir transações divergentes
-- =====================================================================

-- Após sandbox V2, o connect_seed_demo_data cria alertas manuais extras
-- para demonstrar o painel de alertas mesmo sem trigger automático
CREATE OR REPLACE FUNCTION public.connect_seed_demo_data(p_store_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn_id     UUID;
  v_tx_id       UUID;
  v_sale_ids    UUID[] := '{}';
  v_sale_id     UUID;
  v_sale_amt    NUMERIC;
  v_sale_date   DATE;
  v_today       DATE := CURRENT_DATE;
  v_i           INTEGER;
  v_tx_count    INTEGER := 0;
  v_match_count INTEGER := 0;
  v_alert_count INTEGER := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas_super_admin';
  END IF;

  -- Idempotente: remove dados + alertas demo anteriores
  DELETE FROM public.bank_connections
  WHERE store_id = p_store_id AND bank_name = 'Banco Sandbox Demo';

  DELETE FROM public.connect_alerts
  WHERE store_id = p_store_id AND alert_type = 'demo';

  -- Cria conexão bancária demo
  INSERT INTO public.bank_connections (
    store_id, bank_name, bank_code, agency, account_number,
    account_type, account_holder, status,
    last_sync_at, last_sync_status, total_transactions, is_active
  ) VALUES (
    p_store_id, 'Banco Sandbox Demo', '077', '0001', '****9999',
    'checking', 'Empresa Demonstração Ltda', 'connected',
    now() - INTERVAL '8 minutes', 'success', 25, true
  ) RETURNING id INTO v_conn_id;

  -- Busca vendas reais para matches determinísticos
  SELECT ARRAY(
    SELECT s.id FROM public.sales s
    WHERE s.store_id = p_store_id
      AND s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled', 'refunded', 'returned')
      AND s.net_total > 0
    ORDER BY s.sale_date DESC
    LIMIT 4
  ) INTO v_sale_ids;

  -- ============================================================
  -- 8 transações CONCILIADAS — spread de 45 dias
  -- PIX, TED, Boleto com valores realistas
  -- ============================================================
  FOR v_i IN 1..8 LOOP
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_today - (v_i * 5 + (v_i % 3)),
      CASE v_i
        WHEN 1 THEN 250.00
        WHEN 2 THEN 1250.00
        WHEN 3 THEN 89.90
        WHEN 4 THEN 3200.00
        WHEN 5 THEN 450.50
        WHEN 6 THEN 120.00
        WHEN 7 THEN 780.00
        WHEN 8 THEN 2100.00
      END,
      'credit',
      CASE (v_i % 4)
        WHEN 0 THEN 'PIX RECEBIDO - MARIA SILVA'
        WHEN 1 THEN 'TED RECEBIDA - JOAO SANTOS LTDA'
        WHEN 2 THEN 'PIX - CARLOS OLIVEIRA'
        ELSE     'BOLETO COMPENSADO - EMPRESA ABC'
      END,
      'Banco Sandbox Demo',
      CASE (v_i % 3) WHEN 0 THEN 'pix' WHEN 1 THEN 'ted' ELSE 'boleto' END,
      'reconciled',
      'DEMO-REC-' || v_i || '-' || gen_random_uuid()::text
    );
    v_tx_count := v_tx_count + 1;
  END LOOP;

  -- ============================================================
  -- 5 transações DIVERGENTES
  -- Trigger insere alertas automaticamente via trg_divergent_transaction_alert
  -- ============================================================
  FOR v_i IN 1..5 LOOP
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_today - (v_i * 3 + 1),
      CASE v_i
        WHEN 1 THEN 999.99
        WHEN 2 THEN 350.00
        WHEN 3 THEN 1800.00
        WHEN 4 THEN 67.50
        WHEN 5 THEN 5000.00
      END,
      'credit',
      CASE v_i
        WHEN 1 THEN 'PIX SEM IDENTIFICAÇÃO - REF #' || (v_i * 1000)
        WHEN 2 THEN 'DEPOSITO AVULSO - ORIGEM DESCONHECIDA'
        WHEN 3 THEN 'TED RECEBIDA - POSSIVEL DUPLICATA'
        WHEN 4 THEN 'PIX - VALOR DIVERGENTE DA VENDA'
        WHEN 5 THEN 'TRANSFERÊNCIA ENTRADA - SEM REFERÊNCIA'
      END,
      'Banco Sandbox Demo',
      'pix',
      'divergent',
      'DEMO-DIV-' || v_i || '-' || gen_random_uuid()::text
    );
    v_tx_count := v_tx_count + 1;
  END LOOP;

  -- ============================================================
  -- 2 transações IGNORADAS (taxas/débitos bancários)
  -- ============================================================
  FOR v_i IN 1..2 LOOP
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_today - v_i,
      CASE v_i WHEN 1 THEN 12.90 ELSE 25.00 END,
      'debit',
      CASE v_i WHEN 1 THEN 'TARIFA MANUTENÇÃO CONTA' ELSE 'TAXA PIX SAÍDA' END,
      'Banco Sandbox Demo',
      'other',
      'ignored',
      'DEMO-IGN-' || v_i || '-' || gen_random_uuid()::text
    );
    v_tx_count := v_tx_count + 1;
  END LOOP;

  -- ============================================================
  -- 10 transações PENDENTES com suggestions
  -- 4 determinísticas ligadas a vendas reais
  -- 6 heurísticas/fuzzy sem link de venda
  -- ============================================================
  FOR v_i IN 1..4 LOOP
    v_sale_id := v_sale_ids[v_i];

    IF v_sale_id IS NOT NULL THEN
      SELECT s.net_total, s.sale_date::date
      INTO v_sale_amt, v_sale_date
      FROM public.sales s WHERE s.id = v_sale_id;
    ELSE
      v_sale_amt  := CASE v_i WHEN 1 THEN 380.00 WHEN 2 THEN 750.00 WHEN 3 THEN 1200.00 ELSE 280.00 END;
      v_sale_date := v_today - (v_i * 3 + 8);
    END IF;

    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_sale_date + 1,
      v_sale_amt,
      'credit',
      'PIX RECEBIDO - PEDIDO #' || (1000 + v_i * 10),
      'Banco Sandbox Demo',
      'pix',
      'pending',
      'DEMO-DET-' || v_i || '-' || gen_random_uuid()::text
    ) RETURNING id INTO v_tx_id;
    v_tx_count := v_tx_count + 1;

    INSERT INTO public.reconciliation_matches (
      store_id, bank_transaction_id, sale_id,
      match_type, confidence_score,
      amount_difference, date_difference_days, match_reason, status
    ) VALUES (
      p_store_id, v_tx_id, v_sale_id,
      CASE WHEN v_sale_id IS NOT NULL THEN 'deterministic' ELSE 'heuristic' END,
      CASE WHEN v_sale_id IS NOT NULL THEN 97 ELSE 74 END,
      0, 1,
      CASE WHEN v_sale_id IS NOT NULL
        THEN 'Valor exato + data correspondente (PIX D+1)'
        ELSE 'Padrão de recebimento PIX identificado'
      END,
      'pending'
    );
    v_match_count := v_match_count + 1;
  END LOOP;

  FOR v_i IN 1..6 LOOP
    INSERT INTO public.bank_transactions (
      store_id, bank_connection_id, transaction_date, amount,
      transaction_type, description, bank_name, method, status, bank_reference
    ) VALUES (
      p_store_id, v_conn_id,
      v_today - (v_i + 3),
      CASE v_i
        WHEN 1 THEN 320.00 WHEN 2 THEN 89.50 WHEN 3 THEN 1100.00
        WHEN 4 THEN 430.00 WHEN 5 THEN 210.00 ELSE 650.00
      END,
      'credit',
      CASE (v_i % 3)
        WHEN 0 THEN 'TED RECEBIDA - CLIENTE CORPORATIVO'
        WHEN 1 THEN 'PIX - REFERÊNCIA NÃO IDENTIFICADA'
        ELSE     'TRANSFERÊNCIA ENTRADA - LOJA ONLINE'
      END,
      'Banco Sandbox Demo',
      CASE (v_i % 2) WHEN 0 THEN 'ted' ELSE 'pix' END,
      'pending',
      'DEMO-HEU-' || v_i || '-' || gen_random_uuid()::text
    ) RETURNING id INTO v_tx_id;
    v_tx_count := v_tx_count + 1;

    INSERT INTO public.reconciliation_matches (
      store_id, bank_transaction_id, sale_id,
      match_type, confidence_score,
      amount_difference, date_difference_days, match_reason, status
    ) VALUES (
      p_store_id, v_tx_id, NULL,
      CASE WHEN v_i <= 3 THEN 'heuristic' ELSE 'fuzzy' END,
      CASE WHEN v_i <= 3 THEN (72 + v_i * 4) ELSE (42 + v_i * 3) END,
      round((v_i * 5.3)::numeric, 2),
      v_i,
      CASE WHEN v_i <= 3
        THEN 'Padrão de pagamento reconhecido — confirme a venda correspondente'
        ELSE 'Correspondência aproximada — revise antes de conciliar'
      END,
      'pending'
    );
    v_match_count := v_match_count + 1;
  END LOOP;

  UPDATE public.bank_connections
  SET total_transactions = v_tx_count
  WHERE id = v_conn_id;

  -- ============================================================
  -- Alertas demo extras (além dos auto-gerados pelo trigger)
  -- ============================================================
  INSERT INTO public.connect_alerts (store_id, alert_type, severity, title, message, entity_type)
  VALUES
    (p_store_id, 'demo', 'info',
     'Demonstração ativa',
     'Os dados exibidos são fictícios para fins de demonstração do Estokfy Connect.',
     'system'),
    (p_store_id, 'demo', 'warning',
     'Taxa de conciliação abaixo do recomendado',
     'A taxa de conciliação está em 40% este mês. Revise as transações pendentes para melhorar o indicador.',
     'reconciliation'),
    (p_store_id, 'demo', 'error',
     'Sincronização bancária com falha',
     'A última tentativa de sincronização do Banco Sandbox Demo falhou. Verifique as credenciais da conexão.',
     'bank_connection');

  SELECT COUNT(*) INTO v_alert_count
  FROM public.connect_alerts
  WHERE store_id = p_store_id AND dismissed_at IS NULL;

  RETURN jsonb_build_object(
    'connection_id',        v_conn_id,
    'transactions_created', v_tx_count,
    'matches_created',      v_match_count,
    'sales_linked',         COALESCE(array_length(v_sale_ids, 1), 0),
    'alerts_active',        v_alert_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_seed_demo_data(UUID) TO authenticated;
