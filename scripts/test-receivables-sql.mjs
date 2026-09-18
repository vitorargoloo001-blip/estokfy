import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
// Pass an installed @electric-sql/pglite dist/index.js path as the first argument.
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const store='00000000-0000-0000-0000-000000000001';
const sale='00000000-0000-0000-0000-000000000002';
const item='00000000-0000-0000-0000-000000000003';
await db.exec(`
CREATE TABLE sales(id uuid primary key,store_id uuid,deleted_at timestamptz,status text,payment_status text,amount_paid numeric,amount_pending numeric);
CREATE TABLE sale_items(id uuid primary key,sale_id uuid,line_total numeric);
CREATE TABLE payments(id uuid default gen_random_uuid() primary key,store_id uuid,sale_id uuid,method text,amount numeric,provider text,external_tx_id text,paid_at timestamptz,note text,created_by uuid);
CREATE TABLE payment_allocations(id uuid default gen_random_uuid(),store_id uuid,payment_id uuid,sale_id uuid,sale_item_id uuid,amount numeric);
CREATE TABLE cash_ledger(id uuid default gen_random_uuid(),store_id uuid,is_default boolean);
CREATE TABLE cash_entries(store_id uuid,ledger_id uuid,entry_type text,category text,amount numeric,payment_method text,reference_type text,reference_id uuid,description text,created_by uuid,occurred_at timestamptz);
CREATE TABLE audit_logs(store_id uuid,actor_profile_id uuid,action text,entity text,entity_id uuid,after_json jsonb);
CREATE FUNCTION require_active_profile() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION current_profile() RETURNS TABLE(store_id uuid,role text,profile_id uuid) LANGUAGE sql AS $$ SELECT '${store}'::uuid,coalesce(nullif(current_setting('test.role',true),''),'owner'),'${store}'::uuid $$;
INSERT INTO cash_ledger(store_id,is_default) VALUES ('${store}',true);
`);
const original=readFileSync('supabase/migrations/20260819040000_payment_allocations_por_item.sql','utf8');
const start=original.indexOf('CREATE OR REPLACE FUNCTION public._allocate_payment_fifo_within_sale(');
await db.exec(original.slice(start,original.indexOf('$function$;',start)+12));
await db.exec(readFileSync('supabase/migrations/20260918000001_receivables_payment_guards.sql','utf8'));
async function reset(pending=100,lineTotal=100) {
 await db.exec(`TRUNCATE sales,sale_items,payments,payment_allocations,cash_entries,audit_logs;
 INSERT INTO sales VALUES ('${sale}','${store}',NULL,'paid','pending',0,${pending});
 INSERT INTO sale_items VALUES ('${item}','${sale}',${lineTotal});
 INSERT INTO payments(store_id,sale_id,method,amount) VALUES ('${store}','${sale}','pending',${pending});
 SELECT set_config('test.role','owner',false);`);
}
const pay=(amount,method='pix',date='now()')=>db.query(`SELECT settle_sale_payment($1,$2::jsonb,${date}) result`,[sale,JSON.stringify([{method,amount}])]);
const byItem=(amount,items=[{sale_item_id:item,amount}])=>db.query('SELECT settle_sale_items_payment($1,$2::jsonb,$3) result',[sale,JSON.stringify(items),'pix']);
let tests=0;
async function test(name,fn){await reset();await fn();tests++;console.log('PASS '+name);}
async function rejected(fn,code){await assert.rejects(fn,new RegExp(code));const {rows}=await db.query("SELECT count(*)::int n FROM payments WHERE method <> 'pending'");assert.equal(rows[0].n,0);}
await test('partial and full settlement reconcile sale, allocations and cash',async()=>{
 await pay(30);let {rows}=await db.query('SELECT * FROM sales');assert.equal(Number(rows[0].amount_pending),70);assert.equal(rows[0].payment_status,'partial');
 await pay(70);({rows}=await db.query('SELECT * FROM sales'));assert.equal(rows[0].payment_status,'paid');assert.equal(Number(rows[0].amount_paid),100);
 for(const table of ['cash_entries','payment_allocations']) {const r=await db.query(`SELECT sum(amount) total FROM ${table}`);assert.equal(Number(r.rows[0].total),100);}
});
await test('one extra cent rolls back the entire payment',()=>rejected(()=>pay(100.01),'valor_maior_que_saldo_devedor'));
await test('fractional cents rejected',()=>rejected(()=>pay(0.001),'pagamento_invalido'));
await test('NaN rejected',()=>rejected(()=>pay('NaN'),'pagamento_invalido'));
await test('negative amount rejected',()=>rejected(()=>pay(-1),'pagamento_invalido'));
await test('unknown method rejected',()=>rejected(()=>pay(10,'fake'),'metodo_invalido'));
await test('future receipt rejected',()=>rejected(()=>pay(10,'pix',"now() + interval '2 days'"),'data_recebimento_invalida'));
await test('deleted sale rejected',async()=>{await db.exec('UPDATE sales SET deleted_at=now()');await rejected(()=>pay(10),'venda_nao_encontrada');});
await test('cancelled sale rejected',async()=>{await db.exec("UPDATE sales SET status='cancelled'");await rejected(()=>pay(10),'venda_nao_encontrada');});
await test('wrong tenant rejected',async()=>{await db.exec("UPDATE sales SET store_id=gen_random_uuid()");await rejected(()=>pay(10),'store_invalida');});
await test('viewer role rejected',async()=>{await db.exec("SELECT set_config('test.role','viewer',false)");await rejected(()=>pay(10),'sem_permissao_para_quitar');});
await test('item settlement reconciles exactly',async()=>{await byItem(100);const {rows}=await db.query('SELECT * FROM sales');assert.equal(rows[0].payment_status,'paid');assert.equal(Number(rows[0].amount_paid),100);});
await test('duplicate items rejected',()=>rejected(()=>byItem(50,[{sale_item_id:item,amount:50},{sale_item_id:item,amount:50}]),'item_duplicado'));
await test('item extra cent rejected',()=>rejected(()=>byItem(100.01),'valor_maior_que_saldo_devedor_do_item'));
await test('discount mismatch uses value settlement',async()=>{await reset(90,100);await rejected(()=>byItem(90),'saldo_itens_divergente');await pay(90);});
await test('freight mismatch uses value settlement',async()=>{await reset(110,100);await rejected(()=>byItem(100),'saldo_itens_divergente');await pay(110);});
await test('empty payments rejected',()=>rejected(()=>db.query('SELECT settle_sale_payment($1,$2::jsonb)',[sale,'[]']),'pagamento_invalido'));
await db.close();console.log(`${tests} SQL regression scenarios passed (isolated fixture; no production data).`);
