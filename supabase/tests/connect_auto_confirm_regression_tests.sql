-- Conciliação automática (_connect_auto_confirm, chamada pelo motor
-- _connect_run_matching_core). Migration 20261030000002.
-- All fixtures and the function copies live in pg_temp. No production rows or
-- function definitions are changed. The transaction is rolled back at the end.
BEGIN;
CREATE TEMP TABLE auto_checks (label text, actual text, expected text);
DO $$
DECLARE
  t text; f text; definition text;
  tables text[] := ARRAY['sales','payments','customers','bank_transactions','reconciliation_matches',
    'mercadopago_pix_charges','connect_automations','cash_ledger','cash_entries','audit_logs',
    'connect_notifications','connect_system_logs','payment_allocations','sale_items'];
  functions text[] := ARRAY['_connect_run_matching_core(uuid)','_connect_auto_confirm(uuid,numeric)',
    '_connect_settle_sale_system(uuid,uuid,text,numeric,uuid)','_allocate_payment_fifo_within_sale(uuid,uuid,numeric)',
    'add_connect_log(uuid,text,text,jsonb,uuid,uuid,text)',
    'create_connect_notification(uuid,text,text,text,text,text,uuid,uuid,jsonb)'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE TEMP TABLE %I AS SELECT * FROM public.%I WITH NO DATA', t, t);
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'id') THEN
      EXECUTE format('ALTER TABLE pg_temp.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()', t);
    END IF;
  END LOOP;
  FOREACH f IN ARRAY functions LOOP
    definition := pg_get_functiondef(('public.' || f)::regprocedure);
    FOREACH t IN ARRAY ARRAY['_connect_run_matching_core','_connect_auto_confirm','_connect_settle_sale_system',
        '_allocate_payment_fifo_within_sale','add_connect_log','create_connect_notification'] || tables LOOP
      definition := replace(definition, 'public.' || t, 'pg_temp.' || t);
    END LOOP;
    EXECUTE definition;
  END LOOP;
END $$;

-- Loja 1 com a automação ligada (nota mínima 85). Loja 2 fica de fora.
INSERT INTO pg_temp.connect_automations(id,store_id,type,name,is_active,config) VALUES
('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000001','auto_reconciliation','Conciliação Automática',true,'{"min_confidence":85}');
INSERT INTO pg_temp.cash_ledger(id,store_id,is_default) VALUES
('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000001',true);
INSERT INTO pg_temp.customers(id,store_id,name) VALUES
('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','Carla Mendes'),
('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','Bruno Lima');
-- 101: venda paga em Pix no caixa. 102: venda a prazo da Carla (R$ 80, vence 10/10).
-- 103: venda no cartão de R$ 100. 104: venda a prazo do Bruno, quitada por fora depois da sugestão.
-- 105: venda paga em Pix (R$ 45), usada com a automação desligada. 106: loja 2.
INSERT INTO pg_temp.sales(id,store_id,customer_id,status,payment_status,deleted_at,amount_paid,amount_pending,sale_date,due_date) VALUES
('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001',null,'completed','paid',null,30,0,'2026-10-10',null),
('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000021','completed','pending',null,0,80,'2026-10-08','2026-10-10'),
('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000001',null,'completed','paid',null,100,0,'2026-10-05',null),
('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000022','completed','paid',null,40,0,'2026-10-08','2026-10-10'),
('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000001',null,'completed','paid',null,45,0,'2026-10-12',null),
('00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000002',null,'completed','paid',null,30,0,'2026-10-10',null);
INSERT INTO pg_temp.sale_items(id,sale_id,line_total) VALUES
('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000102',80);
INSERT INTO pg_temp.payments(id,store_id,sale_id,method,amount,paid_at) VALUES
('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','pix',30,'2026-10-10T15:00Z'),
('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102','pending',80,'2026-10-08T15:00Z'),
('00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000103','credit_card',100,'2026-10-05T15:00Z'),
('00000000-0000-0000-0000-000000000205','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000105','pix',45,'2026-10-12T15:00Z'),
('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000106','pix',30,'2026-10-10T15:00Z');
-- 401: Pix de R$ 30 (nota 100). 402: Pix da Carla pagando a venda a prazo (nota 93).
-- 403: R$ 96 contra o cartão de R$ 100 cinco dias antes (nota 70, abaixo do mínimo).
-- 404: Pix do Bruno com sugestão já criada para a venda 104, que foi quitada por fora.
-- 406: loja 2, com sugestão de nota 100 pendente.
INSERT INTO pg_temp.bank_transactions(id,store_id,amount,transaction_date,description,method,status,transaction_type) VALUES
('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000001',30,'2026-10-10','PIX RECEBIDO JOAO','pix','pending','credit'),
('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000001',80,'2026-10-10','PIX RECEBIDO CARLA MENDES','pix','pending','credit'),
('00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000001',96,'2026-10-10','REPASSE CARTAO','credit_card','pending','credit'),
('00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000001',40,'2026-10-10','PIX RECEBIDO BRUNO LIMA','pix','pending','credit'),
('00000000-0000-0000-0000-000000000406','00000000-0000-0000-0000-000000000002',30,'2026-10-10','PIX RECEBIDO','pix','pending','credit');
INSERT INTO pg_temp.reconciliation_matches(id,store_id,bank_transaction_id,sale_id,payment_id,match_type,confidence_score,status) VALUES
('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000104',null,'deterministic',95,'pending'),
('00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000406','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000206','deterministic',100,'pending');

