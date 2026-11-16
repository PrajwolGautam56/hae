import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture,ids} from './support/overdue-reminders-db.mjs';
test('Postgres: paid credit audit, atomic reservations, retries, failure refunds, uncertain sends, 15-day recurrence and tenant isolation',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=await fixture(PGlite);
 try{
  const wallet=async(tenant=ids.tenant)=>(await db.query('select * from sms_credit_wallets where tenant_id=$1',[tenant])).rows[0];
  const manage=async(action,credits=0,key=randomUUID(),extra={})=>(await db.query('select manage_sms_credits($1,$2,$3,$4,$5,$6,$7,$8,$9) as v',[extra.tenant||ids.tenant,'operator@example.invalid',key,action,credits,extra.paid??null,extra.note||'Payment reference',extra.enabled??true,extra.rate??1])).rows[0].v;
  const key=randomUUID();await manage('topup',5,key);await manage('topup',5,key);assert.equal(Number((await wallet()).balance),5);
  await assert.rejects(manage('topup',6,key),/different values/);
  await assert.rejects(manage('topup',0),/Invalid top-up/);await assert.rejects(manage('topup',3,randomUUID(),{paid:'NaN'}),/Invalid top-up/);
  await manage('settings');
  const reserve=async({party=ids.party,company=ids.company,actor=ids.member,key=randomUUID(),auto=false,phone='+9779841000000',channel='sms',segments=2,cost=2}={})=>(await db.query('select reserve_overdue_reminder($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as v',[company,party,actor,key,channel,auto,phone,'Dear buyer, Rs. 50,000 overdue. From Hamro Afno Enterprises.',{overdue:50000},segments,cost])).rows[0].v;
  const finish=async(id,status,actor=null)=>(await db.query('select finish_overdue_reminder($1,$2,$3,$4,$5) as v',[id,status,status==='accepted'?'provider-ref':null,'Checked provider evidence',actor])).rows[0].v;
  await assert.rejects(reserve({actor:ids.staff}),/administrator/);await assert.rejects(reserve({actor:ids.otherMember}),/administrator/);await assert.rejects(reserve({party:ids.otherParty}),/does not belong/);
  await assert.rejects(reserve({cost:1}),/rate changed/);await assert.rejects(reserve({phone:'+9779841000009'}),/contact changed/);
  await assert.rejects(reserve({auto:true,actor:null}),/not enabled/);
  const firstKey=randomUUID(),first=await reserve({key:firstKey});assert.equal(first.created,true);assert.equal(Number((await wallet()).balance),3);assert.equal(Number((await wallet()).held),2);
  const repeated=await reserve({key:firstKey});assert.equal(repeated.created,false);assert.equal(repeated.delivery.id,first.delivery.id);
  await assert.rejects(reserve(),/pending confirmation/);
  await assert.rejects(finish(first.delivery.id,'failed','operator@example.invalid'),/still be processing/);
  await finish(first.delivery.id,'unknown');assert.equal(Number((await wallet()).held),2);
  await assert.rejects(finish(first.delivery.id,'failed'),/Platform review/);
  await finish(first.delivery.id,'failed','operator@example.invalid');await finish(first.delivery.id,'failed','operator@example.invalid');
  assert.equal(Number((await wallet()).balance),5);assert.equal(Number((await wallet()).held),0);
  const second=await reserve();await finish(second.delivery.id,'accepted');await finish(second.delivery.id,'accepted');
  assert.equal(Number((await wallet()).balance),3);assert.equal(Number((await wallet()).spent),2);
  await assert.rejects(reserve(),/cooldown/);
  await db.query('update parties set auto_overdue_sms=true where id=$1',[ids.party]);
  await db.query("update overdue_reminder_deliveries set completed_at=now()-interval '14 days' where id=$1",[second.delivery.id]);
  await assert.rejects(reserve({auto:true,actor:null}),/cooldown/);
  await db.query("update overdue_reminder_deliveries set completed_at=now()-interval '15 days' where id=$1",[second.delivery.id]);
  const third=await reserve({auto:true,actor:null});assert.equal(third.created,true);await finish(third.delivery.id,'accepted');
  assert.equal(Number((await wallet()).balance),1);assert.equal(Number((await wallet()).spent),4);
  await assert.rejects(reserve({party:ids.secondParty,phone:'+9779841000001'}),/Insufficient/);
  // Email uses no SMS credits, including a client with a zero-credit wallet.
  await db.query("update parties set email='buyer@example.invalid',auto_overdue_email=true where id=$1",[ids.party]);
  const email=await reserve({auto:true,actor:null,channel:'email',phone:'buyer@example.invalid',segments:0,cost:0});await finish(email.delivery.id,'accepted');assert.equal(Number((await wallet()).balance),1);
  const another=await reserve({company:ids.other,party:ids.otherParty,actor:ids.otherMember,phone:'+9779841000002'}).catch(error=>error);assert.match(another.message,/not enabled/);
  const claims=await db.query('select id from claim_overdue_reminder_parties(20)');assert.deepEqual(claims.rows.map(r=>r.id),[ids.party]);assert.equal((await db.query('select id from claim_overdue_reminder_parties(20)')).rows.length,0);
  await db.query("update parties set reminder_claim_until=now()-interval '1 minute' where id=$1",[ids.party]);assert.equal((await db.query('select id from claim_overdue_reminder_parties(20)')).rows.length,1);
  const total=(await wallet());assert.equal(Number(total.credited),Number(total.balance)+Number(total.held)+Number(total.spent));
  assert.deepEqual((await db.query('select debit::text,credit::text from ledger_entries order by id')).rows,[{debit:'100000',credit:'0'},{debit:'0',credit:'50000'}]);
  const permission=(await db.query("select has_function_privilege('authenticated','manage_sms_credits(uuid,text,uuid,text,bigint,numeric,text,boolean,integer)','EXECUTE') as fn,has_table_privilege('anon','sms_credit_wallets','SELECT') as tbl")).rows[0];assert.deepEqual(permission,{fn:false,tbl:false});
 }finally{await db.close();}
});

