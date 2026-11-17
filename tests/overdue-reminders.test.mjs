import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';import ts from 'typescript';import {randomUUID} from 'node:crypto';
async function moduleUrl(file){let js=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;for(const match of [...js.matchAll(/from ["'](\.[^"']+)["']/g)])js=js.replace(match[0],`from "${await moduleUrl(path.resolve(path.dirname(file),match[1]+'.ts'))}"`);return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;}
const {smsEstimate,smsPhone,partyNotificationInput,reminderSnapshot}=await import(await moduleUrl(path.resolve('lib/overdue-reminder-model.ts')));
const {ageParty}=await import(await moduleUrl(path.resolve('lib/accounting-report-model.ts')));
const {deliverOverdueReminder,reminderPreview}=await import(await moduleUrl(path.resolve('lib/overdue-reminder-service.ts')));
const {sendReminderProvider,smsPasalOutcome,reminderProviderReady}=await import(await moduleUrl(path.resolve('lib/overdue-reminder-provider.ts')));
const {reminderTenantAllowed}=await import(await moduleUrl(path.resolve('lib/overdue-reminder-worker.ts')));

test('SMS estimates count GSM extensions and Unicode multipart units, not raw character count',()=>{
 for(const [text,segments] of [['a'.repeat(160),1],['a'.repeat(161),2],['a'.repeat(306),2],['a'.repeat(307),3],['€'.repeat(80),1],['€'.repeat(81),2],['क'.repeat(70),1],['क'.repeat(71),2],['😀'.repeat(35),1],['😀'.repeat(36),2]])assert.equal(smsEstimate(text,1).segments,segments);
 assert.equal(smsEstimate('a'.repeat(161),3).credits,6);assert.equal(smsEstimate('test',null).credits,null);assert.equal(smsEstimate('',1).segments,0);
});

test('reminder is based only on unpaid overdue debt after FIFO receipts, with the individual company and actual due term',()=>{
 const entry=(id,date,debit,credit,due)=>({id,entry_date:date,created_at:date,voucher_id:id,voucher_no:id,voucher_date:date,debit,credit,due_date:due});
 const ageing=ageParty(0,[entry('1','2026-08-01',100000,0,'2026-10-30'),entry('2','2026-09-01',50000,0,'2026-11-30'),entry('receipt','2026-11-01',0,50000)],'2026-11-02');
 const row=reminderSnapshot({id:'ag',name:'AG Manufacturing'},{id:'party',name:'AP Traders',phone:'9841000000'},ageing,'2026-11-02');
 assert.equal(row.total,100000);assert.equal(row.overdue,50000);assert.equal(row.oldestOverdueDays,3);assert.equal(row.termText,'90 days');
 assert.match(row.message,/Dear AP Traders/);assert.match(row.message,/overdue amount is Rs\. 50,000\.00/);assert.match(row.message,/From AG Manufacturing/);assert.doesNotMatch(row.message,/Hamro Business Group|1,00,000/);
 assert.equal(reminderSnapshot({id:'c',name:'C'},{id:'p'},ageParty(500,[],'2026-11-02'),'2026-11-02'),null,'Unknown opening dates must not generate overdue messages');
 assert.equal(reminderSnapshot({id:'c',name:'C'},{id:'p'},ageParty(0,[entry('1','2026-11-02',50,0,'2026-11-02')],'2026-11-02'),'2026-11-02'),null,'Due today is not overdue');
});

test('party opt-ins require a valid mobile/email; missing contact stays optional when reminders are off',()=>{
 assert.equal(smsPhone('+977 9841-000000'),'+9779841000000');assert.equal(smsPhone('009779841000000'),'+9779841000000');
 for(const phone of ['','071438662','9841000000,9841000001','+919841000000'])assert.throws(()=>smsPhone(phone));
 assert.deepEqual(partyNotificationInput({}),{email:'',autoSms:false,autoEmail:false});
 assert.equal(partyNotificationInput({email:' BUYER@EXAMPLE.COM ',autoOverdueEmail:true}).email,'buyer@example.com');
 assert.throws(()=>partyNotificationInput({autoOverdueSms:true}));assert.throws(()=>partyNotificationInput({autoOverdueEmail:true}));assert.throws(()=>partyNotificationInput({email:'bad'}));
});

