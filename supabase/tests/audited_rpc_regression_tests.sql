-- Exercise the repaired RPCs with a temporary tenant and roll everything back.
BEGIN;
DO $test$
DECLARE
 v_store uuid:=gen_random_uuid(); v_user uuid:=gen_random_uuid(); v_profile uuid:=gen_random_uuid();
 v_customer uuid:=gen_random_uuid(); v_product uuid:=gen_random_uuid(); v_sale uuid:=gen_random_uuid();
 v_ledger uuid:=gen_random_uuid(); v_tx uuid:=gen_random_uuid(); v_match uuid:=gen_random_uuid();
 v_bank uuid; v_row record; v_json jsonb; v_count integer;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(v_user,'regression-'||v_user::text||'@example.invalid');
 INSERT INTO stores(id,name,trade_name,access_enabled) VALUES(v_store,'Regression RPC','Regression RPC',true);
 INSERT INTO profiles(id,auth_user_id,store_id,role,full_name,is_active) VALUES(v_profile,v_user,v_store,'owner','Regression',true);
 INSERT INTO customers(id,store_id,name) VALUES(v_customer,v_store,'Regression');
 INSERT INTO products(id,store_id,name,sku,on_hand,cost_price,sale_price,is_active) VALUES(v_product,v_store,'Regression','RPC-TEST',100,10,50,true);
 INSERT INTO cash_ledger(id,store_id,name,is_default) VALUES(v_ledger,v_store,'Regression',true);
 INSERT INTO sales(id,store_id,customer_id,status,gross_total,discount_total,shipping_fee,net_total,cost_total,profit_gross,created_by,payment_status,amount_paid,amount_pending)
 VALUES(v_sale,v_store,v_customer,'paid',50,0,0,50,10,40,v_profile,'pending',0,50);
 INSERT INTO sale_items(sale_id,product_id,qty,unit_price,unit_cost,line_total) VALUES(v_sale,v_product,1,50,10,50);
 INSERT INTO payments(store_id,sale_id,method,amount) VALUES(v_store,v_sale,'pending',50);
 PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

 v_json:=ai_get_customer_summary(v_store); IF jsonb_array_length(v_json->'top_clientes')<>1 THEN RAISE EXCEPTION 'Customer ranking incorrect'; END IF;
 v_json:=ai_get_employee_summary(v_store); IF jsonb_array_length(v_json->'ranking')<>1 THEN RAISE EXCEPTION 'Employee ranking incorrect'; END IF;
 PERFORM ai_get_sales_summary(v_store); PERFORM ai_get_inventory_summary(v_store); PERFORM ai_get_business_health_score(v_store);
 PERFORM generate_ai_insights(v_store); PERFORM trigger_ai_automations(v_store);
 v_json:=get_executive_finance_dashboard(v_store); IF (v_json->>'recebido_mes')::numeric<>0 THEN RAISE EXCEPTION 'Pending placeholder counted as receipt'; END IF;
 PERFORM get_finance_goals_progress(v_store,extract(month from now())::int,extract(year from now())::int);

 SELECT * INTO v_row FROM create_bank_connection(v_store,'Regression','1','1','checking');
 IF NOT v_row.success THEN RAISE EXCEPTION 'Cannot create bank: %',v_row.message; END IF; v_bank:=v_row.id;
 INSERT INTO bank_transactions(id,store_id,bank_connection_id,transaction_date,amount,transaction_type,status,method,bank_name)
 VALUES(v_tx,v_store,v_bank,current_date,50,'credit','pending','pix','Regression');
 INSERT INTO reconciliation_matches(id,store_id,bank_transaction_id,sale_id,match_type,confidence_score,status)
 VALUES(v_match,v_store,v_tx,v_sale,'manual',100,'pending');
 PERFORM get_pending_matches_by_confidence(v_store);
 SELECT * INTO v_row FROM add_reconciliation_note(v_match,'Regression note'); IF NOT v_row.success THEN RAISE EXCEPTION 'note failed'; END IF;
 SELECT * INTO v_row FROM bulk_confirm_reconciliation(v_store,ARRAY[v_match]);
 IF v_row.confirmed_count<>1 THEN RAISE EXCEPTION 'bulk confirmation failed %',v_row; END IF;
 IF (SELECT amount_pending FROM sales WHERE id=v_sale)<>0 THEN RAISE EXCEPTION 'Bulk did not settle'; END IF;
 SELECT * INTO v_row FROM bulk_confirm_reconciliation(v_store,ARRAY[v_match]);
 IF v_row.confirmed_count<>0 THEN RAISE EXCEPTION 'Bulk repeated receipt'; END IF;
 IF (SELECT sum(amount) FROM payments WHERE sale_id=v_sale AND method<>'pending')<>50 THEN RAISE EXCEPTION 'Duplicate receipt'; END IF;
 SELECT sum(confirmed_in) INTO v_count FROM get_professional_cashflow(v_store);
 IF v_count<>50 THEN RAISE EXCEPTION 'Cashflow double-counted: %',v_count; END IF;
 SELECT * INTO v_row FROM undo_reconciliation(v_match); IF NOT v_row.success THEN RAISE EXCEPTION 'undo failed'; END IF;
 SELECT * INTO v_row FROM ignore_reconciliation(v_match); IF NOT v_row.success THEN RAISE EXCEPTION 'ignore failed'; END IF;
 SELECT * INTO v_row FROM reopen_reconciliation(v_match); IF NOT v_row.success THEN RAISE EXCEPTION 'reopen failed'; END IF;
 SELECT * INTO v_row FROM resolve_divergence_link(v_tx,gen_random_uuid()); IF v_row.success THEN RAISE EXCEPTION 'Invalid tenant sale accepted'; END IF;
 SELECT * INTO v_row FROM classify_divergence(v_tx,'amount_different','Regression'); IF NOT v_row.success THEN RAISE EXCEPTION 'classify failed'; END IF;
 SELECT * INTO v_row FROM ignore_divergence(v_tx,'Regression'); IF NOT v_row.success THEN RAISE EXCEPTION 'ignore divergence failed'; END IF;
 SELECT * INTO v_row FROM resolve_divergence_link(v_tx,v_sale); IF NOT v_row.success THEN RAISE EXCEPTION 'resolve failed'; END IF;
 IF (SELECT amount_pending FROM sales WHERE id=v_sale)<>0 THEN RAISE EXCEPTION 'Reconciliation reopened debt'; END IF;

 -- Missing parent conflict index must not prevent registering the same account twice.
 PERFORM register_pluggy_item_auth(v_store,'regression-item','Regression',null,null,'[{"id":"regression-account","type":"BANK"}]'::jsonb);
 PERFORM register_pluggy_item_auth(v_store,'regression-item','Regression',null,null,'[{"id":"regression-account","type":"BANK"}]'::jsonb);
 IF (SELECT count(*) FROM bank_connections WHERE store_id=v_store AND pluggy_account_id='regression-account')<>1 THEN RAISE EXCEPTION 'Duplicate bank account'; END IF;
END;
$test$;
ROLLBACK;
