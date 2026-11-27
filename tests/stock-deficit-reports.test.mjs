import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile=async path=>ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const modelUrl=url(await compile('lib/stock-reports.ts'));
const {stockReport,salesStockDeficits}=await import(modelUrl);

test('zero-stock and repeated invoice lines warn but remain selectable, with the full deficit',()=>{
 assert.deepEqual(salesStockDeficits([{id:'oil',name:'Oil',unit:'L',stock_qty:0}],[{productId:'oil',quantity:2},{productId:'oil',quantity:3}]),[{id:'oil',name:'Oil',unit:'L',after:-5}]);
 assert.equal(salesStockDeficits([{id:'oil',stock_qty:10}],[{productId:'oil',quantity:5}]).length,0);
});
test('stock reports preserve opening/closing while filtering staff/sources; quantities are grouped by unit',()=>{
 const snapshot={products:[{id:'a',name:'Oil',unit:'L',stock_qty:-2,purchase_price:100},{id:'b',name:'Buckets',unit:'pcs',stock_qty:10,purchase_price:20}],future:[{product_id:'a',quantity:3}],movements:[
 {id:'1',product_id:'a',quantity:-10,voucher_type:'sale',actor_id:'seller',actor_name:'Seller'},
 {id:'2',product_id:'a',quantity:5,voucher_type:'stock_adjustment',actor_id:'admin',actor_name:'Admin',manual_request_id:'request'},
 {id:'3',product_id:'b',quantity:2,voucher_type:'purchase'}]};
 const statement=stockReport(snapshot,'stock_statement');assert.equal(statement.rows[0].opening,0);assert.equal(statement.rows[0].closing,-5);assert.equal(statement.rows[0].manualIn,5);assert.equal(statement.rows[1].opening,8);
 assert.deepEqual(statement.unitTotals.map(row=>row.unit),['L','pcs']);
 const filtered=stockReport(snapshot,'stock_movement',{actorId:'admin',source:'manual'});assert.equal(filtered.rows.length,1);assert.equal(filtered.rows[0].opening,-10);assert.equal(filtered.rows[0].balance,-5);assert.equal(filtered.rows[0].actorName,'Admin');assert.equal(filtered.filteredMovements,true);
 assert.equal(stockReport(snapshot,'stock_statement',{itemType:'raw_material'}).rows.length,0);
 assert.throws(()=>stockReport(snapshot,'stock_statement',{productId:'foreign'}),/does not belong/);
});