test('SMS Pasal parser distinguishes accepted, definite ERR and uncertain responses without exposing response secrets',()=>{
 assert.equal(smsPasalOutcome('SMS-SHOOT-ID/abc123',200).status,'accepted');assert.equal(smsPasalOutcome('SMS-SHOOT-ID/{abc123}',200).providerId,'abc123');
 assert.equal(smsPasalOutcome('ERR: INVALID API KEY secret',200).status,'failed');assert.doesNotMatch(smsPasalOutcome('ERR: INVALID API KEY secret',200).detail,/secret/);
 for(const [body,status] of [['ERR: timeout',503],['<html>gateway</html>',200],['SMS-SHOOT-ID/',200],['{}',200],['SMS-SHOOT-ID/abc',500]])assert.equal(smsPasalOutcome(body,status).status,'unknown');
});

test('provider uses SMS Pasal POST, strips country prefix, selects Unicode when needed and never automatically retries timeouts',async()=>{
 const keys=['OVERDUE_REMINDERS_ENABLED','SMSPASAL_API_KEY','SMSPASAL_SENDER_ID','SMSPASAL_ROUTE_ID','SMSPASAL_BILLING_CONFIRMED','RESEND_API_KEY','RESEND_FROM_EMAIL'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const originalFetch=globalThis.fetch;
 try{
  Object.assign(process.env,{OVERDUE_REMINDERS_ENABLED:'true',SMSPASAL_API_KEY:'test-key-never-real',SMSPASAL_SENDER_ID:'TN_ALERT',SMSPASAL_ROUTE_ID:'10305',SMSPASAL_BILLING_CONFIRMED:'true',RESEND_API_KEY:'test-email-key',RESEND_FROM_EMAIL:'Kritech Global <notify@example.invalid>'});
  let count=0;globalThis.fetch=async(url,options)=>{count++;assert.equal(url,'https://sms.smspasal.com/smsapi/index.php');assert.equal(options.method,'POST');const form=new URLSearchParams(options.body);assert.equal(form.get('key'),'test-key-never-real');assert.equal(form.get('contacts'),'9841000000');assert.equal(form.get('senderid'),'TN_ALERT');assert.equal(form.get('type'),'unicode');return new Response('SMS-SHOOT-ID/test123');};
  assert.equal((await sendReminderProvider('sms',{id:randomUUID(),recipient:'+9779841000000',message:'प्रिय ग्राहक',companyName:'AG'})).status,'accepted');assert.equal(count,1);
  globalThis.fetch=async()=>{count++;throw new Error('timeout');};assert.equal((await sendReminderProvider('sms',{id:randomUUID(),recipient:'+9779841000000',message:'Dear buyer',companyName:'AG'})).status,'unknown');assert.equal(count,2);
  globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.from,'AG Manufacturing <notify@example.invalid>');assert.equal(options.headers['Idempotency-Key'],'overdue-reminder/test-id');return Response.json({id:'email-id'});};
  assert.equal((await sendReminderProvider('email',{id:'test-id',recipient:'buyer@example.invalid',message:'From AG Manufacturing',companyName:'AG Manufacturing'})).status,'accepted');
  process.env.OVERDUE_REMINDERS_ENABLED='false';assert.equal(reminderProviderReady('sms').ready,false);
 }finally{globalThis.fetch=originalFetch;for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

test('paid sends reserve before calling provider; ambiguous retries cannot call the provider twice or bypass updated previews',async()=>{
 const company={id:'company',name:'AG Manufacturing'},row={partyId:'party',phone:'9841000000',email:'buyer@example.invalid',message:'Rs. 50 overdue. From AG Manufacturing.',overdue:50,total:100,asOf:'2026-11-16'},wallet={enabled:true,credits_per_segment:1};
 const events=[];let reserved=false;let finalized=false;
 const db={async rpc(name,args){events.push(name);if(name==='reserve_overdue_reminder'){const created=!reserved;reserved=true;return{data:{created,delivery:{id:'delivery',status:finalized?'accepted':'reserved'}},error:null};}finalized=true;return{data:{id:'delivery',status:args.p_status},error:null};}};
 const provider=async()=>{events.push('provider');return{status:'accepted',providerId:'shoot-id',detail:'Accepted'};};
 const input={channel:'sms',requestId:randomUUID(),actorId:'member',automatic:false,previewHash:reminderPreview(row,wallet).previewHash,expectedCredits:1};
 await deliverOverdueReminder(db,company,row,wallet,input,provider);await deliverOverdueReminder(db,company,row,wallet,input,provider);
 assert.equal(events.filter(e=>e==='provider').length,1);assert.equal(events[0],'reserve_overdue_reminder');assert.equal(events[1],'provider');
 await assert.rejects(deliverOverdueReminder(db,company,{...row,message:'Changed'},wallet,input,provider),/changed/);
  await assert.rejects(deliverOverdueReminder(db,company,{...row,phone:'9841000001'},wallet,input,provider),/contact or reminder changed/);
 await assert.rejects(deliverOverdueReminder(db,company,row,wallet,{...input,expectedCredits:2},provider),/cost changed/);
 const failingDb={async rpc(name){return name==='reserve_overdue_reminder'?{data:{created:true,delivery:{id:'unconfirmed',status:'reserved'}}}:{error:new Error('DB unavailable')};}};
 const result=await deliverOverdueReminder(failingDb,company,row,wallet,input,provider);assert.equal(result.status,'reserved');assert.match(result.detail,/Do not resend/);
});

test('scheduler subscription checks fail closed for suspended, expired, unlinked or disabled clients',async()=>{
 const tables={platform_tenants:{id:'t',active:true,status:'active'},platform_subscriptions:{status:'active',expires_on:'2026-12-01'},platform_entitlements:{enabled:true},platform_companies:{login_enabled:true,status:'active'}};
 const db={from(table){const q={select(){return q;},eq(){return q;},async maybeSingle(){return{data:tables[table],error:null};}};return q;}};
 assert.equal(await reminderTenantAllowed(db,{id:'c',organization_id:'t'},'2026-11-16'),true);
 for(const [table,field,value] of [['platform_tenants','active',false],['platform_tenants','status','suspended'],['platform_subscriptions','expires_on','2026-11-15'],['platform_entitlements','enabled',false],['platform_companies','login_enabled',false]]){const old=tables[table][field];tables[table][field]=value;assert.equal(await reminderTenantAllowed(db,{id:'c',organization_id:'t'},'2026-11-16'),false);tables[table][field]=old;}
});

test('paid-credit routes use platform auth; business routes derive tenant/company and never accept browser credit mutations',async()=>{
 const admin=await readFile('app/api/platform/sms/route.ts','utf8'),client=await readFile('app/api/overdue-reminders/route.ts','utf8'),cron=await readFile('app/api/cron/overdue-reminders/route.ts','utf8');
 assert.match(admin,/authorizePlatformAdmin\(request\)/);assert.match(admin,/canManage\(admin\)/);assert.match(admin,/eq\("tenant_id", tenant.id\)/);
 assert.match(client,/getBusinessContext\(db\)/);assert.match(client,/eq\("tenant_id", company.organization_id\)/);assert.match(client,/Only an administrator, manager or accountant/);assert.doesNotMatch(client,/manage_sms_credits|body.tenantId|body.companyId/);
 assert.match(cron,/timingSafeEqual/);assert.match(cron,/expected.length < 32/);assert.match(cron,/OVERDUE_REMINDERS_ENABLED/);assert.match(cron,/loadMessagingRuntime/);
 const widget=await readFile('app/overdue-reminders.tsx','utf8');assert.match(widget,/smsCreditBlockReason/);assert.match(widget,/refreshVersion/);assert.match(widget,/Send acceptance is not proof of delivery/);
});
