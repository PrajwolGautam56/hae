import{readFile}from'node:fs/promises';
import{randomBytes}from'node:crypto';
import pg from'pg';
import{maintenanceConnection}from'./supabase-maintenance-connection.mjs';
const parse=text=>Object.fromEntries(text.split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const env={...parse(await readFile('.env.local','utf8')),...parse(await readFile('.env.messaging.local','utf8').catch(()=>'')),...process.env};
const ref=new URL(env.UNIFIED_SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(ref!=='qwxbacfnmumibihffdoj')throw new Error('Unexpected business project');
env.SUPABASE_DB_POOLER_HOST ||= 'aws-1-ap-northeast-2.pooler.supabase.com';
const mode=process.argv[2],url='https://hamro.kritechglobal.com/api/cron/overdue-reminders';
if(!['vault','probe','schedule','status'].includes(mode))throw new Error('Choose vault, probe, schedule or status');
const db=new pg.Client(await maintenanceConnection(env,ref));
let cronSecret='';
async function probe(){
  const opted=(await db.query('select count(*)::int as n from public.parties where auto_overdue_sms or auto_overdue_email')).rows[0].n;
  if(opted!==0)throw new Error('Safe no-send probe requires zero opted-in parties; run a reviewed delivery test instead');
  const secret=(await db.query("select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET'")).rows[0]?.decrypted_secret;
  if(!secret)throw new Error('Scheduler secret is not configured');cronSecret=secret;
  const response=await fetch(url,{headers:{Authorization:`Bearer ${secret}`},redirect:'error',signal:AbortSignal.timeout(55000)});
  const body=await response.json().catch(()=>null);
  if(response.status!==200||body?.disabled||typeof body?.claimed!=='number')throw new Error(`Worker not ready (HTTP ${response.status}); deploy runtime-aware code and check explicit environment overrides`);
  if(body.claimed!==0||body.accepted!==0)throw new Error('Unexpected work in no-send probe');
  console.log(JSON.stringify({workerAuthenticated:true,workerEnabled:true,claimed:body.claimed,messagesSent:0}));
}
try{
 await db.connect();
 if(mode==='vault'){
  if(!env.SMSPASAL_API_KEY)throw new Error('Supply the provided SMS key through the ignored local messaging environment file');
  await db.query('begin');
  try{
   await db.query("select pg_advisory_xact_lock(hashtextextended('hae-messaging-runtime-setup',0))");
   cronSecret=(await db.query("select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET'")).rows[0]?.decrypted_secret || randomBytes(32).toString('hex');
   const values={SMSPASAL_API_KEY:env.SMSPASAL_API_KEY,SMSPASAL_SENDER_ID:env.SMSPASAL_SENDER_ID||'TN_ALERT',SMSPASAL_ROUTE_ID:env.SMSPASAL_ROUTE_ID||'10305',SMSPASAL_CAMPAIGN_ID:env.SMSPASAL_CAMPAIGN_ID||'9835',CRON_SECRET:cronSecret,OVERDUE_REMINDERS_ENABLED:'true'};
   for(const[name,value]of Object.entries(values)){
    const prior=(await db.query('select id from vault.secrets where name=$1',[name])).rows[0];
    if(prior)await db.query('select vault.update_secret($1,$2,$3,$4)',[prior.id,value,name,'HAE private messaging runtime']);
    else await db.query('select vault.create_secret($1,$2,$3)',[value,name,'HAE private messaging runtime']);
   }
   const privilege=await db.query("select has_function_privilege('anon','public.get_messaging_runtime_config()','EXECUTE') as anon_access,has_function_privilege('authenticated','public.get_messaging_runtime_config()','EXECUTE') as user_access");
   if(Object.values(privilege.rows[0]).some(Boolean))throw new Error('Unsafe runtime RPC privileges');
   await db.query('commit');console.log(JSON.stringify({encryptedSettingsSaved:6,browserSecretAccessDenied:true,clientWalletsChanged:false}));
  }catch(error){await db.query('rollback');throw error;}
 }else if(mode==='probe')await probe();
 else if(mode==='schedule'){
  await probe();
  await db.query('begin');
  try{
   await db.query('create extension if not exists pg_cron with schema pg_catalog');
   await db.query('create extension if not exists pg_net with schema extensions');
   await db.query('revoke all on schema cron,net from public,anon,authenticated');
   await db.query('revoke all on all tables in schema cron,net from public,anon,authenticated');
   await db.query('revoke all on all functions in schema cron,net from public,anon,authenticated');
   await db.query('grant usage on schema cron,net to postgres');
   await db.query('grant all on all tables in schema cron,net to postgres');
   await db.query('grant execute on all functions in schema cron,net to postgres');
   const command=`select net.http_get(url := '${url}',headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='CRON_SECRET')),timeout_milliseconds := 55000);`;
   const job=await db.query('select cron.schedule($1,$2,$3) as id',['hae-overdue-reminders','*/15 * * * *',command]);
   await db.query('commit');console.log(JSON.stringify({scheduler:'Supabase Cron',jobId:job.rows[0].id,everyMinutes:15,reminderGapDays:15}));
  }catch(error){await db.query('rollback');throw error;}
 }else{
  const settings=(await db.query("select name from vault.secrets where name in ('SMSPASAL_API_KEY','SMSPASAL_SENDER_ID','SMSPASAL_ROUTE_ID','SMSPASAL_CAMPAIGN_ID','CRON_SECRET','OVERDUE_REMINDERS_ENABLED') order by name")).rows.map(r=>r.name);
  const cron=(await db.query("select exists(select 1 from pg_extension where extname='pg_cron') as present")).rows[0].present;
  const jobs=cron?(await db.query("select jobid,schedule,active from cron.job where jobname='hae-overdue-reminders'")).rows:[];
  console.log(JSON.stringify({configuredNames:settings,jobs}));
 }
}catch(error){let message=String(error.message);for(const secret of[env.SUPABASE_DB_PASSWORD,env.SMSPASAL_API_KEY,cronSecret])if(secret)message=message.replaceAll(secret,'[redacted]');console.error('Messaging setup stopped:',error.code||error.name,message);process.exitCode=1;}
finally{await db.end().catch(()=>{});}
