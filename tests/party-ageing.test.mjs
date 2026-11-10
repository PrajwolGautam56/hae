import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';

async function moduleUrl(file){
  let source=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const match of [...source.matchAll(/from ["'](\.[^"']+)["']/g)])source=source.replace(match[0],`from "${await moduleUrl(path.resolve(path.dirname(file),match[1]+'.ts'))}"`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const {ageParty}=await import(await moduleUrl(path.resolve('lib/accounting-report-model.ts')));
const {connectedReport}=await import(await moduleUrl(path.resolve('lib/connected-reports.ts')));
const entry=(id,date,debit,credit,due)=>({id,entry_date:date,created_at:date,debit,credit,due_date:due,voucher_id:`voucher-${id}`,voucher_no:id,voucher_date:date});
const bills=[entry('1','2026-08-01',100000,0,'2026-10-30'),entry('2','2026-09-01',50000,0,'2026-11-30')];

test('one lakh old bill, fifty thousand new bill and fifty thousand receipt leave only fifty thousand overdue',()=>{
  const result=ageParty(0,[...bills,entry('receipt','2026-11-01',0,50000)],'2026-11-02');
  assert.equal(result.total,100000);assert.equal(result.overdue,50000);assert.equal(result.notDue,50000);
  assert.equal(result.current,50000);assert.equal(result.details[0].reference,'1');
  assert.equal(result.details[0].originalAmount,100000);assert.equal(result.details[0].settledAmount,50000);assert.equal(result.details[0].remaining,50000);
  assert.equal(result.details[0].overdueDays,3);assert.equal(result.details[0].voucherId,'voucher-1');
  assert.equal(result.details[1].settledAmount,0);assert.equal(result.details[1].status,'not_due');
  const paidMore=ageParty(0,[...bills,entry('receipt','2026-11-01',0,110000)],'2026-11-02');
  assert.equal(paidMore.overdue,0);assert.equal(paidMore.total,40000);assert.equal(paidMore.details[0].reference,'2');
  const payable=ageParty(0,[...bills.map(e=>({...e,debit:0,credit:e.debit})),entry('payment','2026-11-01',50000,0)],'2026-11-02',true);
  assert.equal(payable.total,100000);assert.equal(payable.overdue,50000);assert.equal(payable.notDue,50000);
});

test('due today is not overdue; undated imported openings are never assumed past due',()=>{
  const result=ageParty(300,[entry('1','2026-10-01',100,0,'2026-11-02')],'2026-11-02');
  assert.equal(result.total,400);assert.equal(result.unknown,300);assert.equal(result.dueToday,100);assert.equal(result.notDue,100);assert.equal(result.overdue,0);
  assert.equal(result.details.find(d=>d.reference==='1').status,'due_today');
  const fallback=ageParty(0,[entry('2','2026-10-01',100,0)],'2026-11-02');
  assert.equal(fallback.overdue,100);assert.equal(fallback.details[0].dueSource,'invoice_date');
});

test('FIFO follows oldest invoice, not earliest due date, and prepayments/future receipts do not double-count',()=>{
  const first=entry('first','2026-08-01',100000,0,'2026-12-01');
  const second=entry('second','2026-09-01',50000,0,'2026-10-01');
  const result=ageParty(0,[second,entry('receipt','2026-10-15',0,50000),first,entry('future','2026-12-01',0,50000)],'2026-11-02');
  assert.equal(result.overdue,50000);assert.equal(result.details.find(d=>d.reference==='first').remaining,50000);assert.equal(result.details.find(d=>d.reference==='second').remaining,50000);
  const advance=ageParty(0,[entry('prepayment','2026-07-01',0,200000),...bills],'2026-11-02');
  assert.equal(advance.total,0);assert.equal(advance.overdue,0);assert.equal(advance.advance,50000);
});

function database(tables){return{from(table){let rows=tables[table]||[];const query={select(){return query;},eq(k,v){rows=rows.filter(r=>k.includes('.')?r.fiscal_years?.company_id===v:r[k]===v);return query;},lte(k,v){rows=rows.filter(r=>r[k]<=v);return query;},order(){return query;},range(a,b){return Promise.resolve({data:rows.slice(a,b+1),error:null});}};return query;}};}

test('party ledger ageing includes bills before the date filter, caps full-FY ageing at today, and remains company scoped',async()=>{
  const company={id:'c'},fy={id:'fy',start_ad:'2026-07-17',end_ad:'2027-07-16'};
  const source=[...bills,entry('receipt','2026-11-01',0,50000),entry('future-receipt','2026-12-01',0,50000)];
  const rows=source.map(e=>({...e,company_id:'c',party_id:'p',vouchers:{due_date:e.due_date,voucher_date:e.entry_date,voucher_no:e.voucher_no,voucher_type:e.credit?'receipt':'sale'}}));
  const db=database({parties:[{id:'p',company_id:'c',name:'Buyer',opening_balance:0},{id:'other',company_id:'foreign',name:'Other',opening_balance:999999}],ledger_entries:[...rows,{...entry('foreign','2026-08-01',999999,0),company_id:'foreign',party_id:'other'}],party_opening_balances:[]});
  const report=await connectedReport(db,company,fy,'daybook','2026-11-01',fy.end_ad,'p','2026-11-02');
  assert.equal(report.receivableAgeing.asOf,'2026-11-02');assert.equal(report.receivableAgeing.total,100000);assert.equal(report.receivableAgeing.overdue,50000);assert.equal(report.receivableAgeing.details.length,2);
  assert.equal(report.rows.some(r=>r.voucherId==='voucher-1'),false,'The ledger period may omit old rows without omitting outstanding bills');
  const aging=await connectedReport(db,company,fy,'aging_receivable',fy.start_ad,fy.end_ad,null,'2026-11-02');
  assert.equal(aging.rows.length,1);assert.equal(aging.asOf,'2026-11-02');assert.equal(aging.totals.overdue,50000);
});

test('prior-year debts preserve their original due date without adding the carried opening twice',async()=>{
  const db=database({parties:[{id:'p',company_id:'c',name:'Buyer',opening_balance:0}],ledger_entries:[{...entry('old','2026-06-01',100000,0,'2026-07-01'),company_id:'c',party_id:'p',vouchers:{due_date:'2026-07-01',voucher_date:'2026-06-01',voucher_no:'old'}},{...entry('receipt','2026-08-01',0,50000),company_id:'c',party_id:'p',vouchers:{voucher_no:'receipt'}}],party_opening_balances:[{party_id:'p',fiscal_year_id:'fy',amount:100000,fiscal_years:{company_id:'c',start_ad:'2026-07-17'}}]});
  const report=await connectedReport(db,{id:'c'},{id:'fy',start_ad:'2026-07-17',end_ad:'2027-07-16'},'daybook','2026-07-17','2027-07-16','p','2026-11-02');
  assert.equal(report.receivableAgeing.total,50000);assert.equal(report.receivableAgeing.overdue,50000);assert.equal(report.receivableAgeing.unknown,0);assert.equal(report.receivableAgeing.details[0].due,'2026-07-01');
});

test('party due UI shows separate totals and partial bill settlement with a source-bill link',async()=>{
  let source=await readFile(new URL('../app/party-due-summary.tsx',import.meta.url),'utf8');
  source=source.replace(/^import .* from .*;\n/gm,'').replace(/^import "\.\/party-due-summary\.css";\n/m,'');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const mod={exports:{}};
  const reference=({reference})=>String(reference);
  new Function('require','module','exports','formatBs','ReportVoucherReference',compiled)(createRequire(import.meta.url),mod,mod.exports,x=>x,reference);
  const data={...ageParty(0,[...bills,entry('receipt','2026-11-01',0,50000)],'2026-11-02'),asOf:'2026-11-02'};
  const html=renderToStaticMarkup(mod.exports.default({data}));
  assert.match(html,/TOTAL TO RECEIVE/);assert.match(html,/OVERDUE · DUE DATE PASSED/);assert.match(html,/NOT YET OVERDUE/);assert.match(html,/Rs\. 1,00,000\.00/);assert.match(html,/Rs\. 50,000\.00/);assert.match(html,/3 days overdue/);assert.match(html,/SETTLED \/ ADJUSTED/);
  const reportSource=await readFile(new URL('../app/reports-workspace.tsx',import.meta.url),'utf8');assert.match(reportSource,/PartyDueSummary data=\{data.receivableAgeing\} onOpenVoucher=\{onOpenVoucher\}/);
});
