import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

async function moduleUrl(file) {
  let text=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const match of [...text.matchAll(/from ["'](\.[^"']+)["']/g)])text=text.replace(match[0],`from "${await moduleUrl(path.resolve(path.dirname(file),match[1]+'.ts'))}"`);
  return `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
}
const {openingBalanceInput,openingFinancialAdjustments}=await import(await moduleUrl(path.resolve('lib/party-opening.ts')));

test('manual openings accept exact debit/credit and zero, but reject ambiguous or invalid amounts',()=>{
  assert.equal(openingBalanceInput({source:'manual',amount:'1250.25',side:'debit',revision:0}).amount,'1250.25');
  assert.equal(openingBalanceInput({source:'manual',amount:'1250.25',side:'credit',revision:2}).amount,'-1250.25');
  assert.equal(openingBalanceInput({source:'manual',amount:'0',side:'credit',revision:2}).amount,'0');
  for(const amount of ['',-1,'1.234','NaN','Infinity','1,000','1e3'])assert.throws(()=>openingBalanceInput({source:'manual',amount,side:'debit',revision:0}));
  assert.throws(()=>openingBalanceInput({source:'manual',amount:'10',side:'unknown',revision:0}));
  assert.throws(()=>openingBalanceInput({source:'manual',amount:'10',side:'debit'}));
});

test('manual year baseline replaces history in trial balance rather than adding it twice',()=>{
  const parties=[{id:'p',opening_balance:100}];
  const years=[{id:'old',start_ad:'2025-07-17'},{id:'now',start_ad:'2026-07-17'},{id:'next',start_ad:'2027-07-17'}];
  const accounts=[{id:'ar',system_key:'accounts_receivable'},{id:'ap',system_key:'accounts_payable'}];
  const lines=[{party_id:'p',account_id:'ar',effective_date:'2025-09-01',debit:50,credit:0},{party_id:'p',account_id:'ar',effective_date:'2026-09-01',debit:0,credit:25}];
  const openings=[{party_id:'p',fiscal_year_id:'now',amount:500,balance_source:'manual'},{party_id:'p',fiscal_year_id:'next',amount:-80,balance_source:'manual'}];
  const first=openingFinancialAdjustments(parties,openings,years,lines,accounts,'2026-07-17');
  assert.deepEqual(first,[{receivable:35000,payable:0,equity:-35000}]);
  const both=openingFinancialAdjustments(parties,openings,years,lines,accounts,'2027-07-17');
  assert.deepEqual(both[1],{receivable:-47500,payable:-8000,equity:55500});
  assert.deepEqual(openingFinancialAdjustments(parties,openings.map(o=>({...o,balance_source:'carry_forward'})),years,lines,accounts,'2027-07-17'),[]);
});

test('Postgres: manual baselines, carry-forward, concurrency, audit and company isolation', {skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=await import(process.env.PGLITE_MODULE);
  const db=new PGlite();
  const c='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
  const fy='20000000-0000-0000-0000-000000000002',old='20000000-0000-0000-0000-000000000001',next='20000000-0000-0000-0000-000000000003';
  const member='30000000-0000-0000-0000-000000000001',foreign='30000000-0000-0000-0000-000000000002',staff='30000000-0000-0000-0000-000000000003',party='40000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table companies(id uuid primary key);
      create table team_members(id uuid primary key,company_id uuid references companies(id),active boolean default true,role text);
      create table fiscal_years(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),start_ad date,end_ad date,label_bs text,status text);
      create table nepali_fiscal_calendar(label_bs text,start_ad date,end_ad date);
      create table parties(id uuid primary key default gen_random_uuid(),company_id uuid references companies(id),name text,place text,phone text,tax_no text,party_type text,opening_balance numeric default 0,unique(company_id,name));
      create table party_opening_balances(fiscal_year_id uuid references fiscal_years(id),party_id uuid references parties(id),amount numeric(18,2),primary key(fiscal_year_id,party_id));
      create table ledger_entries(company_id uuid,party_id uuid,entry_date date,debit numeric,credit numeric);
      insert into companies values('${c}'),('${other}');
      insert into team_members(id,company_id,role) values('${member}','${c}','admin'),('${foreign}','${other}','admin'),('${staff}','${c}','staff');
      insert into fiscal_years values('${old}','${c}','2025-07-17','2026-07-16','2082/83','closed'),('${fy}','${c}','2026-07-17','2027-07-16','2083/84','open'),('${next}','${c}','2027-07-17','2028-07-15','2084/85','open');
      insert into parties(id,company_id,name,opening_balance) values('${party}','${c}','Old customer',80);
      insert into ledger_entries values('${c}','${party}','2025-09-01',50,0),('${c}','${party}','2026-09-01',0,100);`);
    await db.exec(await readFile(new URL('../supabase/migrations/202611080002_manual_party_openings.sql',import.meta.url),'utf8'));
    const get=async(year=fy)=>(await db.query('select get_party_opening_balance($1,$2,$3) as value',[c,year,party])).rows[0].value;
    const save=async(amount,revision,source='manual',actor=member)=>(await db.query('select set_party_opening_balance($1,$2,$3,$4,$5,$6,$7,$8) as value',[c,fy,party,actor,amount,source,'Old software closing',revision])).rows[0].value;
    assert.equal((await get()).automaticAmount,130);
    const first=await save(500,0);
    assert.equal(first.amount,500);assert.equal(first.source,'manual');
    assert.equal((await get(next)).amount,400);
    await db.query('select refresh_future_opening_balances($1,$2)',[c,old]);
    assert.equal((await get()).amount,500);
    await assert.rejects(save(900,0),/Another user changed/);
    await assert.rejects(save(900,first.revision,'manual',foreign),/Only an administrator/);
    await assert.rejects(save(900,first.revision,'manual',staff),/Only an administrator/);
    await assert.rejects(db.query('select get_party_opening_balance($1,$2,$3)',[other,fy,party]),/Fiscal year/);
    const credit=await save(-250,first.revision);
    assert.equal((await get(next)).amount,-350);
    const automatic=await save(0,credit.revision,'automatic');
    assert.equal(automatic.amount,130);assert.equal(automatic.source,'carry_forward');
    assert.equal((await get(next)).amount,30);
    assert.equal(Number((await db.query('select count(*) from party_opening_balance_audit')).rows[0].count),3);
    assert.equal(Number((await db.query('select count(*) from ledger_entries')).rows[0].count),2);
    const create=async(name,actor=member)=>(await db.query('select create_party_with_opening($1,$2,$3,$4,$5,$6,$7,$8,$9) as id',[c,fy,actor,name,'','','','customer',200])).rows[0].id;
    const created=await create('Imported party');
    assert.equal((await db.query('select amount from party_opening_balances where party_id=$1 and fiscal_year_id=$2',[created,fy])).rows[0].amount,'200.00');
    await assert.rejects(create('Imported party'),/duplicate key/);
    await assert.rejects(create('Denied party',staff),/Only an administrator/);
    assert.equal(Number((await db.query("select count(*) from parties where name='Denied party'")).rows[0].count),0);
    assert.equal((await db.query("select has_function_privilege('anon','set_party_opening_balance(uuid,uuid,uuid,uuid,numeric,text,text,integer)','EXECUTE') as access")).rows[0].access,false);
  } finally {await db.close();}
});