test('Postgres: deficit sales, edits, cancellation, partial audited replenishment, monthly/FY history and isolation',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
 const c='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',fy='20000000-0000-4000-8000-000000000001',actor='30000000-0000-4000-8000-000000000001',accountant='30000000-0000-4000-8000-000000000002',product='40000000-0000-4000-8000-000000000001',foreign='40000000-0000-4000-8000-000000000002',party='50000000-0000-4000-8000-000000000001';
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table companies(id uuid primary key,active boolean default true);
 create table fiscal_years(id uuid primary key,company_id uuid,start_ad date,end_ad date,status text,unique(company_id,id));
 create table parties(id uuid primary key,company_id uuid);
 create table team_members(id uuid primary key,company_id uuid,name text,role text,active boolean default true,unique(company_id,id));
 create table products(id uuid primary key default gen_random_uuid(),company_id uuid,name text,sku text,unit text default 'L',stock_qty numeric,purchase_price numeric,sale_price numeric default 100,mrp numeric default 0,low_stock_at numeric default 0,item_type text default 'resale_good',active boolean default true,created_at timestamptz default now(),unique(company_id,id),unique(company_id,name));
 create table vouchers(id uuid primary key default gen_random_uuid(),company_id uuid,fiscal_year_id uuid,party_id uuid,voucher_type text,voucher_no text,sequence_no int,voucher_date date,narration text,total numeric,subtotal numeric,discount_percent numeric,discount_amount numeric,tax_percent numeric,tax_amount numeric,bill_category text default 'unclassified',supplier_bill_no text,due_date date,generated_by uuid,handled_by uuid,document_status text default 'posted',source_voucher_id uuid,unique(company_id,id));
 create unique index vouchers_fy_type_sequence_unique on vouchers(fiscal_year_id,voucher_type,sequence_no);
 create table voucher_sequences(fiscal_year_id uuid,voucher_type text,last_number int,primary key(fiscal_year_id,voucher_type));
 create table voucher_lines(id uuid primary key default gen_random_uuid(),voucher_id uuid,product_id uuid,description text,quantity numeric,rate numeric,amount numeric,inventory_item boolean);
 create table accounts(id uuid primary key default gen_random_uuid(),company_id uuid,system_key text);
 create table journal_entries(id uuid primary key default gen_random_uuid(),company_id uuid,fiscal_year_id uuid,voucher_id uuid,entry_date date,reference text,description text,source_type text);
 create table journal_lines(journal_entry_id uuid,company_id uuid,account_id uuid not null,description text,debit numeric,credit numeric);
 create table stock_adjustment_details(voucher_id uuid,product_id uuid,quantity_delta numeric,unit_cost numeric,reason text);
 create table production_batches(id uuid primary key,company_id uuid,batch_no text);
 create table stock_movements(id uuid primary key default gen_random_uuid(),company_id uuid,product_id uuid,voucher_id uuid,production_batch_id uuid,movement_date date,quantity numeric,movement_type text,unit_cost numeric,notes text,created_at timestamptz default now());
 create table ledger_entries(company_id uuid,party_id uuid,voucher_id uuid,entry_date date,account_name text,debit numeric,credit numeric);
 create table voucher_audit_logs(voucher_id uuid,action text default 'edit',before_data jsonb);
 create function prevent_negative_stock() returns trigger language plpgsql as $$begin if new.stock_qty<0 then raise exception 'Insufficient stock';end if;return new;end$$;
 create trigger stock_nonnegative_guard before update of stock_qty on products for each row execute function prevent_negative_stock();
 insert into companies(id)values('${c}'),('${other}');
 insert into fiscal_years values('${fy}','${c}','2026-07-17','2027-07-16','open');
 insert into parties values('${party}','${c}');
 insert into team_members(id,company_id,name,role)values('${actor}','${c}','First Admin','admin'),('${accountant}','${c}','Stock Accountant','accountant');
 insert into products(id,company_id,name,stock_qty,purchase_price)values('${product}','${c}','Gear Oil',0,50),('${foreign}','${other}','Private product',30,50);
 insert into accounts(company_id,system_key)values('${c}','finished_inventory'),('${c}','inventory_adjustment');`);
 const suite=await readFile('supabase/migrations/202609040001_accounting_operations_suite.sql','utf8');await db.exec(suite.slice(suite.indexOf('create or replace function public.record_stock_adjustment('),suite.indexOf('create or replace function public.record_payroll_run(')));
 await db.exec(await readFile('supabase/migrations/202611080001_cancelled_sales_invoices.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/202611080003_non_vat_invoice_series.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/202611260001_manual_stock_adjustments.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/202611270001_sales_deficit_stock_reports.sql','utf8'));
 const stock=async()=>Number((await db.query('select stock_qty from products where id=$1',[product])).rows[0].stock_qty);
 const line=(qty,item=product)=>({product_id:item,name:'Gear Oil',quantity:qty,rate:100});
 const sale=async(category,lines,id=null)=>(await db.query('select record_classified_invoice($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) value',[c,fy,party,'2026-08-01',lines,'sale',category,0,category==='vat'?13:0,'Sale',null,'',actor,id])).rows[0].value;
 const vat=await sale('vat',[line(5)]);assert.equal(await stock(),-5);assert.equal(vat.voucher_no,'1');assert.equal(Number((await db.query('select debit from ledger_entries where voucher_id=$1',[vat.id])).rows[0].debit),565);
 const nb=await sale('non_vat',[line(2),line(3)]);assert.equal(await stock(),-10);assert.equal(nb.voucher_no,'NB 1');
 await sale('vat',[line(8)],vat.id);assert.equal(await stock(),-13);assert.equal((await db.query('select count(*)::int n from voucher_audit_logs')).rows[0].n,1);
 await assert.rejects(sale('vat',[line(1,foreign)]),/invalid/);await assert.rejects(sale('vat',[line('NaN')]),/Invalid/);assert.equal(await stock(),-13);
 const adjust=async(qty,expected,mode='add',member=actor,id=randomUUID())=>(await db.query('select record_manual_stock_adjustment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',[c,fy,product,member,id,'2026-11-26',mode,qty,expected,50,'Physical stock reconciliation'])).rows[0].value;
 const requestId=randomUUID(),partial=await adjust(4,-13,'add',actor,requestId);assert.equal(partial.stockAfter,-9);assert.equal((await adjust(4,-13,'add',actor,requestId)).duplicate,true);assert.equal(await stock(),-9);
 await assert.rejects(adjust(1,-9,'remove'),/negative/);await adjust(9,-9);assert.equal(await stock(),0);await adjust(5,0);await adjust(2,5,'remove',accountant);assert.equal(await stock(),3);
 const audit=(await db.query('select result,actor_id from manual_stock_requests order by created_at')).rows;assert.equal(audit.length,4);assert.equal(audit.at(-1).actor_id,accountant);assert.equal(audit.at(-1).result.quantityDelta,-2);
 assert.equal(Number((await db.query('select sum(debit)-sum(credit) difference from journal_lines')).rows[0].difference),0);
 await db.query('select record_cancelled_sales_invoice($1,$2,$3,$4,$5,$6)',[c,fy,actor,'2026-08-01','Correction',vat.id]);assert.equal(await stock(),11);
 await db.query('update products set stock_qty=stock_qty+2 where id=$1',[product]);await db.query("insert into stock_movements(company_id,product_id,movement_date,quantity,movement_type) values($1,$2,'2027-01-01',2,'in')",[c,product]);
 const snapshot=async(from,to)=>(await db.query('select stock_report_snapshot($1,$2,$3) value',[c,from,to])).rows[0].value;
 let data=await snapshot('2026-11-01','2026-11-30'),report=stockReport(data,'stock_statement');assert.equal(data.products.length,1);assert.equal(report.rows[0].opening,-5);assert.equal(report.rows[0].manualIn,18);assert.equal(report.rows[0].manualOut,2);assert.equal(report.rows[0].closing,11);
 const removed=stockReport(data,'stock_movement',{source:'manual',actorId:accountant});assert.equal(removed.rows.length,1);assert.equal(removed.rows[0].actorName,'Stock Accountant');assert.equal(removed.rows[0].outward,2);assert.equal(removed.rows[0].balance,11);assert.match(removed.rows[0].notes,/reconciliation/);
 report=stockReport(await snapshot('2026-08-01','2026-08-31'),'stock_statement');assert.equal(report.rows[0].opening,0);assert.equal(report.rows[0].closing,-5);
 report=stockReport(await snapshot('2026-07-17','2027-07-16'),'stock_statement');assert.equal(report.rows[0].opening,0);assert.equal(report.rows[0].closing,13);
 await assert.rejects(db.query('update products set stock_qty=-1 where id=$1',[product]),/Insufficient/);
 await db.exec('alter table ledger_entries add constraint qa_limit check(debit<1000)');const before=await stock();await assert.rejects(sale('vat',[line(100)]),/qa_limit/);assert.equal(await stock(),before);
 await assert.rejects(db.query('update products set stock_qty=-1 where id=$1',[product]),/Insufficient/);
 const privileges=(await db.query("select has_function_privilege('anon','stock_report_snapshot(uuid,date,date)','EXECUTE') a,has_function_privilege('authenticated','record_numbered_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text,text)','EXECUTE') b,has_function_privilege('service_role','stock_report_snapshot(uuid,date,date)','EXECUTE') s")).rows[0];assert.deepEqual(privileges,{a:false,b:false,s:true});
 const createProduct=async()=> (await db.query('select create_catalog_product($1,$2,$3,$4,$5) value',[c,fy,actor,'2026-11-26',{name:'New opening item',itemType:'resale_good',unit:'pcs',openingStock:7,purchasePrice:20}])).rows[0].value;
 const created=await createProduct();assert.equal(created.openingAdjustment.stockAfter,7);await assert.rejects(createProduct(),/unique/);assert.equal(Number((await db.query('select stock_qty from products where id=$1',[created.id])).rows[0].stock_qty),7);
 const openingMoves=stockReport(await snapshot('2026-11-01','2026-11-30'),'stock_movement',{productId:created.id});assert.equal(openingMoves.rows.length,1);assert.equal(openingMoves.rows[0].actorName,'First Admin');assert.match(openingMoves.rows[0].notes,/Opening stock/);assert.equal(openingMoves.rows[0].source,'manual');
 }finally{await db.close();}
});

const adapter=url(`export const state={args:null,error:null};export const NextResponse={json:(body,options)=>new Response(JSON.stringify(body),options)};export const requireFeature=async()=>{};export const getBusinessContext=async()=>({company:{id:'verified-company'}});export const getSupabaseAdmin=()=>({rpc:async(name,args)=>{state.args={name,args};return{data:{products:[],movements:[],future:[]},error:state.error}},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:[{id:'fy',start_ad:'2026-07-17',end_ad:'2027-07-16'}]})};return q}});export const financialReport=()=>{};export const connectedReport=()=>{};export const allReportRows=()=>{};`);
const adapted=(await compile('app/api/reports/route.ts')).replace(/from "([^"]+)"/g,(_,name)=>`from ${JSON.stringify(name.endsWith('/stock-reports')?modelUrl:adapter)}`);
const {GET}=await import(url(adapted)),{state}=await import(adapter);
test('actual report API scopes its atomic snapshot to the verified company and validates period bounds',async()=>{
 let response=await GET(new Request('https://app.example/api/reports?type=stock_movement&companyId=foreign&from=2026-11-01&to=2026-11-30'));assert.equal(response.status,200);assert.deepEqual(state.args,{name:'stock_report_snapshot',args:{p_company_id:'verified-company',p_from:'2026-11-01',p_to:'2026-11-30'}});assert.equal(response.headers.get('cache-control'),'private, no-store');
 response=await GET(new Request('https://app.example/api/reports?type=stock_statement&from=2026-01-01'));assert.equal(response.status,400);
 state.error={message:'Could not find stock_report_snapshot in schema cache'};response=await GET(new Request('https://app.example/api/reports?type=stock_statement'));assert.equal(response.status,500);assert.match((await response.json()).error,/migration 202611270001/);
});

test('actual report tables render signed balances, staff, source and grouped units for print/export',async()=>{
 const source=await readFile('app/reports-workspace.tsx','utf8'),part=source.slice(source.indexOf('function StockStatementTable('),source.indexOf('function TaxSummaryTable('));
 const compiled=ts.transpileModule(part,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const require=createRequire(import.meta.url),{StockStatementTable,StockMovementTable}=new Function('require','exports','money','formatBs','ReportVoucherReference','typeLabel',compiled+';return {StockStatementTable,StockMovementTable};')(require,{},n=>`Rs. ${Math.abs(n)}`,date=>`BS ${date}`,({reference})=>React.createElement('span',null,reference),{});
 const snapshot={products:[{id:'oil',name:'Gear Oil',unit:'L',stock_qty:-5,purchase_price:100}],movements:[{id:'m',product_id:'oil',quantity:-5,voucher_type:'stock_adjustment',actor_id:'admin',actor_name:'Named Staff',created_at:'2026-11-26T10:00:00Z',notes:'Manual shrinkage',voucher_no:'7'}]};
 const statement=renderToStaticMarkup(React.createElement(StockStatementTable,{data:stockReport(snapshot,'stock_statement'),loading:false}));assert.match(statement,/MANUAL ADDED/);assert.match(statement,/MANUAL REMOVED/);assert.match(statement,/Quantity total · L/);assert.match(statement,/−Rs. 500/);assert.match(statement,/stock-audit-report/);
 const movement=renderToStaticMarkup(React.createElement(StockMovementTable,{data:stockReport(snapshot,'stock_movement'),loading:false}));for(const text of ['Named Staff','Manual stock adjustment','Manual shrinkage','BALANCE','RECORDED (NEPAL)','15:45'])assert(movement.includes(text),text);
 for(const text of ['Stock item','Item category','Stock source','Staff member','Recorded at (Nepal)','Manual added','Manual removed'])assert(source.includes(text),text);
 const css=await readFile('app/stock-reports.css','utf8');assert.match(css,/size:A4 landscape/);assert.match(css,/min-width:0!important/);assert.match(css,/overflow-x:auto/);
});
test('actual manual stock form permits positive partial reconciliation but not further removal into deficit',async()=>{
 const source=(await readFile('app/manual-stock-panel.tsx','utf8')).replace(/^import.*\n/gm,'');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,require=createRequire(import.meta.url);
 function render(mode){const values=[{product:{stock_qty:-10,purchase_price:100,unit:'pcs',active:true},history:[]},'',mode,'4','Physical reconciliation','','2026-11-26',false,'',0,false,''];let i=0;const mod={exports:{}};
 new Function('require','module','exports','useState','useRef','useEffect','stockRequestKey','BsDateInput',compiled)(require,mod,mod.exports,()=>[values[i++],()=>{}],React.useRef,()=>{},()=>'',()=>React.createElement('span',null,'BS date'));
 return renderToStaticMarkup(React.createElement(mod.exports.default,{companyId:'company',productId:'oil',fiscalYear:{id:'fy',start_ad:'2026-07-17',end_ad:'2027-07-16'},onSaved:()=>{}}));}
 const add=render('add');assert.match(add,/<strong>-6 pcs<\/strong>/);assert.match(add,/<button type="button" class="primary">Save manual stock/);
 assert.match(render('remove'),/<button type="button" class="primary" disabled="">Save manual stock/);
});
