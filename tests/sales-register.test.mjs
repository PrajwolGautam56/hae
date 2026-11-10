import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';

const source=await readFile(new URL('../lib/sales-register.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {salesRegisterOptions,loadSalesRegister}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const options=(input={})=>salesRegisterOptions(new URLSearchParams(input));
const bill=(number,extra={})=>({id:`bill-${number}`,company_id:'hae',fiscal_year_id:'fy',voucher_type:'sale',sequence_no:number,number_series:'standard',voucher_no:String(number),voucher_date:new Date(Date.UTC(2026,6,number)).toISOString().slice(0,10),created_at:`${number}`.padStart(3,'0'),total:100,document_status:number===17?'cancelled':'posted',...extra});
const bills=Array.from({length:55},(_,i)=>bill(i+1));

function database(records,{error=null,countMissing=false}={}){
  const calls=[];
  return {calls,from(table){
    assert.equal(table,'vouchers');let rows=[...records];const sorts=[];
    const query={
      select(fields,settings){calls.push(['select',fields,settings]);return query;},
      eq(key,value){calls.push(['eq',key,value]);rows=rows.filter(row=>row[key]===value);return query;},
      ilike(key,value){calls.push(['ilike',key,value]);const literal=value.slice(1,-1).replace(/\\(.)/g,'$1').toLowerCase();rows=rows.filter(row=>row[key].toLowerCase().includes(literal));return query;},
      order(key,{ascending}){sorts.push([key,ascending]);return query;},
      range(from,to){calls.push(['range',from,to]);rows.sort((a,b)=>{for(const [key,asc] of sorts){if(a[key]!==b[key])return (a[key]<b[key]?-1:1)*(asc?1:-1);}return 0;});return Promise.resolve({data:rows.slice(from,to+1),error,count:countMissing?null:rows.length});}
    };return query;
  }};
}

test('all 55 bills are reachable, including bills 1–5 on the last page; receipts and other companies/years do not consume the page',async()=>{
  const db=database([...bills,bill(100,{voucher_type:'receipt'}),bill(101,{company_id:'foreign'}),bill(102,{fiscal_year_id:'old'})]);
  const pages=await Promise.all([1,2,3].map(page=>loadSalesRegister(db,'hae','fy',options({page:String(page)}))));
  assert.deepEqual(pages.map(p=>p.rows.length),[25,25,5]);assert.deepEqual(pages.map(p=>p.total),[55,55,55]);
  assert.deepEqual(pages[2].rows.map(r=>r.sequence_no),[5,4,3,2,1]);
  assert.equal(new Set(pages.flatMap(p=>p.rows.map(r=>r.id))).size,55);
  assert.equal(pages[0].pages,3);assert.equal(pages[0].rows[0].sequence_no,55);
  assert.ok(pages.flatMap(p=>p.rows).some(r=>r.sequence_no===17&&r.document_status==='cancelled'));
  assert.ok(db.calls.some(c=>c[0]==='select'&&c[2].count==='exact'));
});

test('invoice serial search is exact across the whole fiscal year and accepts leading zeroes and Nepali digits',async()=>{
  for(const search of ['1','0001','१']){
    const result=await loadSalesRegister(database(bills),'hae','fy',options({search}));
    assert.equal(result.total,1);assert.equal(result.rows[0].sequence_no,1);
  }
});

test('VAT and NB serials remain separate and NB searches never return a VAT bill',async()=>{
  const db=()=>database([...bills,bill(1,{id:'nb1',number_series:'non_vat',voucher_no:'NB 1'})]);
  for(const search of ['NB 1','nb1','NB-१']){
    const result=await loadSalesRegister(db(),'hae','fy',options({search}));
    assert.deepEqual(result.rows.map(r=>r.id),['nb1']);
  }
  assert.equal((await loadSalesRegister(db(),'hae','fy',options({search:'1'}))).total,2);
  assert.equal((await loadSalesRegister(db(),'hae','fy',options({search:'1',series:'standard'}))).rows[0].id,'bill-1');
  assert.equal((await loadSalesRegister(db(),'hae','fy',options({series:'non_vat'}))).total,1);
});

test('reference search uses a literal value, not injectable PostgREST filters; validation bounds input and pagination',async()=>{
  const db=database([]);
  await loadSalesRegister(db,'hae','fy',options({search:'test%_\\,company_id.eq.foreign'}));
  assert.deepEqual(db.calls.find(c=>c[0]==='ilike'),['ilike','voucher_no','%test\\%\\_\\\\,company\\_id.eq.foreign%']);
  for(const input of [{page:'0'},{page:'-1'},{page:'1.5'},{page:'NaN'},{page:'1000001'},{series:'evil'},{search:'x'.repeat(101)}])assert.throws(()=>options(input));
});

test('empty results and query failures are explicit, never silently presented as deleted records',async()=>{
  assert.equal((await loadSalesRegister(database([]),'hae','fy',options())).total,0);
  await assert.rejects(loadSalesRegister(database([],{error:new Error('Unavailable')}),'hae','fy',options()),/Unavailable/);
  await assert.rejects(loadSalesRegister(database([],{countMissing:true}),'hae','fy',options()),/count could not be loaded/);
});

test('sales register is wired independently of recent transactions, resets per company/FY and refreshes after saves',async()=>{
  const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/SalesBillRegister key=\{`\$\{company\?\.id\}:\$\{fiscalYear\?\.id\}`\}/);
  assert.match(page,/refreshVersion=\{reportVersion\} onNewBill=\{openSale\} onOpenBill=\{openVoucherDetail\}/);
  assert.doesNotMatch(page,/salesTransactions\.map/);
  const route=await readFile(new URL('../app/api/sales-register/route.ts',import.meta.url),'utf8');
  assert.match(route,/requireFeature\("sales"\)/);assert.match(route,/getBusinessContext\(db\)/);
  assert.match(route,/eq\("company_id", company.id\).eq\("id", fiscalYearId\)/);
  assert.match(route,/loadSalesRegister\(db, company.id, year.id, options\)/);
  assert.doesNotMatch(route,/request\.json|\.insert\(|\.update\(|\.delete\(/);
});

test('register renders a visible accessible search and bill series filter; requests abort on changes',async()=>{
  let component=await readFile(new URL('../app/sales-bill-register.tsx',import.meta.url),'utf8');
  assert.match(component,/controller\.abort\(\)/);assert.match(component,/controller\.signal\.aborted/);
  assert.match(component,/result\?\.key === key/);assert.match(component,/Existing records have not been removed/);
  assert.match(component,/setSearch\(event.target.value\); setPage\(1\)/);
  assert.match(component,/aria-label="Sales bill pages"/);assert.match(component,/>Last<\/button>/);
  component=component.replace(/^import .* from .*;\n/gm,'').replace(/^import "\.\/sales-bill-register\.css";\n/m,'');
  const compiled=ts.transpileModule(component,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports','useState','useEffect',compiled)(createRequire(import.meta.url),mod,mod.exports,React.useState,React.useEffect);
  const html=renderToStaticMarkup(React.createElement(mod.exports.default,{fiscalYearId:'fy',refreshVersion:1,onNewBill:()=>{},onOpenBill:()=>{},formatDate:x=>x}));
  assert.match(html,/Find invoice number/);assert.match(html,/type="search"/);assert.match(html,/NB 1/);assert.match(html,/All series/);assert.match(html,/Loading bills/);
});

test('last-page rendering shows bills 1–5, full details links and pagination; cancelled bills display zero',async()=>{
  let component=await readFile(new URL('../app/sales-bill-register.tsx',import.meta.url),'utf8');
  component=component.replace(/^import .* from .*;\n/gm,'').replace(/^import "\.\/sales-bill-register\.css";\n/m,'');
  const compiled=ts.transpileModule(component,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const last=await loadSalesRegister(database(bills),'hae','fy',options({page:'3'}));
  last.rows[0]={...last.rows[0],document_status:'cancelled',total:999,party:{name:'Buyer'}};
  let index=0;
  const values=['','all',3,0,{key:JSON.stringify(['fy','','all',3,1,0]),data:last}];
  const mod={exports:{}};
  new Function('require','module','exports','useState','useEffect',compiled)(createRequire(import.meta.url),mod,mod.exports,()=>[values[index++],()=>{}],()=>{});
  const html=renderToStaticMarkup(React.createElement(mod.exports.default,{fiscalYearId:'fy',refreshVersion:1,onNewBill:()=>{},onOpenBill:()=>{},formatDate:x=>x}));
  assert.match(html,/55 bills found · Showing 51–55/);assert.match(html,/Page 3 of 3/);
  for(const n of [1,2,3,4,5])assert.match(html,new RegExp(`aria-label="View invoice ${n}"`));
  assert.match(html,/Cancelled bill/);assert.match(html,/Rs\. 0\.00/);assert.doesNotMatch(html,/Rs\. 999/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Last<\/button>/);
});
