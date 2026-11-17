import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {fixture,ids} from './support/overdue-reminders-db.mjs';
import {randomUUID} from 'node:crypto';
const compile=async file=>ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {clientWallet,smsCreditBlockReason}=await import(url(await compile('lib/client-messaging.ts')));

test('200 credited but disabled/unconfigured is explained; enabled credits allow a quoted message, not wholesale metadata',()=>{
 const saved=clientWallet({balance:200,enabled:false,credits_per_segment:null});
 assert.match(smsCreditBlockReason(saved,{ready:true}),/sending is disabled/i);
 assert.match(smsCreditBlockReason({...saved,enabled:true},{ready:true}),/set the message credit charge/i);
 const ready=clientWallet({balance:200,enabled:true,credits_per_segment:1,updated_at:'revision'});
 assert.equal(smsCreditBlockReason(ready,{ready:true},2),'');
 assert.match(smsCreditBlockReason(ready,{ready:true},201),/Insufficient/);
 assert.match(smsCreditBlockReason(ready,{ready:false,reason:'Messaging is unavailable'},2),/unavailable/);
 assert.equal(ready.updatedAt,'revision');assert.doesNotMatch(JSON.stringify(ready),/credits_per_segment|provider|paid_amount/);
});

test('wallet endpoint resolves tenant only from authenticated company; never accepts a client-chosen tenant',async()=>{
 const adapter=url(`export const calls=[];export const NextResponse={json:(body,options)=>new Response(JSON.stringify(body),options)};export const getSupabaseAdmin=()=>({});export const getBusinessContext=async()=>({company:{id:'company-a',organization_id:'tenant-a'}});export const requireFeature=async()=>{};export const loadMessagingRuntime=async()=>{};export const clientMessageError=e=>e.message;export const readSmsWallet=async(db,tenant)=>{calls.push(tenant);return{balance:200}};export const publicSmsCreditState=(companyId,wallet)=>({companyId,wallet});`);
 const source=(await compile('app/api/sms/wallet/route.ts')).replace(/from "[^"]+"/g,`from "${adapter}"`);
 const {GET}=await import(url(source));const response=await GET(new Request('https://example.invalid/api/sms/wallet?tenantId=attacker'));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await response.json(),{companyId:'company-a',wallet:{balance:200}});
 assert.deepEqual((await import(adapter)).calls,['tenant-a']);
});

test('credit polling updates open dashboard after top-up, on focus/visibility and explicit refresh, and aborts stale responses',async()=>{
 const old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
 const events=new EventTarget(),documentEvents=new EventTarget();let interval,cleared=false,fetches=0,balance=0,cleanup;
 globalThis.window={setInterval:(fn,delay)=>{assert.equal(delay,15000);interval=fn;return 42;},clearInterval:id=>{assert.equal(id,42);cleared=true;},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)};
 globalThis.document={visibilityState:'visible',addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents)};
 const adapter=url(`export const state={values:[],effect:null};export const useState=initial=>{const i=state.values.length;state.values.push(initial);return[initial,v=>state.values[i]=v]};export const useRef=initial=>({current:initial});export const useCallback=fn=>fn;export const useEffect=fn=>{state.effect=fn;};`);
 const module=await import(url((await compile('app/use-sms-credits.ts')).replace(/from "react"/,`from "${adapter}"`))),{state}=await import(adapter);
 const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};
 try{
   globalThis.fetch=async(path,options)=>{fetches++;assert.equal(path,'/api/sms/wallet');assert.equal(options.cache,'no-store');return Response.json({companyId:'company-a',wallet:{balance}});};
   module.useSmsCredits('company-a',0);cleanup=state.effect();await flush();assert.equal(state.values[0].wallet.balance,0);
   balance=200;interval();await flush();assert.equal(state.values[0].wallet.balance,200);
   balance=210;events.dispatchEvent(new Event('focus'));await flush();assert.equal(state.values[0].wallet.balance,210);
   globalThis.document.visibilityState='hidden';const previous=fetches;interval();await flush();assert.equal(fetches,previous);
   globalThis.document.visibilityState='visible';balance=220;documentEvents.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(state.values[0].wallet.balance,220);
   balance=230;module.refreshSmsCredits();await flush();assert.equal(state.values[0].wallet.balance,230);
   globalThis.fetch=async()=>{throw new Error('Temporary network error');};interval();await flush();assert.match(state.values[1],/network/);assert.equal(state.values[0].wallet.balance,230);
   globalThis.fetch=async()=>Response.json({companyId:'other-company',wallet:{balance:999}});interval();await flush();assert.match(state.values[1],/Company changed/);assert.equal(state.values[0].wallet.balance,230);
   let first;globalThis.fetch=()=>new Promise(resolve=>{first=resolve;});interval();
   globalThis.fetch=async()=>Response.json({companyId:'company-a',wallet:{balance:250}});interval();await flush();first(Response.json({companyId:'company-a',wallet:{balance:240}}));await flush();assert.equal(state.values[0].wallet.balance,250);assert.equal(state.values[1],'');
   cleanup();cleanup=null;assert.equal(cleared,true);const end=fetches;events.dispatchEvent(new Event('focus'));await flush();assert.equal(fetches,end);
 }finally{cleanup?.();for(const[key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('activation after top-up preserves all 200 credits and financial records; missing activation cannot reserve',{skip:!process.env.PGLITE_MODULE},async()=>{
 const{PGlite}=await import(process.env.PGLITE_MODULE),db=await fixture(PGlite,true);
 try{
   const manage=(action,amount,enabled=false,rate=null)=>db.query('select manage_sms_credits($1,$2,$3,$4,$5,$6,$7,$8,$9) as v',[ids.tenant,'support:user-authorized',randomUUID(),action,amount,null,'SMS activation',enabled,rate]);
   await manage('topup',200);
   const reserve=()=>db.query('select reserve_overdue_reminder($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as v',[ids.company,ids.party,ids.member,randomUUID(),'sms',false,'+9779841000000','Test from company',{purpose:'manual'},1,1]);
   await assert.rejects(reserve(),/not enabled/);
   const result=(await manage('settings',0,true,1)).rows[0].v;
   assert.equal(result.balance,200);assert.equal(result.held,0);assert.equal(result.spent,0);assert.equal(result.enabled,true);
   assert.equal((await reserve()).rows[0].v.created,true);
   assert.equal((await db.query('select count(*)::int n from ledger_entries')).rows[0].n,2);
 }finally{await db.close();}
});
