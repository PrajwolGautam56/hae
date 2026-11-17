import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import {createRequire} from 'node:module';import {renderToStaticMarkup} from 'react-dom/server';import React from 'react';
const require=createRequire(import.meta.url);
async function render(file,values,props){let source=await readFile(file,'utf8');source=source.replace(/^import .* from .*;\n/gm,'').replace(/^import ".*\.css";\n/gm,'');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;let index=0;const mod={exports:{}};new Function('require','module','exports','useState','useRef','useEffect','formatBs',compiled)(require,mod,mod.exports,()=>[values[index++],()=>{}],React.useRef,()=>{},x=>x);return renderToStaticMarkup(React.createElement(mod.exports.default,props));}
test('actual dashboard UI renders separate overdue and total balances with preview, zero-credit blocking and individual company branding',async()=>{
 const data={rows:[{partyId:'p',party:'AP Traders',phone:'9841000000',email:'',overdue:50000,total:100000,oldestOverdueDays:3,oldestDue:'2026-11-13',termText:'90 days',autoSms:true,autoEmail:false,message:'Dear AP Traders, overdue Rs. 50,000. From AG Manufacturing.',estimate:{encoding:'GSM-7',units:100,segments:1,credits:1}}],asOf:'2026-11-16',totalOverdue:50000,wallet:{balance:0,held:0,spent:7,credits_per_segment:1,enabled:true},smsAccepted:7,history:[],canSend:true,providers:{sms:{ready:true},email:{ready:false,reason:'Not configured'}},company:{name:'AG Manufacturing'}};
 const html=await render('app/overdue-reminders.tsx',[data,'',0,'p','',false,'','sms'],{refreshVersion:0,onOpenParty:()=>{}});
 assert.match(html,/Rs\. 50,000\.00/);assert.match(html,/Total outstanding Rs\. 1,00,000\.00/);assert.match(html,/From AG Manufacturing/);assert.match(html,/Insufficient SMS credits/);assert.match(html,/<button[^>]*disabled=""[^>]*>Send SMS reminder<\/button>/);assert.match(html,/View ledger/);assert.match(html,/7 SMS accepted from this company/);
});
test('actual platform UI provides audited top-ups and explicit uncertain-send resolution, not a free-form wallet overwrite',async()=>{
 const data={wallet:{balance:100,held:2,spent:8,enabled:true,credits_per_segment:1},ledger:[],pending:[{id:'d',channel:'sms',status:'unknown',recipient:'9841000000',company_id:'ag',credits:2,detail:'Timeout'}],canManage:true,provider:{ready:true}};
 const html=await render('app/platform-sms-credits.tsx',[true,data,'',false,''],{tenantId:'tenant'});
 assert.match(html,/Add SMS credits/);assert.match(html,/Remove available credits/);assert.match(html,/Payment reference \/ note/);assert.match(html,/confirmed provider outcome/i);assert.match(html,/I checked the provider records/);assert.match(html,/refund reserved credits/);
 assert.doesNotMatch(html,/name="balance"/);
});

test('cron route requires its own strong secret, never falls back to a logged-in staff cookie, and stays inert when disabled',async()=>{
 const adapter=`data:text/javascript;base64,${Buffer.from(`export const state={runs:0};export const NextResponse={json:(body,options)=>new Response(JSON.stringify(body),options)};export const getUnifiedAdmin=()=>({});export const getControlAdmin=()=>({});export const loadMessagingRuntime=async()=>{};export const messagingValue=key=>process.env[key];export const runOverdueReminderWorker=async()=>{state.runs++;return{checked:1}};`).toString('base64')}`;
 let compiled=ts.transpileModule(await readFile('app/api/cron/overdue-reminders/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
 compiled=compiled.replace(/from "([^"]+)"/g,(all,name)=>name==='node:crypto'?all:`from "${adapter}"`);
 const {GET}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`),{state}=await import(adapter);
 const old=process.env.CRON_SECRET,enabled=process.env.OVERDUE_REMINDERS_ENABLED;
 try{
  delete process.env.CRON_SECRET;
  const call=token=>GET(new Request('https://app.example.invalid/api/cron/overdue-reminders',{headers:token?{Authorization:token}:{cookie:'hae_access_token=fake'}}));
  assert.equal((await call()).status,401);process.env.CRON_SECRET='short';assert.equal((await call('Bearer short')).status,401);
  process.env.CRON_SECRET='x'.repeat(40);assert.equal((await call('Bearer wrong')).status,401);assert.equal((await call('Bearer '+'é'.repeat(40))).status,401);
  process.env.OVERDUE_REMINDERS_ENABLED='false';assert.equal((await call('Bearer '+'x'.repeat(40))).status,200);assert.equal(state.runs,0);
  process.env.OVERDUE_REMINDERS_ENABLED='true';assert.equal((await call('Bearer '+'x'.repeat(40))).status,200);assert.equal(state.runs,1);
 }finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;if(enabled===undefined)delete process.env.OVERDUE_REMINDERS_ENABLED;else process.env.OVERDUE_REMINDERS_ENABLED=enabled;}
});
