import { readFile } from 'node:fs/promises';
import pg from 'pg';

const env = Object.fromEntries((await readFile('.env.local', 'utf8')).split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')];
}));
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if (projectRef !== 'qwxbacfnmumibihffdoj') throw new Error('Refusing to run against a project other than HAE business');
if (!env.SUPABASE_DB_PASSWORD) throw new Error('Missing HAE database password');
const mode = process.argv[2];
if (!['inspect', 'dry-run', 'apply'].includes(mode)) throw new Error('Choose inspect, dry-run or apply');
const client = new pg.Client({host:`db.${projectRef}.supabase.co`,port:5432,user:'postgres',password:env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const migration = await readFile('supabase/migrations/202609260001_tasks_and_commercial_documents.sql','utf8');
const version = '202609260001';
const body = migration.replace(/^begin;\s*/i,'').replace(/\s*commit;\s*$/i,'');
try {
  await client.connect();
  const context = await client.query(`select current_database() as database,
    to_regclass('public.work_tasks') is not null as tasks,
    to_regclass('public.crm_activities') is not null as activities,
    to_regclass('public.commercial_documents') is not null as documents`);
  const constraints = await client.query("select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.crm_activities'::regclass order by conname");
  const migrationTable = await client.query("select to_regclass('supabase_migrations.schema_migrations') is not null as present");
  const migrationColumns = migrationTable.rows[0].present ? await client.query("select column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' order by ordinal_position") : {rows:[]};
  const applied = migrationTable.rows[0].present ? await client.query('select version from supabase_migrations.schema_migrations where version=$1',[version]) : {rows:[]};
  console.log(JSON.stringify({projectRef,context:context.rows[0],activityConstraints:constraints.rows,migrationColumns:migrationColumns.rows,applied:applied.rows.length>0},null,2));
  if (mode === 'inspect') process.exitCode = 0;
  else if (applied.rows.length) console.log('Migration already recorded; no changes made.');
  else {
    await client.query('begin');
    try {
      await client.query("set local lock_timeout='5s'");
      await client.query("set local statement_timeout='45s'");
      await client.query(body);
      if (!migrationTable.rows[0].present) throw new Error('Supabase migration history is missing');
      await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[version,'tasks_and_commercial_documents',[migration]]);
      const check=await client.query("select to_regclass('public.commercial_documents') is not null as documents, to_regprocedure('public.save_work_task(uuid,uuid,uuid,jsonb,boolean,timestamp with time zone,uuid)') is not null as task_rpc, to_regprocedure('public.issue_commercial_document(uuid,uuid,uuid,uuid,jsonb)') is not null as document_rpc");
      if (!Object.values(check.rows[0]).every(Boolean)) throw new Error('Migration objects not present after execution');
      if (mode === 'dry-run') {
        await client.query('rollback');
        console.log('Dry run passed; rolled back every schema change.');
      } else {
        await client.query('commit');
        console.log('Migration applied and recorded on HAE business.');
      }
    } catch(error) {
      await client.query('rollback').catch(()=>undefined);
      throw error;
    }
  }
} finally { await client.end().catch(()=>undefined); }
