import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { maintenanceConnection } from "./supabase-maintenance-connection.mjs";
const parse = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [
          line.slice(0, i).trim(),
          line
            .slice(i + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
const env = { ...parse(await readFile(".env.local", "utf8")), ...process.env },
  ref = new URL(
    env.UNIFIED_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  ).hostname.split(".")[0];
if (ref !== "qwxbacfnmumibihffdoj")
  throw new Error("Only the approved HAE business project is allowed");
env.SUPABASE_DB_POOLER_HOST ||= "aws-1-ap-northeast-2.pooler.supabase.com";
const mode = process.argv[2],
  version = "202611270001",
  name = "sales_deficit_stock_reports";
if (!["inspect", "dry-run", "apply"].includes(mode))
  throw new Error("Use inspect, dry-run or apply <backup directory>");
const sql = await readFile(
    `supabase/migrations/${version}_${name}.sql`,
    "utf8",
  ),
  db = new pg.Client(await maintenanceConnection(env, ref));
async function backupCheck(directory) {
  if (!directory) throw new Error("A fresh verified backup is required");
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  const age = Date.now() - Date.parse(manifest.createdAt);
  if (
    manifest.projectRef !== ref ||
    manifest.schema !== "public" ||
    age < 0 ||
    age > 4 * 3600000 ||
    !Number.isFinite(age) ||
    !manifest.functions?.length ||
    !manifest.triggers?.length
  )
    throw new Error("Invalid or expired HAE backup");
  for (const table of manifest.tables) {
    if (path.basename(table.file) !== table.file)
      throw new Error("Invalid backup path");
    const bytes = await readFile(path.join(directory, table.file));
    if (
      createHash("sha256").update(bytes).digest("hex") !== table.sha256 ||
      JSON.parse(bytes).length !== table.rows
    )
      throw new Error(`Backup verification failed: ${table.name}`);
  }
  for (const table of [
    "companies",
    "products",
    "vouchers",
    "voucher_lines",
    "stock_movements",
    "stock_adjustment_details",
    "journal_entries",
    "journal_lines",
    "ledger_entries",
    "voucher_sequences",
  ])
    if (!manifest.tables.some((row) => row.name === table))
      throw new Error(`Backup missing ${table}`);
  console.log(
    JSON.stringify({ backupVerified: true, tables: manifest.tables.length }),
  );
}
async function fingerprints(tables) {
  return (
    await db.query(
      tables
        .map((table) => {
          if (!/^[a-zA-Z0-9_]+$/.test(table))
            throw new Error("Invalid identifier");
          return `select '${table}' as name,count(*)::text rows,md5(coalesce(string_agg((to_jsonb(t)-'movement_order')::text,E'\n' order by (to_jsonb(t)-'movement_order')::text),'')) hash from public."${table}" t`;
        })
        .join(" union all "),
    )
  ).rows.sort((a, b) => a.name.localeCompare(b.name));
}
async function preflight() {
  const files = [
    [
      "prevent_negative_stock",
      "supabase/migrations/202609140001_connected_accounting.sql",
    ],
    [
      "record_numbered_sales_invoice",
      "supabase/migrations/202611080003_non_vat_invoice_series.sql",
    ],
    [
      "update_sales_invoice",
      "supabase/migrations/202608130003_edit_vouchers_with_audit.sql",
    ],
    [
      "record_stock_adjustment",
      "supabase/migrations/202609040001_accounting_operations_suite.sql",
    ],
    [
      "record_manual_stock_adjustment",
      "supabase/migrations/202611260001_manual_stock_adjustments.sql",
    ],
  ];
  for (const [name, file] of files) {
    const historical = await readFile(file, "utf8"),
      offset = historical.indexOf("function public." + name + "("),
      from = historical.indexOf("as $$", offset) + 5,
      to = historical.indexOf("$$;", from),
      expected = historical.slice(from, to).trim().replace(/\s+/g, " ");
    const rows = (
      await db.query(
        "select prosrc from pg_proc where pronamespace='public'::regnamespace and proname=$1",
        [name],
      )
    ).rows;
    if (
      offset < 0 ||
      from < 5 ||
      to < 0 ||
      rows.length !== 1 ||
      rows[0].prosrc.trim().replace(/\s+/g, " ") !== expected
    )
      throw new Error("Production function drift requires review: " + name);
  }
  const guards = (
    await db.query(
      "select tgname from pg_trigger where tgrelid='public.products'::regclass and tgname='stock_nonnegative_guard' and not tgisinternal",
    )
  ).rowCount;
  if (guards !== 1) throw new Error("Expected product stock guard is missing");
  const checks = (
    await db.query(
      "select conname from pg_constraint where conrelid='public.products'::regclass and contype='c' and pg_get_constraintdef(oid)~*'stock_qty.*(>=|>) *0'",
    )
  ).rows;
  if (checks.length)
    throw new Error(
      "Unexpected nonnegative product constraint requires review",
    );
  console.log(
    JSON.stringify({
      productionDefinitionsMatch: true,
      stockGuardVerified: true,
    }),
  );
}
async function verify() {
  for (const signature of [
    "public.record_numbered_sales_invoice(uuid,uuid,uuid,date,jsonb,numeric,numeric,text,text)",
    "public.update_sales_invoice(uuid,uuid,date,jsonb,numeric,numeric,text)",
    "public.record_stock_adjustment(uuid,uuid,date,jsonb,text,uuid)",
    "public.record_manual_stock_adjustment(uuid,uuid,uuid,uuid,uuid,date,text,numeric,numeric,numeric,text)",
    "public.stock_report_snapshot(uuid,date,date)",
    "public.create_catalog_product(uuid,uuid,uuid,date,jsonb)",
  ]) {
    const row = (
      await db.query(
        "select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') u,has_function_privilege('service_role',$1,'EXECUTE') s",
        [signature],
      )
    ).rows[0];
    if (row.a || row.u || !row.s)
      throw new Error("Unsafe function privileges: " + signature);
  }
  const row = (
    await db.query(
      "select provolatile from pg_proc where oid='public.stock_report_snapshot(uuid,date,date)'::regprocedure",
    )
  ).rows[0];
  if (row.provolatile !== "s")
    throw new Error("Stock report must use a stable read snapshot");
  console.log(
    JSON.stringify({
      serverOnlyFunctions: true,
      consistentStockReportSnapshot: true,
    }),
  );
}

try {
  await db.connect();
  const prior = (
    await db.query(
      "select version from supabase_migrations.schema_migrations where version=$1",
      [version],
    )
  ).rowCount;
  console.log(
    JSON.stringify({
      project: ref,
      mode,
      migration: version,
      alreadyApplied: Boolean(prior),
    }),
  );
  if (prior) await verify();
  else {
    await preflight();
    if (mode !== "inspect") {
      if (mode === "apply") await backupCheck(process.argv[3]);
      await db.query("begin isolation level repeatable read");
      try {
        await db.query("set local lock_timeout='5s'");
        await db.query("set local statement_timeout='45s'");
        if (
          !(
            await db.query(
              "select pg_try_advisory_xact_lock(hashtextextended('hae-stock-deficit-report-release',0)) locked",
            )
          ).rows[0].locked
        )
          throw new Error("Another stock release is running");
        const tables = (
            await db.query(
              "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
            )
          ).rows.map((row) => row.table_name),
          before = await fingerprints(tables);
        await db.query(sql);
        await db.query(
          "insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)",
          [version, name, [sql]],
        );
        await verify();
        if (
          JSON.stringify(before) !== JSON.stringify(await fingerprints(tables))
        )
          throw new Error("Existing data changed; rolling back");
        console.log(
          JSON.stringify({
            existingTablesUnchanged: tables.length,
            existingRows: before.reduce((n, row) => n + Number(row.rows), 0),
            stockAndFinancialDataUnchanged: true,
          }),
        );
        if (mode === "dry-run") {
          await db.query("rollback");
          console.log("Dry-run rolled back successfully");
        } else {
          await db.query("notify pgrst, 'reload schema'");
          await db.query("commit");
          console.log("Approved stock deficit/report migration committed");
        }
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
  }
} catch (error) {
  console.error(
    "Stock deficit/report release stopped:",
    error.code || error.name,
    String(error.message).replaceAll(
      env.SUPABASE_DB_PASSWORD || "___",
      "[redacted]",
    ),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
