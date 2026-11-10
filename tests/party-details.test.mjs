import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
const source=await readFile(new URL('../lib/party-details.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {partyDetailsInput}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('party profile updates normalize optional fields without allowing ledger/opening fields',()=>{
  const result=partyDetailsInput({name:' Buyer ',address:' Butwal ',phone:' 9848000000 ',taxNo:' 610290480 ',revision:1,openingBalance:999999,companyId:'foreign'});
  assert.deepEqual(result,{name:'Buyer',address:'Butwal',phone:'9848000000',taxNo:'610290480',revision:1});
  assert.equal(partyDetailsInput({name:'Buyer',revision:1}).phone,'');
  assert.throws(()=>partyDetailsInput({name:'',revision:1}));
  assert.throws(()=>partyDetailsInput({name:'Buyer',revision:0}));
  assert.throws(()=>partyDetailsInput({name:'Buyer',revision:1,taxNo:'x'.repeat(51)}));
});

test('party details and opening controls are available without nested mobile buttons',async()=>{
  const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
  const reports=await readFile(new URL('../app/reports-workspace.tsx',import.meta.url),'utf8');
  const api=await readFile(new URL('../app/api/party-details/route.ts',import.meta.url),'utf8');
  assert.match(page,/Edit details/);assert.match(page,/PartyDetailsEditor/);
  assert.match(reports,/Edit party details/);assert.match(reports,/Add Opening Balance/);
  assert.match(api,/p_company_id:company.id/);assert.match(api,/p_member_id:member.id/);
  assert.doesNotMatch(api,/\.from\("(ledger_entries|vouchers|party_opening_balances)"\)/);
});

test('a party without current transactions still has an opening row in its ledger table',async()=>{
  const source=await readFile(new URL('../app/reports-workspace.tsx',import.meta.url),'utf8');
  const table=source.slice(source.indexOf('function VoucherReportTable('),source.indexOf('function AgingTable('));
  const compiled=ts.transpileModule(table,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const render=new Function('require','exports','formatBs','money','ReportVoucherReference','typeLabel','reportLabel',compiled+';return VoucherReportTable;')(createRequire(import.meta.url),{},x=>x,x=>`Rs. ${Math.abs(Number(x)).toFixed(2)}`,()=>null,{},{});
  for(const opening of [0,500,-500]) {
    const data={opening,closing:opening,rows:[],totals:{debit:0,credit:0},fiscalYear:{start_ad:'2026-07-17'},openingSource:'manual'};
    const html=renderToStaticMarkup(render({data,loading:false,from:'2026-07-17',to:'2027-07-16',partyId:'buyer',type:'daybook'}));
    assert.match(html,/ledger-opening-row/);assert.match(html,/Opening balance/);assert.match(html,new RegExp(`Rs\\. ${Math.abs(opening).toFixed(2)} ${opening<0?'Cr':'Dr'}`));
  }
  assert.match(source,/Existing records have not been removed/);
});
