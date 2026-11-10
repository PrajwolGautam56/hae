import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const env={...Object.fromEntries((await readFile('.env.local','utf8')).split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const n=l.indexOf('=');return[l.slice(0,n).trim(),l.slice(n+1).trim().replace(/^['"]|['"]$/g,'')];})),...process.env};
const ref=new URL(env.UNIFIED_SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(ref!=='qwxbacfnmumibihffdoj')throw new Error('Refusing to release outside the HAE business project');
const mode=process.argv[2];
if(!['inspect','dry-run','apply'].includes(mode))throw new Error('Choose inspect, dry-run, or apply [verified-backup-directory]');
const migrations=await Promise.all([
  '202611080001_cancelled_sales_invoices',
  '202611080002_manual_party_openings',
  '202611080003_non_vat_invoice_series',
  '202611100001_party_details_and_opening_policy',
].map(async name=>({version:name.split('_')[0],name:name.slice(13),sql:await readFile(`supabase/migrations/${name}.sql`,'utf8')})));
const db=new pg.Client({host:`db.${ref}.supabase.co`,port:5432,user:'postgres',password:env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const added={vouchers:['number_series'],parties:['profile_revision'],party_opening_balances:['balance_source','note','revision','updated_at','updated_by']};
async function fingerprints(tables) {
  const queries=tables.map((table,index)=>{
    if(!/^[a-zA-Z0-9_]+$/.test(table))throw new Error('Unsupported table name');
    return `select '${table}' as table_name,count(*)::text as rows,md5(coalesce(string_agg((to_jsonb(t)-$${index+1}::text[])::text,E'\n' order by (to_jsonb(t)-$${index+1}::text[])::text),'')) as fingerprint from public."${table}" t`;
  });
  const result=await db.query(queries.join(' union all '),tables.map(table=>added[table]||[]));
  return Object.fromEntries(tables.map(table=>{const row=result.rows.find(r=>r.table_name===table);return[table,{rows:row.rows,fingerprint:row.fingerprint}];}));
}
async function verifyBackup(directory) {
  if(!directory)throw new Error('A verified application backup is required before apply');
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  if(manifest.projectRef!==ref||manifest.schema!=='public'||Date.now()-Date.parse(manifest.createdAt)>4*60*60*1000)throw new Error('Backup must be for HAE and less than four hours old');
  if(!manifest.functions?.length||!manifest.triggers?.length)throw new Error('Backup is missing database function/trigger definitions');
  for(const table of manifest.tables){
    if(path.basename(table.file)!==table.file)throw new Error('Invalid backup manifest filename');
    const content=await readFile(path.join(directory,table.file));
    if(createHash('sha256').update(content).digest('hex')!==table.sha256||JSON.parse(content).length!==table.rows)throw new Error(`Backup verification failed for ${table.name}`);
  }
  for(const name of ['companies','parties','vouchers','voucher_lines','ledger_entries','journal_entries','journal_lines','stock_movements','party_opening_balances','voucher_sequences'])if(!manifest.tables.some(t=>t.name===name))throw new Error(`Backup missing ${name}`);
  console.log(JSON.stringify({backupVerified:true,tables:manifest.tables.length,rows:manifest.tables.reduce((s,t)=>s+t.rows,0)}));
}
async function capabilities(){
  const result=await db.query(`select
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='vouchers' and column_name='number_series') as nb_series,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='parties' and column_name='profile_revision') as party_profiles,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='party_opening_balances' and column_name='balance_source') as opening_sources,
    to_regprocedure('public.record_cancelled_sales_invoice_in_series(uuid,uuid,uuid,date,text,uuid,text)') is not null as cancel_rpc,
    to_regprocedure('public.update_party_details(uuid,uuid,uuid,text,text,text,text,integer)') is not null as profile_rpc,
    to_regprocedure('public.party_has_prior_records(uuid,uuid,uuid)') is not null as prior_history_guard,
    to_regclass('public.vouchers_fy_type_series_sequence_unique') is not null as series_uniqueness`);
  return result.rows[0];
}

try {
  await db.connect();
  const history=await db.query('select version from supabase_migrations.schema_migrations where version=any($1::text[])',[migrations.map(m=>m.version)]);
  const pending=migrations.filter(m=>!history.rows.some(h=>h.version===m.version));
  console.log(JSON.stringify({project:ref,mode,pending:pending.map(m=>m.version),capabilities:await capabilities()}));
  if(mode==='inspect')process.exitCode=0;
  else if(!pending.length)console.log('All approved migrations are already recorded; no changes applied.');
  else {
    if(mode==='apply')await verifyBackup(process.argv[3]);
    await db.query('begin isolation level repeatable read');
    try {
      await db.query("set local lock_timeout='5s'");await db.query("set local statement_timeout='45s'");
      const lock=await db.query("select pg_try_advisory_xact_lock(hashtextextended('hae-november-accounting-release',0)) as acquired");
      if(!lock.rows[0].acquired)throw new Error('Another accounting release is running');
      const tables=(await db.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(t=>t.table_name);
      const before=await fingerprints(tables);
      for(const migration of pending){
        await db.query(migration.sql);
        await db.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[migration.version,migration.name,[migration.sql]]);
        console.log(`Validated migration ${migration.version}`);
      }
      const checks=await capabilities();
      if(!Object.values(checks).every(Boolean))throw new Error('A required schema capability is missing');
      const readProbes=await db.query(`select jsonb_typeof(public.get_party_opening_balance(p.company_id,fy.id,p.id)) as response_type
        from public.parties p join lateral(select id from public.fiscal_years where company_id=p.company_id order by start_ad desc limit 1) fy on true`);
      if(readProbes.rows.some(r=>r.response_type!=='object'))throw new Error('Opening read RPC failed on existing records');
      const privileges=await db.query("select has_function_privilege('anon','public.update_party_details(uuid,uuid,uuid,text,text,text,text,integer)','EXECUTE') as profile,has_function_privilege('authenticated','public.record_numbered_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text,text)','EXECUTE') as posting,has_function_privilege('anon','public.set_party_opening_balance(uuid,uuid,uuid,uuid,numeric,text,text,integer)','EXECUTE') as opening");
      if(Object.values(privileges.rows[0]).some(Boolean))throw new Error('A privileged function is browser-accessible');
      const after=await fingerprints(tables);
      if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Existing table contents changed during schema release; rolling back');
      console.log(JSON.stringify({existingTablesUnchanged:tables.length,existingPartyReadProbes:readProbes.rows.length,capabilities:checks,browserRpcPrivilegesDenied:true}));
      if(mode==='dry-run'){
        await db.query('rollback');console.log('Dry-run successful: all schema and migration-history changes rolled back.');
      } else {
        await db.query("notify pgrst, 'reload schema'");await db.query('commit');
        console.log('Approved HAE migrations committed; PostgREST schema reload requested.');
      }
    } catch(error){await db.query('rollback').catch(()=>{});throw error;}
  }
} catch(error){console.error('Release stopped:',error.code||error.name,String(error.message).replaceAll(env.SUPABASE_DB_PASSWORD||'___','[redacted]'));process.exitCode=1;}
finally{await db.end().catch(()=>{});}
