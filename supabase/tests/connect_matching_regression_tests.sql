-- Conciliação (_connect_run_matching_core): vínculo exato do Pix do Estokfy
-- e desempate pelo nome do pagador. Migration 20261030000001.
-- All fixtures and the function copy live in pg_temp. No production rows or
-- function definitions are changed. The transaction is rolled back at the end.
BEGIN;
CREATE TEMP TABLE matching_checks (label text, actual text, expected text);
DO $$
DECLARE t text; definition text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales','payments','customers','bank_transactions','reconciliation_matches','mercadopago_pix_charges'] LOOP
    EXECUTE format('CREATE TEMP TABLE %I AS SELECT * FROM public.%I WITH NO DATA', t, t);
  END LOOP;
  definition := pg_get_functiondef('public._connect_run_matching_core(uuid)'::regprocedure);
  definition := replace(definition, 'public._connect_run_matching_core', 'pg_temp._connect_run_matching_core');
  FOREACH t IN ARRAY ARRAY['sales','payments','customers','bank_transactions','reconciliation_matches','mercadopago_pix_charges'] LOOP
    definition := replace(definition, 'public.' || t, 'pg_temp.' || t);
  END LOOP;
  EXECUTE definition;
END $$;

INSERT INTO pg_temp.customers(id,store_id,name) VALUES
('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','João Silva'),
('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','Maria Souza');
INSERT INTO pg_temp.sales(id,store_id,customer_id,status,payment_status,deleted_at) VALUES
('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000021','paid','paid',null),
('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000022','paid','paid',null),
('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000022','paid','paid',null),
('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000001',null,'paid','paid',null);
-- 201/202: mesmo valor no mesmo período. A da Maria está mais perto da data,
-- então sem o desempate por nome o Pix do João cairia nela.
-- 203: Pix do Estokfy (cobrança 301). 204: Pix avulso de mesmo valor, mais longe da data.
INSERT INTO pg_temp.payments(id,store_id,sale_id,method,amount,paid_at,provider,idempotency_key) VALUES
('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','pix',30,'2026-10-11T15:00Z',null,null),
('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102','pix',30,'2026-10-10T15:00Z',null,null),
('00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000103','pix',50,'2026-10-10T15:00Z','mercadopago','mercadopago:PAY01TESTE'),
('00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000104','pix',50,'2026-10-12T15:00Z',null,null);
INSERT INTO pg_temp.mercadopago_pix_charges(id,store_id,sale_id,amount,status,mp_payment_id) VALUES
('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000103',50,'paid','PAY01TESTE');
-- 401 vem antes de 402 na ordem de id; 403 (Pix avulso) antes de 404 (Pix do Estokfy).
INSERT INTO pg_temp.bank_transactions(id,store_id,amount,transaction_date,description,payer_name,external_reference,status,transaction_type) VALUES
('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000001',30,'2026-10-10','PIX RECEBIDO JOAO SILVA',null,null,'pending','credit'),
('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000001',30,'2026-10-10','Mercado Pago · MARIA S SOUZA · Pix','MARIA S SOUZA',null,'pending','credit'),
('00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000001',50,'2026-10-10','Mercado Pago · pagador não identificado · Pix',null,null,'pending','credit'),
('00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000001',50,'2026-10-11','Mercado Pago · Maria Souza · Pix','Maria Souza','00000000-0000-0000-0000-000000000301','pending','credit'),
('00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000001',77,'2026-10-10','PIX RECEBIDO FULANO',null,null,'pending','credit');

DO $$
DECLARE r jsonb;
BEGIN
  r := pg_temp._connect_run_matching_core('00000000-0000-0000-0000-000000000001');
  INSERT INTO matching_checks VALUES
    ('matches created', r->>'matches_created', '4'),
    ('no match', r->>'no_match', '1'),
    ('João goes to João despite closer date of Maria',
      (SELECT payment_id::text FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000401'),
      '00000000-0000-0000-0000-000000000201'),
    ('reason says the name matches',
      (SELECT (match_reason LIKE '%nome do pagador confere%')::text FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000401'),
      'true'),
    ('Maria goes to Maria',
      (SELECT payment_id::text FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000402'),
      '00000000-0000-0000-0000-000000000202'),
    ('Estokfy Pix links to its own payment',
      (SELECT payment_id::text FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000404'),
      '00000000-0000-0000-0000-000000000203'),
    ('Estokfy Pix scores 100',
      (SELECT confidence_score::int::text || ' ' || match_type FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000404'),
      '100 deterministic'),
    ('loose Pix does not take the Estokfy Pix payment',
      (SELECT payment_id::text FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000403'),
      '00000000-0000-0000-0000-000000000204'),
    ('reason without name match stays as before',
      (SELECT match_reason FROM pg_temp.reconciliation_matches WHERE bank_transaction_id='00000000-0000-0000-0000-000000000403'),
      'Valor exato e data correspondente');

  -- Segunda execução não duplica nada.
  r := pg_temp._connect_run_matching_core('00000000-0000-0000-0000-000000000001');
  INSERT INTO matching_checks VALUES
    ('second run creates nothing', r->>'matches_created', '0'),
    ('second run total matches', (SELECT count(*)::text FROM pg_temp.reconciliation_matches), '4');

  INSERT INTO matching_checks VALUES
    ('name: initial in the middle', public._connect_payer_matches_customer('MARIA S SOUZA','Maria Souza')::text, 'true'),
    ('name: accents and case', public._connect_payer_matches_customer('JOSE ALVES','José Alves')::text, 'true'),
    ('name: part of another word', public._connect_payer_matches_customer('Mariana Souza','Ana Souza')::text, 'false'),
    ('name: only first name equal', public._connect_payer_matches_customer('Maria Lima','Maria Souza')::text, 'false'),
    ('name: unidentified payer', public._connect_payer_matches_customer('Mercado Pago · pagador não identificado · Pix','Ana')::text, 'false'),
    ('name: null payer', public._connect_payer_matches_customer(null,'Ana Souza')::text, 'false'),
    ('name: null customer', public._connect_payer_matches_customer('Ana Souza',null)::text, 'false'),
    ('name: too short first name', public._connect_payer_matches_customer('Jo Silva','Jo Silva')::text, 'false');
END $$;

DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(label || ': expected=' || expected || ', got=' || coalesce(actual,'null'), E'\n') INTO failures
  FROM matching_checks WHERE actual IS DISTINCT FROM expected;
  IF failures IS NOT NULL THEN RAISE EXCEPTION 'Matching regressions:%', E'\n' || failures; END IF;
END $$;
ROLLBACK;
SELECT 'Matching regressions passed; all fixtures rolled back' AS result;
