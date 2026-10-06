-- All fixtures and function copies live in pg_temp. No production rows or
-- function definitions are changed. The transaction is rolled back at the end.
BEGIN;
CREATE TEMP TABLE report_checks (label text, actual numeric, expected numeric);
DO $$
DECLARE t text; f record; definition text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales','sale_items','payments','cash_entries','returns','return_items','stock_movements','products','profiles','customers','bank_transactions','reconciliation_matches'] LOOP
    EXECUTE format('CREATE TEMP TABLE %I AS SELECT * FROM public.%I WITH NO DATA', t, t);
  END LOOP;
  FOR f IN SELECT oid, proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('get_financial_report_summary','obter_relatorio_operacional_v2','get_reconciliation_report','get_reconciliation_by_method','get_monthly_comparison') LOOP
    definition := pg_get_functiondef(f.oid);
    definition := replace(definition, 'public.' || f.proname, 'pg_temp.' || f.proname);
    definition := replace(definition, 'public.get_my_store_id', 'pg_temp.get_my_store_id');
    definition := replace(definition, 'SET search_path TO ''public''', 'SET search_path TO ''pg_temp'', ''public''');
    FOREACH t IN ARRAY ARRAY['sales','sale_items','payments','cash_entries','returns','return_items','stock_movements','products','profiles','customers','bank_transactions','reconciliation_matches'] LOOP
      definition := replace(definition, 'public.' || t, 'pg_temp.' || t);
    END LOOP;
    EXECUTE definition;
  END LOOP;
END $$;
CREATE FUNCTION pg_temp.get_my_store_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
-- CANDIDATE_FUNCTIONS
INSERT INTO pg_temp.profiles(id,store_id,auth_user_id,role,is_active,full_name) VALUES
('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','owner',true,'Vendedor');
INSERT INTO pg_temp.sales(id,store_id,sale_date,registered_at,created_at,status,payment_status,net_total,gross_total,amount_paid,amount_pending,created_by) VALUES
('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','2026-10-01','2026-10-01T16:00Z','2026-10-01T16:00Z','paid','partial',120,120,70,50,'00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','2026-09-01','2026-09-01T16:00Z','2026-09-01T16:00Z','paid','paid',30,30,30,0,'00000000-0000-0000-0000-000000000011');
INSERT INTO pg_temp.payments(id,store_id,sale_id,method,amount,paid_at,created_by) VALUES
('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','pix',70,'2026-10-02T01:00Z','00000000-0000-0000-0000-000000000012'),
('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','pending',50,'2026-10-01T16:00Z','00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','credit',10,'2026-10-01T16:00Z','00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','return_offset',5,'2026-10-01T16:00Z','00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000205','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102','cash',30,'2026-10-01T16:00Z','00000000-0000-0000-0000-000000000012');
INSERT INTO pg_temp.cash_entries(id,store_id,entry_type,category,amount,occurred_at,reference_type,created_by) VALUES
('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000001','expense','Compra',25,'2026-10-01T16:00Z','stock_purchase','00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000001','income','Manual',5,'2026-10-01T16:00Z','manual','00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000001','income','venda',100,'2026-10-01T16:00Z','sale','00000000-0000-0000-0000-000000000011');
INSERT INTO pg_temp.returns(id,store_id,status,created_at,created_by) VALUES
('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000001','completed','2026-10-01T16:00Z','00000000-0000-0000-0000-000000000011'),
('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000001','cancelled','2026-10-01T16:00Z','00000000-0000-0000-0000-000000000011');
INSERT INTO pg_temp.return_items(return_id,refund_amount) VALUES
('00000000-0000-0000-0000-000000000401',20),('00000000-0000-0000-0000-000000000402',100);
DO $$
DECLARE f jsonb; v jsonb; seller_f jsonb;
BEGIN
  f := pg_temp.get_financial_report_summary('00000000-0000-0000-0000-000000000001','2026-10-01','2026-10-02',null);
  v := pg_temp.obter_relatorio_operacional_v2('00000000-0000-0000-0000-000000000001','2026-10-01','2026-10-02',null,null,null);
  seller_f := pg_temp.get_financial_report_summary('00000000-0000-0000-0000-000000000001','2026-10-01','2026-10-02','00000000-0000-0000-0000-000000000011');
  INSERT INTO report_checks VALUES
    ('financial receipts exclude noncash', (f#>>'{received,total}')::numeric,100),
    ('operational receipts exclude noncash', (v#>>'{recebido,total}')::numeric,100),
    ('seller includes payments taken by another cashier', (seller_f#>>'{received,total}')::numeric,100),
    ('cancelled returns excluded', (f#>>'{returns,refund_total}')::numeric,20),
    ('cash uses actual outflows only', (f->>'net_cash')::numeric,80),
    ('operational cash agrees', (v#>>'{caixa,saldo}')::numeric,80),
    ('receipts group by BR day', (v#>>'{recebido,por_dia,0,total}')::numeric,100),
    ('all ignored settlement methods are audited', (f#>>'{received,ignored_count}')::numeric,3);
END $$;
INSERT INTO pg_temp.bank_transactions(id,store_id,transaction_date,transaction_type,amount,status,method) VALUES
('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000001',(now() AT TIME ZONE 'America/Sao_Paulo')::date,'credit',100,'reconciled','pix'),
('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000001',(now() AT TIME ZONE 'America/Sao_Paulo')::date,'credit',50,'pending','pix'),
('00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000001',(now() AT TIME ZONE 'America/Sao_Paulo')::date,'debit',40,'reconciled','pix');
INSERT INTO pg_temp.reconciliation_matches(id,bank_transaction_id,status,confirmed_at) VALUES
('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000501','confirmed',now()),
('00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000501','confirmed',now());
DO $$
DECLARE r jsonb; m record; comparison jsonb; d date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  r := pg_temp.get_reconciliation_report('00000000-0000-0000-0000-000000000001',d,d);
  SELECT * INTO m FROM pg_temp.get_reconciliation_by_method('00000000-0000-0000-0000-000000000001',d,d);
  comparison := pg_temp.get_monthly_comparison('00000000-0000-0000-0000-000000000001');
  INSERT INTO report_checks VALUES
    ('bank summary has each transaction once', jsonb_array_length(r->'transactions'),3),
    ('bank method values exclude debits like summary',m.total_amount,150),
    ('bank method rate uses incoming transactions',m.reconciliation_rate,50),
    ('monthly amount excludes debits', (comparison->>'current_month_total')::numeric,150);
END $$;
DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(label || ': expected=' || expected || ', got=' || coalesce(actual::text,'null'), E'\n') INTO failures
  FROM report_checks WHERE actual IS DISTINCT FROM expected;
  IF failures IS NOT NULL THEN RAISE EXCEPTION 'Reporting regressions:%', E'\n' || failures; END IF;
END $$;
ROLLBACK;
SELECT 'Reporting regressions passed; all fixtures rolled back' AS result;
