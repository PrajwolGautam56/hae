import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import ts from'typescript';import{randomUUID}from'node:crypto';
const compile=async file=>ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const modelUrl=url(await compile('lib/manual-stock.ts')),{manualStockInput}=await import(modelUrl);
const{matchingProducts}=await import(url(await compile('lib/product-search.ts')));
const{readStockRequest,stockRequestKey}=await import(url((await compile('lib/manual-stock-request.ts')).replace('"./manual-stock"',JSON.stringify(modelUrl))));
const c='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',fy='20000000-0000-4000-8000-000000000001',foreignFy='20000000-0000-4000-8000-000000000002',actor='30000000-0000-4000-8000-000000000001',foreignActor='30000000-0000-4000-8000-000000000002',staff='30000000-0000-4000-8000-000000000003',product='40000000-0000-4000-8000-000000000001',foreignProduct='40000000-0000-4000-8000-000000000002';
test('product typing matches whole names, words and SKU, including newly imported zero-stock items',()=>{
 const rows=[{id:'a',name:'Loaded Gear Oil - 20 Ltr',sku:'GEAR20',stock_qty:0},{id:'b',name:'Loaded Grease - 20 Kg',sku:'GR20'},{id:'c',name:'Ruchira A4 Paper - 70 GSM',sku:'P70'}];
 assert.equal(matchingProducts(rows,'gear 20')[0].id,'a');assert.equal(matchingProducts(rows,'a4 70')[0].id,'c');assert.equal(matchingProducts(rows,'P70')[0].id,'c');assert.equal(matchingProducts(rows,'gear20')[0].stock_qty,0);assert.equal(matchingProducts(rows,'unmatched').length,0);assert.equal(matchingProducts(rows,'',2).length,2);
 assert.equal(matchingProducts([{id:'gl1',name:'Loaded Gear Base API GL-1 - 20 Ltr'},{id:'gl3',name:'Loaded Gear Plus API GL-3 - 1 Ltr'}],'GL1 20L')[0].id,'gl1');
});
test('manual stock validation preserves counted zero and enforces precision, dates and reasons',()=>{
 const input={productId:product,fiscalYearId:fy,requestId:randomUUID(),mode:'add',quantity:'1.125',expectedStock:10,expectedCost:100,reason:'Physical stock found',date:'2026-11-26'};
 assert.equal(manualStockInput(input).quantity,1.125);assert.equal(manualStockInput({...input,mode:'count',quantity:'0'}).quantity,0);
 for(const patch of[{quantity:''},{quantity:-1},{quantity:1.0001},{quantity:Infinity},{quantity:0},{expectedCost:null},{reason:' '},{date:'2026-02-30'},{productId:foreignProduct+'bad'}])assert.throws(()=>manualStockInput({...input,...patch}));
 const body={...input,companyId:c},pending={id:input.requestId,body};delete body.requestId;const key=stockRequestKey(c,product,fy),storage={getItem:()=>JSON.stringify(pending)};
 assert.equal(readStockRequest(storage,key,{companyId:c,productId:product,fiscalYearId:fy}).id,input.requestId);assert.throws(()=>readStockRequest(storage,key,{companyId:other,productId:product,fiscalYearId:fy}),/different company/);
});
test('Postgres: manual adjustments are atomic, valued with existing cost, audited, replay-safe and isolated',{skip:!process.env.PGLITE_MODULE},async()=>{
 const{PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table companies(id uuid primary key,active boolean default true);
 create table fiscal_years(id uuid primary key,company_id uuid,start_ad date,end_ad date,status text,unique(company_id,id));
 create table team_members(id uuid primary key,company_id uuid,role text,active boolean default true,unique(company_id,id));
 create table products(id uuid primary key,company_id uuid,name text,stock_qty numeric,purchase_price numeric,item_type text default 'resale_good',active boolean default true,unique(company_id,id));
 create table voucher_sequences(fiscal_year_id uuid,voucher_type text,last_number int,primary key(fiscal_year_id,voucher_type));
 create table vouchers(id uuid primary key default gen_random_uuid(),company_id uuid,fiscal_year_id uuid,voucher_type text,voucher_no text,sequence_no int,voucher_date date,narration text,total numeric,generated_by uuid,handled_by uuid,unique(company_id,id));
 create table voucher_lines(voucher_id uuid,product_id uuid,description text,quantity numeric,rate numeric,amount numeric,inventory_item boolean);
 create table accounts(id uuid primary key default gen_random_uuid(),company_id uuid,system_key text);
 create table journal_entries(id uuid primary key default gen_random_uuid(),company_id uuid,fiscal_year_id uuid,voucher_id uuid,entry_date date,reference text,description text,source_type text);
 create table journal_lines(journal_entry_id uuid,company_id uuid,account_id uuid not null,description text,debit numeric,credit numeric);
 create table stock_adjustment_details(voucher_id uuid,product_id uuid,quantity_delta numeric,unit_cost numeric,reason text);
 create table stock_movements(company_id uuid,product_id uuid,voucher_id uuid,movement_date date,quantity numeric,movement_type text,unit_cost numeric,notes text);
 create table ledger_entries(debit numeric,credit numeric);insert into ledger_entries values(500,0);
 insert into companies(id)values('${c}'),('${other}');
 insert into fiscal_years values('${fy}','${c}','2026-07-17','2027-07-16','open'),('${foreignFy}','${other}','2026-07-17','2027-07-16','open');
 insert into team_members(id,company_id,role)values('${actor}','${c}','admin'),('${foreignActor}','${other}','admin'),('${staff}','${c}','staff');
 insert into products(id,company_id,name,stock_qty,purchase_price)values('${product}','${c}','Gear Oil 20 Ltr',10,100),('${foreignProduct}','${other}','Private product',25,50);
 insert into accounts(company_id,system_key)values('${c}','finished_inventory'),('${c}','inventory_adjustment');`);
 const suite=await readFile('supabase/migrations/202609040001_accounting_operations_suite.sql','utf8');await db.exec(suite.slice(suite.indexOf('create or replace function public.record_stock_adjustment('),suite.indexOf('create or replace function public.record_payroll_run(')));
 await db.exec(await readFile('supabase/migrations/202611260001_manual_stock_adjustments.sql','utf8'));
 const call=async({id=randomUUID(),owner=c,year=fy,item=product,member=actor,mode='add',qty=5,expected=10,cost=100,reason='Stock found without purchase document',date='2026-11-26'}={})=>(await db.query('select record_manual_stock_adjustment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as v',[owner,year,item,member,id,date,mode,qty,expected,cost,reason])).rows[0].v;
 const key=randomUUID(),saved=await call({id:key});assert.equal(saved.stockBefore,10);assert.equal(saved.stockAfter,15);assert.equal(saved.source,'manual');assert.equal((await call({id:key})).duplicate,true);
 await assert.rejects(call({id:key,qty:6}),/different values/);await assert.rejects(call({expected:10}),/changed/);await assert.rejects(call({expected:15,cost:99}),/changed/);
 for(const patch of[{item:foreignProduct,expected:25,cost:50},{year:foreignFy},{member:foreignActor},{member:staff},{date:'2027-08-01'},{expected:15,mode:'remove',qty:16},{expected:15,qty:0}])await assert.rejects(call(patch));
 assert.equal((await db.query('select count(*)::int n from vouchers')).rows[0].n,1);assert.equal(Number((await db.query('select sum(debit)-sum(credit) as difference from journal_lines')).rows[0].difference),0);assert.equal((await db.query('select * from stock_adjustment_details')).rows[0].quantity_delta,'5');assert.match((await db.query('select notes from stock_movements')).rows[0].notes,/not a purchase/);
 const shared=randomUUID(),replayed=await Promise.all([call({id:shared,expected:15,qty:2}),call({id:shared,expected:15,qty:2})]);assert.equal(replayed.filter(result=>result.duplicate).length,1);assert.equal((await db.query('select stock_qty from products where id=$1',[product])).rows[0].stock_qty,'17');
 await call({expected:17,mode:'count',qty:0});assert.equal((await db.query('select stock_qty from products where id=$1',[product])).rows[0].stock_qty,'0');
 await db.query('update products set purchase_price=0 where id=$1',[product]);const zero=await call({expected:0,cost:0,qty:3});assert.equal(zero.total,0);assert.equal((await db.query('select count(*)::int n from journal_lines where journal_entry_id=(select id from journal_entries where voucher_id=$1)',[zero.id])).rows[0].n,0);
 await db.exec("alter table stock_movements add constraint qa_stock_limit check(quantity<100)");await assert.rejects(call({expected:3,cost:0,qty:100}),/qa_stock_limit/);assert.equal((await db.query('select stock_qty from products where id=$1',[product])).rows[0].stock_qty,'3');
 assert.equal((await db.query('select count(*)::int n from ledger_entries')).rows[0].n,1);assert.equal((await db.query("select count(*)::int n from vouchers where voucher_type='purchase'")).rows[0].n,0);
 const privileges=(await db.query("select has_table_privilege('anon','manual_stock_requests','SELECT') a,has_table_privilege('service_role','manual_stock_requests','UPDATE') u,has_function_privilege('authenticated','record_manual_stock_adjustment(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric,text)','EXECUTE') f")).rows[0];assert.deepEqual(privileges,{a:false,u:false,f:false});
 }finally{await db.close();}
});
