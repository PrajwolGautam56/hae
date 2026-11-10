import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { createHash } from "node:crypto";

async function loadEnv(file) {
  const values = {};
  for (const rawLine of (await fs.readFile(file, "utf8")).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

const root = process.cwd();
const env = { ...(await loadEnv(path.join(root, ".env.local"))), ...process.env };
const projectRef = new URL(env.UNIFIED_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!projectRef || !env.SUPABASE_DB_PASSWORD) throw new Error("Supabase URL or database password is missing");
if (env.BACKUP_EXPECTED_PROJECT && projectRef !== env.BACKUP_EXPECTED_PROJECT) throw new Error("Backup project does not match the expected project");

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const output = path.join(root, "backups", `${projectRef}-${stamp}`);
await fs.mkdir(output, { recursive: true, mode: 0o700 });

const client = new pg.Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: "postgres",
  password: env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

try {
  await client.connect();
  await client.query("begin isolation level repeatable read read only");
  const { rows: tables } = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  const { rows: columns } = await client.query(`
    select table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
    from information_schema.columns where table_schema='public'
    order by table_name,ordinal_position
  `);
  const { rows: constraints } = await client.query(`
    select conrelid::regclass::text as table_name,conname,contype,pg_get_constraintdef(oid) as definition
    from pg_constraint where connamespace='public'::regnamespace order by 1,2
  `);
  const { rows: indexes } = await client.query(`
    select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname
  `);
  const { rows: functions } = await client.query(`
    select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p') order by 1
  `);
  const { rows: triggers } = await client.query(`
    select c.relname as table_name,t.tgname,pg_get_triggerdef(t.oid) as definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by 1,2
  `);
  const manifest = { projectRef, createdAt: new Date().toISOString(), schema: "public", backupType:"application-public-data-and-schema", tables: [], columns, constraints, indexes, functions, triggers };
  for (const { table_name: table } of tables) {
    const safeName = table.replaceAll(/[^a-zA-Z0-9_]/g, "_");
    const { rows } = await client.query(`select * from public."${table.replaceAll('"', '""')}"`);
    const content=JSON.stringify(rows, null, 2);
    await fs.writeFile(path.join(output, `${safeName}.json`), content, {mode:0o600});
    manifest.tables.push({ name: table, rows: rows.length, file: `${safeName}.json`, sha256:createHash("sha256").update(content).digest("hex") });
  }
  await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2), {mode:0o600});
  await client.query("commit");
  console.log(`Backup complete: ${output}`);
  console.log(`Tables: ${manifest.tables.length}; rows: ${manifest.tables.reduce((sum, table) => sum + table.rows, 0)}`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  await fs.rm(output, { recursive: true, force: true });
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