DO $$
DECLARE r jsonb; new_payment uuid;
BEGIN
  r := pg_temp._connect_run_matching_core('00000000-0000-0000-0000-000000000001');
  SELECT payment_id INTO new_payment FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000402';
  INSERT INTO auto_checks VALUES
    ('matches created', r->>'matches_created', '3'),
    ('auto confirmed', r->'auto_confirm'->>'confirmed', '2'),
    ('auto settled', r->'auto_confirm'->>'settled', '1'),
    ('auto skipped', r->'auto_confirm'->>'skipped', '1'),
    ('Pix R$30 confirmed on its payment',
      (SELECT status || ' ' || payment_id::text FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000401'),
      'confirmed 00000000-0000-0000-0000-000000000201'),
    ('Pix R$30 note',
      (SELECT notes FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000401'),
      'Confirmada automaticamente (nota 100, mínimo 85)'),
    ('Pix R$30 bank tx reconciled to its sale',
      (SELECT status || ' ' || sale_id::text FROM pg_temp.bank_transactions WHERE id='00000000-0000-0000-0000-000000000401'),
      'reconciled 00000000-0000-0000-0000-000000000101'),
    ('Carla match confirmed', (SELECT status FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000402'), 'confirmed'),
    ('Carla new payment is the Pix tied to the bank tx',
      (SELECT method || ' ' || amount::int::text || ' ' || bank_transaction_id::text FROM pg_temp.payments WHERE id = new_payment),
      'pix 80 00000000-0000-0000-0000-000000000402'),
    ('Carla pending payment removed', (SELECT count(*)::text FROM pg_temp.payments WHERE sale_id='00000000-0000-0000-0000-000000000102' AND method='pending'), '0'),
    ('Carla sale paid',
      (SELECT payment_status || ' ' || amount_paid::int::text || ' ' || amount_pending::int::text FROM pg_temp.sales WHERE id='00000000-0000-0000-0000-000000000102'),
      'paid 80 0'),
    ('Carla cash entry', (SELECT count(*)::text || ' ' || sum(amount)::int::text FROM pg_temp.cash_entries WHERE reference_id='00000000-0000-0000-0000-000000000102'), '1 80'),
    ('Carla allocation', (SELECT sum(amount)::int::text FROM pg_temp.payment_allocations WHERE payment_id = new_payment), '80'),
    ('Carla audit log', (SELECT after_json->>'source' FROM pg_temp.audit_logs WHERE entity_id='00000000-0000-0000-0000-000000000102'), 'connect_auto_reconciliation'),
    ('low score stays pending',
      (SELECT status || ' ' || confidence_score::int::text FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000403'),
      'pending 70'),
    ('low score bank tx stays pending', (SELECT status FROM pg_temp.bank_transactions WHERE id='00000000-0000-0000-0000-000000000403'), 'pending'),
    ('sale paid elsewhere: match stays pending', (SELECT status FROM pg_temp.reconciliation_matches WHERE id='00000000-0000-0000-0000-000000000604'), 'pending'),
    ('sale paid elsewhere: no new payment', (SELECT count(*)::text FROM pg_temp.payments WHERE sale_id='00000000-0000-0000-0000-000000000104'), '0'),
    ('other store untouched', (SELECT status FROM pg_temp.reconciliation_matches WHERE id='00000000-0000-0000-0000-000000000606'), 'pending'),
    ('one notification', (SELECT count(*)::text || ' ' || min(title) FROM pg_temp.connect_notifications), '1 ⚡ 2 transação(ões) conciliada(s) automaticamente'),
    ('one system log', (SELECT count(*)::text || ' ' || min(log_type) FROM pg_temp.connect_system_logs), '1 match'),
    ('automation last run recorded', (SELECT (last_run_at IS NOT NULL)::text || ' ' || last_run_status FROM pg_temp.connect_automations), 'true success');

  -- Segunda execução não confirma nem notifica de novo.
  r := pg_temp._connect_run_matching_core('00000000-0000-0000-0000-000000000001');
  INSERT INTO auto_checks VALUES
    ('second run confirms nothing', r->'auto_confirm'->>'confirmed', '0'),
    ('second run no new notification', (SELECT count(*)::text FROM pg_temp.connect_notifications), '1'),
    ('second run no new payment', (SELECT count(*)::text FROM pg_temp.payments), '5');

  -- Automação desligada: o motor só sugere.
  UPDATE pg_temp.connect_automations SET is_active = false;
  INSERT INTO pg_temp.bank_transactions(id,store_id,amount,transaction_date,description,method,status,transaction_type) VALUES
  ('00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000001',45,'2026-10-12','PIX RECEBIDO','pix','pending','credit');
  r := pg_temp._connect_run_matching_core('00000000-0000-0000-0000-000000000001');
  INSERT INTO auto_checks VALUES
    ('disabled: suggestion created', r->>'matches_created', '1'),
    ('disabled: auto confirm off', r->'auto_confirm'->>'enabled', 'false'),
    ('disabled: match pending', (SELECT status FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000405'), 'pending');

  -- Execução manual pela tela (nota mínima informada) confirma mesmo desligada.
  r := pg_temp._connect_auto_confirm('00000000-0000-0000-0000-000000000001', 85);
  INSERT INTO auto_checks VALUES
    ('manual run confirms', r->>'confirmed', '1'),
    ('manual run match confirmed', (SELECT status FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000405'), 'confirmed');
END $$;

DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(label || ': expected=' || expected || ', got=' || coalesce(actual,'null'), E'\n') INTO failures
  FROM auto_checks WHERE actual IS DISTINCT FROM expected;
  IF failures IS NOT NULL THEN RAISE EXCEPTION 'Auto-confirm regressions:%', E'\n' || failures; END IF;
END $$;
ROLLBACK;
SELECT 'Auto-confirm regressions passed; all fixtures rolled back' AS result;
