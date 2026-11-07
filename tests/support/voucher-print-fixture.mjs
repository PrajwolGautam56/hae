import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
export async function loadTs(path) {
  const code = ts.transpileModule(await read(path), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const {amountInWords} = await loadTs('lib/amount-in-words.ts');
const {voucherPrintHtml} = await loadTs('lib/voucher-print.ts');
const page = await read('app/page.tsx');
const start = page.indexOf('<div className="voucher-document" ref={voucherDocument}>');
const end = page.indexOf('\n            )}', start);
const jsx = page.slice(start,end);
const functionBody = ts.transpileModule(`return (${jsx});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const renderVoucher = new Function('React','voucherDocument','company','voucherDetail','calendar','bsDate','adDate','money','amountInWords',functionBody);

export function fixtureHtml(count=3) {
  const company={name:'Sample Trading Enterprises',logo_url:''};
  const total=187392.42;
  const voucherDetail={voucher_type:'sale',sequence_no:3,voucher_date:'2026-11-07',fiscal_years:{label_bs:'2083/84'},parties:{name:'Sample Buyer',place:'Butwal',phone:'0000000000',tax_no:'123456789'},generator:{name:'Sample Accountant'},subtotal:total,discount_percent:0,discount_amount:0,tax_percent:0,tax_amount:0,total,narration:'Sample invoice for print layout testing only.',lines:Array.from({length:count},(_,index)=>({id:`item-${index+1}`,description:`Item ${index+1} - ${index%4===0?'Lubricating oil with a longer description to check wrapping':'Gear oil'}`,quantity:1,rate:index===count-1?total-(count-1)*1000:1000,amount:index===count-1?total-(count-1)*1000:1000,products:{sku:`SKU-${index+1}`,unit:'litre'}}))};
  const markup=renderToStaticMarkup(renderVoucher(React,null,company,voucherDetail,'BS',()=> '२१ कार्तिक २०८३',()=> '07 Nov 2026',value=>`Rs. ${Number(value).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`,amountInWords));
  return voucherPrintHtml(markup,'Sales Invoice #3');
}
