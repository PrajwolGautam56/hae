import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const reports=await readFile(new URL('../app/reports-workspace.tsx',import.meta.url),'utf8');
const component=await readFile(new URL('../app/report-voucher-reference.tsx',import.meta.url),'utf8');
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',transpile(component.replace(/^import "\.\/report-voucher-reference\.css";\n/m,'')))(require,mod,mod.exports);
const Reference=mod.exports.default;

test('report reference 34 opens the exact persisted voucher ID, not a number or ledger-entry ID',()=>{
  const opened=[];
  const button=Reference({voucherId:'invoice-uuid-34',reference:34,label:'Sales Invoice',onOpen:id=>opened.push(id)});
  assert.equal(button.type,'button');
  assert.equal(button.props.type,'button');
  button.props.onClick();
  assert.deepEqual(opened,['invoice-uuid-34']);
  assert.match(renderToStaticMarkup(button),/aria-label="Open Sales Invoice 34"/);
  assert.equal(Reference({reference:'Production journal',onOpen:()=>assert.fail('No source voucher')}).type,'strong');
  assert.match(reports,/voucherId=\{r\.voucherId\}/);
  assert.match(page,/onOpenVoucher=\{openVoucherDetail\}/);
});

function detailHarness() {
  const state={};const requests=[];
  const source=page.slice(page.indexOf('  async function openVoucherDetail('),page.indexOf('  useEffect(() => () => detailRequest.current?.abort()'));
  const context={detailRequest:{current:null},AbortController,
    fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve})),
    setDetailLoading:value=>state.loading=value,setVoucherDetail:value=>state.detail=value,setNotice:value=>state.notice=value};
  const flow=new Function(...Object.keys(context),transpile(source)+';return {openVoucherDetail,closeVoucherDetail};')(...Object.values(context));
  return {state,requests,...flow};
}
const result=data=>({ok:true,json:async()=>data});

test('detail requests cannot reopen a closed popup or replace a newer bill with a late response',async()=>{
  const h=detailHarness();
  const first=h.openVoucherDetail('invoice-34');
  const second=h.openVoucherDetail('invoice-35');
  assert.equal(h.requests[0].options.signal.aborted,true);
  h.requests[1].resolve(result({id:'invoice-35',total:200}));await second;
  h.requests[0].resolve(result({id:'invoice-34',total:100}));await first;
  assert.equal(h.state.detail.id,'invoice-35');
  const pending=h.openVoucherDetail('invoice-36');
  h.closeVoucherDetail();
  h.requests[2].resolve(result({id:'invoice-36'}));await pending;
  assert.equal(h.state.detail,null);assert.equal(h.state.loading,false);
});

test('a denied or missing voucher shows an error rather than another invoice',async()=>{
  const h=detailHarness();const pending=h.openVoucherDetail('foreign-id');
  h.requests[0].resolve({ok:false,json:async()=>({error:'Voucher not found'})});await pending;
  assert.equal(h.state.detail,null);assert.equal(h.state.notice,'Voucher not found');
});

async function editHarness({voucher_type='sale',differentYear=false,failYear=false,document_status='posted'}={}) {
  const state={};const effects=[];
  const source=page.slice(page.indexOf('  async function editVoucher()'),page.indexOf('  const saleSubtotal'));
  const context={voucherDetail:{id:'invoice-uuid-34',sequence_no:34,voucher_type,document_status,fiscal_year_id:differentYear?'old-year':'current-year',voucher_date:'2026-08-27',parties:{name:'Bhageshwor'},lines:[{product_id:'oil',description:'Gear Oil',quantity:10,rate:100}]},
    fiscalYear:{id:'current-year'},detailRequest:{current:{}},currentMember:{id:'staff'},
    changeFiscalYear:async id=>{effects.push(`year:${id}`);if(failYear)throw new Error('Fiscal year could not load');},
    closeVoucherDetail:()=>effects.push('close-detail')};
  for(const [,setter] of source.matchAll(/\b(set[A-Z]\w*)\(/g))context[setter]=value=>state[setter.slice(3)]=value;
  await new Function(...Object.keys(context),transpile(source)+';return editVoucher();')(...Object.values(context));
  return {state,effects};
}

test('Edit record opens the same sales bill and original fiscal year with its item details',async()=>{
  const {state,effects}=await editHarness({differentYear:true});
  assert.deepEqual(effects,['year:old-year','close-detail']);
  assert.equal(state.Active,'Sales');assert.equal(state.Modal,'sale');
  assert.equal(state.EditingVoucherId,'invoice-uuid-34');assert.equal(state.EditingVoucherNumber,'34');
  assert.equal(state.SaleLines[0].quantity,10);assert.equal(state.SaleLines[0].rate,100);
  const receipt=await editHarness({voucher_type:'receipt'});assert.equal(receipt.state.Active,'Payments');assert.equal(receipt.state.Modal,'payment');
});

test('cancelled invoices and a failed fiscal-year switch never open an incorrect editor',async()=>{
  const cancelled=await editHarness({document_status:'cancelled'});assert.equal(cancelled.state.Modal,undefined);
  const failed=await editHarness({differentYear:true,failYear:true});assert.equal(failed.state.Modal,undefined);assert.equal(failed.state.Notice,'Fiscal year could not load');
});
