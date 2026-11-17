import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import {maintenanceConnection} from './supabase-maintenance-connection.mjs';

const env={...Object.fromEntries((await readFile('.env.local','utf8')).split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]})),...process.env};
const ref=new URL(env.UNIFIED_SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(ref!=='qwxbacfnmumibihffdoj')throw new Error('Refusing to release outside the approved HAE business project');
const mode=process.argv[2];
if(!['inspect','dry-run','apply'].includes(mode))throw new Error('Use inspect, dry-run, or apply <verified-backup-directory>');
const manual=process.argv.includes('--manual-sms');
const runtime=process.argv.includes('--runtime');
const version=runtime?'202611170002':manual?'202611170001':'202611160001',name=runtime?'private_messaging_runtime':manual?'manual_sms_and_credit_adjustments':'overdue_reminders_and_sms_credits';
const sql=await readFile(`supabase/migrations/${version}_${name}.sql`,'utf8');
const db=new pg.Client(await maintenanceConnection(env,ref));
const newColumns=['email','auto_overdue_sms','auto_overdue_email','reminder_checked_at','reminder_claim_until'];
const newTables=['sms_credit_wallets','sms_credit_ledger','overdue_reminder_deliveries'];
const signatures=[
  'update_party_details_with_reminders(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,boolean)',
  'manage_sms_credits(uuid,text,uuid,text,bigint,numeric,text,boolean,integer)',
  'reserve_overdue_reminder(uuid,uuid,uuid,uuid,text,boolean,text,text,jsonb,integer,bigint)',
  'finish_overdue_reminder(uuid,text,text,text,text)',
  'claim_overdue_reminder_parties(integer)',
  ...(runtime?['get_messaging_runtime_config()']:[]),
];
async function backupCheck(directory){
  if(!directory)throw new Error('Apply requires a verified backup directory');
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  const age=Date.now()-Date.parse(manifest.createdAt);
  if(manifest.projectRef!==ref||manifest.schema!=='public'||!Number.isFinite(age)||age<0||age>4*3600000)throw new Error('HAE backup must be less than four hours old');
  if(!manifest.functions?.length||!manifest.triggers?.length)throw new Error('Backup lacks functions/triggers');
  for(const table of manifest.tables){
    if(path.basename(table.file)!==table.file)throw new Error('Invalid backup file');
    const data=await readFile(path.join(directory,table.file));
    if(createHash('sha256').update(data).digest('hex')!==table.sha256||JSON.parse(data).length!==table.rows)throw new Error(`Backup checksum failed for ${table.name}`);
  }
  for(const table of ['companies','parties','vouchers','voucher_lines','ledger_entries','journal_entries','journal_lines','party_opening_balances','stock_movements','voucher_sequences'])if(!manifest.tables.some(t=>t.name===table))throw new Error(`Backup lacks ${table}`);
  console.log(JSON.stringify({backupVerified:true,tables:manifest.tables.length,rows:manifest.tables.reduce((n,t)=>n+t.rows,0)}));
}
async function fingerprints(tables){
  const queries=tables.map((table,i)=>{
    if(!/^[a-zA-Z0-9_]+$/.test(table))throw new Error('Unsupported table identifier');
    return `select '${table}' as name,count(*)::text as rows,md5(coalesce(string_agg((to_jsonb(t)-$${i+1}::text[])::text,E'\n' order by (to_jsonb(t)-$${i+1}::text[])::text),'')) as hash from public."${table}" t`;
  });
  return(await db.query(queries.join(' union all '),tables.map(table=>runtime?[]:manual?(table==='overdue_reminder_deliveries'?['purpose']:[]):(table==='parties'?newColumns:[])))).rows.sort((a,b)=>a.name.localeCompare(b.name));
}
async function verify(){
  const tables=await db.query(`select c.relname,c.relrowsecurity,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
    has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as user_access
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`,[newTables]);
  if(tables.rows.length!==3||tables.rows.some(t=>!t.relrowsecurity||t.anon_access||t.user_access))throw new Error('Reminder table RLS/grants verification failed');
  for(const signature of signatures){
    const result=await db.query("select to_regprocedure($1) is not null as present,has_function_privilege('anon',$1,'EXECUTE') as anon_access,has_function_privilege('authenticated',$1,'EXECUTE') as user_access,has_function_privilege('service_role',$1,'EXECUTE') as server_access",['public.'+signature]);
    const row=result.rows[0];if(!row.present||row.anon_access||row.user_access||!row.server_access)throw new Error('Reminder function privileges verification failed');
  }
  if(manual&&!(await db.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='overdue_reminder_deliveries' and column_name='purpose') as present")).rows[0].present)throw new Error('Manual SMS capability missing');
  const preferences=await db.query('select count(*)::int as opted_in from public.parties where auto_overdue_sms or auto_overdue_email');
  const reminders=await db.query('select count(*)::int as reminders from public.overdue_reminder_deliveries');
  console.log(JSON.stringify({tablesSecured:3,serverOnlyFunctions:signatures.length,optedInParties:preferences.rows[0].opted_in,recordedReminders:reminders.rows[0].reminders}));
}
try{
  await db.connect();
  const history=await db.query('select version from supabase_migrations.schema_migrations where version=$1',[version]);
  console.log(JSON.stringify({project:ref,mode,migration:version,alreadyApplied:Boolean(history.rowCount)}));
  if(mode==='inspect'){if(history.rowCount)await verify();}
  else if(history.rowCount){await verify();console.log('Already applied; no changes made');}
  else {
    if(mode==='apply')await backupCheck(process.argv[3]);
    await db.query('begin isolation level repeatable read');
    try{
      await db.query("set local lock_timeout='5s'");await db.query("set local statement_timeout='45s'");
      const locked=await db.query("select pg_try_advisory_xact_lock(hashtextextended('hae-overdue-reminder-release',0)) as acquired");if(!locked.rows[0].acquired)throw new Error('Another reminder release is running');
      const tables=(await db.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(r=>r.table_name);
      const before=await fingerprints(tables);
      await db.query(sql);
      await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[version,name,[sql]]);
      await verify();
      if(!runtime&&!manual&&(await db.query('select count(*)::int as n from public.parties where auto_overdue_sms or auto_overdue_email')).rows[0].n!==0)throw new Error('Migration unexpectedly enabled notifications');
      if(JSON.stringify(before)!==JSON.stringify(await fingerprints(tables)))throw new Error('Existing data changed; rolling back');
      console.log(JSON.stringify({existingTablesUnchanged:tables.length,existingRows:before.reduce((n,t)=>n+Number(t.rows),0),financialDataUnchanged:true}));
      if(mode==='dry-run'){await db.query('rollback');console.log('Dry-run passed; all DDL/history changes rolled back');}
      else {await db.query("notify pgrst, 'reload schema'");await db.query('commit');console.log('Approved migration committed; schema reload requested');}
    }catch(error){await db.query('rollback').catch(()=>{});throw error;}
  }
}catch(error){console.error('Reminder release stopped:',error.code||error.name,String(error.message).replaceAll(env.SUPABASE_DB_PASSWORD||'___','[redacted]'));process.exitCode=1;}
finally{await db.end().catch(()=>{});}