test('Postgres: party email/reminder preferences use profile revision and company role; ledger is untouched',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=await fixture(PGlite);
 try{
  const save=async(revision,actor=ids.member,email='buyer@example.invalid',sms=true,mail=true)=>(await db.query('select update_party_details_with_reminders($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as v',[ids.company,ids.party,actor,'AP Traders','Butwal','9841000000','123',revision,email,sms,mail])).rows[0].v;
  const first=await save(1);assert.equal(first.email,'buyer@example.invalid');assert.equal(first.auto_overdue_sms,true);assert.equal(first.auto_overdue_email,true);
  await assert.rejects(save(1),/Another user changed/);await assert.rejects(save(first.profile_revision,ids.otherMember),/administrator/);
  await assert.rejects(save(first.profile_revision,ids.member,null,true,true),/Email required/);
  const next=await save(first.profile_revision,ids.member,null,false,false);assert.equal(next.email,null);assert.equal(next.auto_overdue_sms,false);
  assert.equal(Number((await db.query('select count(*) from ledger_entries')).rows[0].count),2);
 }finally{await db.close();}
});

test('Postgres: two companies share one client wallet and concurrent one-credit reservations cannot overspend it',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=await fixture(PGlite);
 try{
  const siblingMember='30000000-0000-4000-8000-000000000004',siblingParty='40000000-0000-4000-8000-000000000004';
  await db.query("insert into team_members(id,company_id,role) values($1,$2,'admin')",[siblingMember,ids.sibling]);
  await db.query("insert into parties(id,company_id,name,phone) values($1,$2,'Sibling buyer','9841000003')",[siblingParty,ids.sibling]);
  await db.query('select manage_sms_credits($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ids.tenant,'operator',randomUUID(),'topup',1,null,'Paid',true,1]);
  await db.query('select manage_sms_credits($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ids.tenant,'operator',randomUUID(),'settings',0,null,'Confirmed rate',true,1]);
  const reserve=(company,party,actor,phone)=>db.query('select reserve_overdue_reminder($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as v',[company,party,actor,randomUUID(),'sms',false,phone,'Reminder from individual company',{overdue:10},1,1]);
  const outcomes=await Promise.allSettled([reserve(ids.company,ids.party,ids.member,'+9779841000000'),reserve(ids.sibling,siblingParty,siblingMember,'+9779841000003')]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
  const wallet=(await db.query('select balance,held,spent from sms_credit_wallets where tenant_id=$1',[ids.tenant])).rows[0];assert.deepEqual(wallet,{balance:0,held:1,spent:0});
 }finally{await db.close();}
});
