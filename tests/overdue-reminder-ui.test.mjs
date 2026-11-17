import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import {createRequire} from 'node:module';import {renderToStaticMarkup} from 'react-dom/server';import React from 'react';
const require=createRequire(import.meta.url);
const clientModule=ts.transpileModule(await readFile('lib/client-messaging.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const{smsCreditBlockReason}=await import(`data:text/javascript;base64,${Buffer.from(clientModule).toString('base64')}`);
async function render(file,values,props,creditState){let source=await readFile(file,'utf8');source=source.replace(/^import .*from .*;\n/gm,'').replace(/^import ".*\.css";\n/gm,'');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;let index=0;const mod={exports:{}};const initial=values[0];new Function('require','module','exports','useState','useRef','useEffect','formatBs','useSmsCredits','refreshSmsCredits','smsCreditBlockReason',compiled)(require,mod,mod.exports,()=>[values[index++],()=>{}],React.useRef,()=>{},x=>x,()=>creditState||({data:{wallet:initial?.wallet,service:initial?.providers?.sms},error:'',refreshing:false,refresh:()=>{}}),()=>{},smsCreditBlockReason);return renderToStaticMarkup(React.createElement(mod.exports.default,props));}
test('actual dashboard UI renders separate overdue and total balances with preview, zero-credit blocking and individual company branding',async()=>{
 const data={rows:[{partyId:'p',party:'AP Traders',phone:'9841000000',email:'',overdue:50000,total:100000,oldestOverdueDays:3,oldestDue:'2026-11-13',termText:'90 days',autoSms:true,autoEmail:false,message:'Dear AP Traders, overdue Rs. 50,000. From AG Manufacturing.',estimate:{encoding:'GSM-7',units:100,segments:1,credits:1}}],asOf:'2026-11-16',totalOverdue:50000,wallet:{balance:0,held:0,spent:7,chargeConfigured:true,enabled:true},smsAccepted:7,history:[],canSend:true,providers:{sms:{ready:true},email:{ready:false,reason:'Not configured'}},company:{name:'AG Manufacturing'}};
 const html=await render('app/overdue-reminders.tsx',[data,'',0,'p','',false,'','sms'],{refreshVersion:0,onOpenParty:()=>{}});
 assert.match(html,/Rs\. 50,000\.00/);assert.match(html,/Total outstanding Rs\. 1,00,000\.00/);assert.match(html,/From AG Manufacturing/);assert.match(html,/Insufficient SMS credits/);assert.match(html,/<button[^>]*disabled=""[^>]*>Send SMS reminder<\/button>/);assert.match(html,/View ledger/);assert.match(html,/7 SMS accepted from this company/);
});
test('actual platform UI provides audited top-ups and explicit uncertain-send resolution, not a free-form wallet overwrite',async()=>{
 const data={wallet:{balance:100,held:2,spent:8,enabled:true,credits_per_segment:1},ledger:[],pending:[{id:'d',channel:'sms',status:'unknown',recipient:'9841000000',company_id:'ag',credits:2,detail:'Timeout'}],canManage:true,provider:{ready:true}};
 const html=await render('app/platform-sms-credits.tsx',[true,data,'',false,''],{tenantId:'tenant'});
 assert.match(html,/Add SMS credits/);assert.match(html,/Remove available credits/);assert.match(html,/Payment reference \/ note/);assert.match(html,/confirmed provider outcome/i);assert.match(html,/I checked the provider records/);assert.match(html,/refund reserved credits/);
 assert.doesNotMatch(html,/name="balance"/);
});

test('composer explains a positive-but-disabled balance and uses newly synced credits to enable the same draft',async()=>{
 const partyId='p',text='Hello',draftKey=JSON.stringify([partyId,text]);
 const data={company:{name:'AG Manufacturing'},parties:[{id:'p',name:'AP Traders',phone:'9841000000'}]};
 const values=[true,data,'',partyId,'',text,{key:draftKey,credits:1,previewHash:'a'.repeat(64),message:'Hello\nFrom AG Manufacturing'},false,'',false,false,0];
 const synced=wallet=>({data:{wallet,service:{ready:true}},error:'',refreshing:false,refresh:()=>{}});
 const wallet={balance:200,spent:0,held:0,enabled:false,chargeConfigured:false};
 const html=await render('app/sms-composer.tsx',values,{companyId:'c',refreshVersion:0},synced(wallet));
 assert.match(html,/200 credits available/);assert.match(html,/SMS sending is disabled/);assert.match(html,/Refresh credits/);assert.match(html,/<button[^>]*disabled=""[^>]*>Send SMS<\/button>/);
 const ready=await render('app/sms-composer.tsx',values,{companyId:'c',refreshVersion:0},synced({...wallet,enabled:true,chargeConfigured:true}));
 assert.match(ready,/<button class="primary">Send SMS<\/button>/);assert.doesNotMatch(ready,/SMS sending is disabled/);
 const offline=await render('app/sms-composer.tsx',values,{companyId:'c',refreshVersion:0},{...synced({...wallet,enabled:true,chargeConfigured:true}),error:'Could not refresh credits'});
 assert.match(offline,/Could not refresh credits/);assert.match(offline,/<button[^>]*disabled=""[^>]*>Send SMS<\/button>/);
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
