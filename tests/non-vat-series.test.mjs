import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Postgres: independent NB sequence, preserved legacy numbers, edits, cancellation, isolation and rollback',{skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
  const c='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
  const fy='20000000-0000-0000-0000-000000000001',next='20000000-0000-0000-0000-000000000002',foreignFy='20000000-0000-0000-0000-000000000003';
  const member='30000000-0000-0000-0000-000000000001',foreignMember='30000000-0000-0000-0000-000000000002';
  const party='40000000-0000-0000-0000-000000000001',foreignParty='40000000-0000-0000-0000-000000000002';
  const product='50000000-0000-0000-0000-000000000001',legacy='60000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table companies(id uuid primary key);
      create table fiscal_years(id uuid primary key,company_id uuid references companies(id),start_ad date,end_ad date,status text);
      create table parties(id uuid primary key,company_id uuid references companies(id));
      create table team_members(id uuid primary key,company_id uuid,active boolean default true,role text);
      create table products(id uuid primary key,company_id uuid,name text,stock_qty numeric,purchase_price numeric,check(stock_qty>=0));
      create table vouchers(id uuid primary key default gen_random_uuid(),company_id uuid,party_id uuid,fiscal_year_id uuid,
        voucher_type text,voucher_no text,sequence_no integer,voucher_date date,narration text,total numeric,subtotal numeric,
        discount_percent numeric,discount_amount numeric,tax_percent numeric,tax_amount numeric,
        bill_category text default 'unclassified',supplier_bill_no text,due_date date,generated_by uuid,handled_by uuid,
        document_status text default 'posted',source_voucher_id uuid);
      create unique index vouchers_fy_type_sequence_unique on vouchers(fiscal_year_id,voucher_type,sequence_no);
      create table voucher_sequences(fiscal_year_id uuid,voucher_type text,last_number integer,primary key(fiscal_year_id,voucher_type));
      create table voucher_lines(id uuid primary key default gen_random_uuid(),voucher_id uuid,product_id uuid,description text,quantity numeric,rate numeric,amount numeric,inventory_item boolean);
      create table stock_movements(id uuid primary key default gen_random_uuid(),company_id uuid,product_id uuid,voucher_id uuid,movement_date date,quantity numeric,movement_type text,unit_cost numeric,notes text);
      create table ledger_entries(company_id uuid,party_id uuid,voucher_id uuid,entry_date date,account_name text,debit numeric,credit numeric);
      create table journal_entries(voucher_id uuid);
      create table voucher_audit_logs(voucher_id uuid,action text default 'edit',before_data jsonb);
      insert into companies values('${c}'),('${other}');
      insert into fiscal_years values('${fy}','${c}','2026-07-17','2027-07-16','open'),('${next}','${c}','2027-07-17','2028-07-15','open'),('${foreignFy}','${other}','2026-07-17','2027-07-16','open');
      insert into parties values('${party}','${c}'),('${foreignParty}','${other}');
      insert into team_members(id,company_id,role) values('${member}','${c}','admin'),('${foreignMember}','${other}','admin');
      insert into products values('${product}','${c}','Oil',100,50);
      insert into vouchers(id,company_id,party_id,fiscal_year_id,voucher_type,voucher_no,sequence_no,voucher_date,total,subtotal,tax_amount,bill_category)
        values('${legacy}','${c}','${party}','${fy}','sale','4',4,'2026-07-18',100,100,0,'non_vat');
      insert into voucher_sequences values('${fy}','sale',4);`);
    await db.exec(await readFile(new URL('../supabase/migrations/202608130003_edit_vouchers_with_audit.sql',import.meta.url),'utf8').then(sql=>sql.slice(sql.indexOf('create or replace function public.update_sales_invoice('))));
    await db.exec(await readFile(new URL('../supabase/migrations/202611080001_cancelled_sales_invoices.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202611080003_non_vat_invoice_series.sql',import.meta.url),'utf8'));
    const line=(qty=1,rate=100,p=null)=>[{product_id:p,name:'Oil',quantity:qty,rate}];
    const create=async(category,{year=fy,company=c,actor=member,buyer=party,lines=line(),id=null}={})=>(await db.query('select record_classified_invoice($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as value',
      [company,year,buyer,year===next?'2027-08-01':'2026-08-01',lines,'sale',category,0,category==='vat'?13:0,'',null,'',actor,id])).rows[0].value;
    const sequence=async(key,year=fy)=>Number((await db.query('select last_number from voucher_sequences where fiscal_year_id=$1 and voucher_type=$2',[year,key])).rows[0]?.last_number||0);
    assert.equal((await db.query('select number_series from vouchers where id=$1',[legacy])).rows[0].number_series,'standard');
    assert.equal((await create('vat')).voucher_no,'5');
    const nb=await create('non_vat',{lines:line(2,100,product)});
    assert.equal(nb.voucher_no,'NB 1');assert.equal(nb.sequence_no,1);
    assert.equal(await sequence('sale'),5);
    assert.equal((await create('vat')).voucher_no,'6');
    assert.equal((await create('non_vat')).voucher_no,'NB 2');
    assert.equal(await sequence('sale'),6);assert.equal(await sequence('sale_non_vat'),2);
    assert.equal(Number((await db.query('select stock_qty from products where id=$1',[product])).rows[0].stock_qty),98);
    assert.equal(Number((await db.query('select debit from ledger_entries where voucher_id=$1',[nb.id])).rows[0].debit),200);
    const edited=await create('non_vat',{id:nb.id,lines:line(1,120,product)});
    assert.equal(edited.voucher_no,'NB 1');assert.equal(await sequence('sale_non_vat'),2);
    await assert.rejects(create('vat',{id:nb.id}),/cannot change VAT\/non-VAT type/);
    await assert.rejects(db.query('select classify_voucher_bill($1,$2,$3,$4)',[c,nb.id,'vat',member]),/cannot change VAT\/non-VAT type/);
    assert.equal((await create('non_vat',{id:legacy})).voucher_no,'4');
    assert.equal((await create('non_vat',{year:next})).voucher_no,'NB 1');
    assert.equal((await create('vat',{year:next})).voucher_no,'1');
    assert.equal((await create('non_vat',{company:other,actor:foreignMember,buyer:foreignParty,year:foreignFy})).voucher_no,'NB 1');
    await assert.rejects(create('non_vat',{actor:foreignMember}),/Active company member/);
    await assert.rejects(create('non_vat',{buyer:foreignParty}),/Customer is invalid/);
    await assert.rejects(create('non_vat',{year:foreignFy}),/Fiscal year is closed/);
    const cancel=async(id=null)=>(await db.query('select record_cancelled_sales_invoice_in_series($1,$2,$3,$4,$5,$6,$7) as value',[c,fy,member,'2026-08-01','Mistake',id,'non_vat'])).rows[0].value;
    assert.equal((await cancel()).voucher_no,'NB 3');assert.equal(await sequence('sale'),6);
    const cancelled=await cancel(nb.id);
    assert.equal(cancelled.voucher_no,'NB 1');assert.equal(cancelled.number_series,'non_vat');
    assert.equal(Number((await db.query('select count(*) from ledger_entries where voucher_id=$1',[nb.id])).rows[0].count),0);
    assert.equal(Number((await db.query('select stock_qty from products where id=$1',[product])).rows[0].stock_qty),100);
    await db.exec('alter table ledger_entries add constraint qa_limit check(debit<1000)');
    await assert.rejects(create('non_vat',{lines:line(1,2000)}),/qa_limit/);
    assert.equal(await sequence('sale_non_vat'),3);
    assert.equal((await create('non_vat')).voucher_no,'NB 4');
    const together=await Promise.all([create('non_vat'),create('non_vat')]);
    assert.deepEqual(together.map(v=>v.voucher_no).sort(),['NB 5','NB 6']);
    assert.equal((await db.query("select has_function_privilege('anon','record_numbered_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text,text)','EXECUTE') as allowed")).rows[0].allowed,false);
  } finally {await db.close();}
});
