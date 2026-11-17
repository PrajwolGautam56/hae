import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import ts from'typescript';import{randomUUID}from'node:crypto';import{fixture,ids}from'./support/overdue-reminders-db.mjs';
const source=ts.transpileModule(await readFile('lib/client-messaging.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {clientWallet,clientDelivery,clientAvailability,clientMessageError,manualMessage}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('client-facing contracts hide vendor identity, private tariffs, purchase cost and provider IDs',()=>{
 const wallet=clientWallet({balance:100,spent:20,held:2,enabled:true,credits_per_segment:3,providerCost:0.5,paid_amount:2000});assert.deepEqual(wallet,{balance:100,spent:20,held:2,enabled:true,chargeConfigured:true,updatedAt:null});
 const delivery=clientDelivery({id:'id',status:'accepted',credits:2,provider_id:'private-shoot-id',detail:'SMS Pasal accepted'});
 assert.doesNotMatch(JSON.stringify(delivery),/SMS Pasal|private-shoot-id|credits_per_segment|provider_id/);
 assert.equal(clientAvailability({ready:false,reason:'Resend API key missing'}).reason,'Messaging is not active yet. Contact your administrator.');
 assert.doesNotMatch(clientMessageError(new Error('SMS Pasal route configuration failed')),/SMS Pasal|route|API/);
 assert.equal(clientMessageError(new Error('Insufficient SMS credits')),'Insufficient SMS credits');
});
test('custom messages keep the user text, append the selected company, and enforce the final 720-character limit',()=>{
 const message=manualMessage({id:'c',name:'AG Manufacturing'},{id:'p',phone:'9841000000'},'  Please confirm your order.  ');
 assert.equal(message.message,'Please confirm your order.\nFrom AG Manufacturing');assert.equal(message.purpose,'manual');assert.equal(message.partyId,'p');assert.equal(message.companyId,'c');
 assert.throws(()=>manualMessage({id:'c',name:'Company'},{id:'p'},''));assert.throws(()=>manualMessage({id:'c',name:'Company'},{id:'p'},'a'.repeat(720)),/company name/);
});
test('Postgres: complimentary/paid credits can be added and subtracted without touching held/spent balances; custom SMS needs no overdue debt',{skip:!process.env.PGLITE_MODULE},async()=>{
 const{PGlite}=await import(process.env.PGLITE_MODULE);const db=await fixture(PGlite,true);
 try{
 const manage=async(action,amount,key=randomUUID())=>(await db.query('select manage_sms_credits($1,$2,$3,$4,$5,$6,$7,$8,$9) as v',[ids.tenant,'operator',key,action,amount,null,'Manual client allowance',true,1])).rows[0].v;
 await manage('topup',20);await manage('settings',0);
 const reserve=async(snapshot,auto=false,key=randomUUID())=>(await db.query('select reserve_overdue_reminder($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as v',[ids.company,ids.party,auto?null:ids.member,key,'sms',auto,'+9779841000000','Hello buyer. From Hamro Afno Enterprises.',snapshot,2,2])).rows[0].v;
 const m=await reserve({purpose:'manual'});assert.equal(m.created,true);assert.equal(m.delivery.purpose,'manual');
 await assert.rejects(reserve({purpose:'manual'},true),/Invalid manual/);
 await assert.rejects(manage('adjustment',-19),/Cannot remove/);
 const key=randomUUID();await manage('adjustment',-10,key);const replay=await manage('adjustment',-10,key);assert.equal(replay.balance,8);assert.equal(replay.held,2);assert.equal(replay.credited,10);
 await db.query('select finish_overdue_reminder($1,$2,$3,$4)',[m.delivery.id,'failed',null,'Explicit rejection']);
 const wallet=(await db.query('select balance,held,spent,credited from sms_credit_wallets')).rows[0];assert.deepEqual(wallet,{balance:10,held:0,spent:0,credited:10});
 // Generic order messages do not postpone the separate overdue reminder schedule.
 await db.query("insert into overdue_reminder_deliveries(tenant_id,company_id,party_id,request_id,channel,automatic,recipient,message,snapshot,segments,credits,status,completed_at,purpose) values($1,$2,$3,$4,'sms',false,'+9779841000000','Generic greeting','{}',0,0,'accepted',now(),'manual')",[ids.tenant,ids.company,ids.party,randomUUID()]);
 await db.query('update parties set auto_overdue_sms=true where id=$1',[ids.party]);assert.equal((await reserve({overdue:10},true)).created,true);
 assert.equal(Number((await db.query('select count(*) from ledger_entries')).rows[0].count),2);
 }finally{await db.close();}
});
test('manual composer re-quotes on text changes and exposes only charge/balance to the client',async()=>{
 const source=await readFile('app/sms-composer.tsx','utf8'),route=await readFile('app/api/sms/route.ts','utf8');assert.match(source,/This message uses/);assert.match(source,/draftKey/);assert.match(source,/Check send status/);assert.doesNotMatch(source,/SMS Pasal|Resend|credits_per_segment|providerCost/);
 assert.match(route,/getBusinessContext\(db\)/);assert.match(route,/eq\("company_id",company.id\)/);assert.match(route,/clientDelivery\(delivery\)/);assert.doesNotMatch(route,/body.companyId|body.phone|body.tenantId/);
});
