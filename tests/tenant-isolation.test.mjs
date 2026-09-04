import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("proxy resolves a company inside the host tenant and checks membership", async () => {
  const proxy = await source("proxy.ts");
  assert.match(proxy, /platform_tenants\?slug=eq\./);
  assert.match(proxy, /organization_id=eq\./);
  assert.match(proxy, /company_id=eq\./);
  assert.match(proxy, /lookupIdentity\(token, "team_members"/);
  assert.match(proxy, /lookupIdentity\(token, "parties"/);
});

test("selected company resolution fails closed in unified mode", async () => {
  const context = await source("lib/company-context.ts");
  assert.match(context, /eq\("organization_id", company\.tenantId\)/);
  assert.match(context, /UNIFIED_SUPABASE_URL/);
  assert.match(context, /Selected company does not belong to this workspace/);
});

test("privileged mutation routes validate submitted company-owned IDs", async () => {
  const files = await Promise.all([
    source("app/api/accounting/route.ts"),
    source("app/api/crm/route.ts"),
    source("app/api/funds/route.ts"),
    source("app/api/cheques/route.ts"),
    source("app/api/manufacturing/route.ts"),
  ]);
  for (const route of files) assert.match(route, /assertCompanyRecord|assertCompanyRecords|assertOptionalCompanyRecord/);
});

test("browser Data API privileges and public RPC execution are revoked", async () => {
  const migration = await source("supabase/migrations/202608270002_multi_tenant_security_hardening.sql");
  assert.match(migration, /revoke all privileges on all tables in schema public from anon, authenticated/i);
  assert.match(migration, /revoke all privileges on all functions in schema public from public, anon, authenticated/i);
  assert.match(migration, /alter default privileges in schema public revoke execute on functions from public, anon, authenticated/i);
  assert.match(migration, /foreign key\(company_id,party_id\)/i);
  assert.match(migration, /customer_order_history_actor_guard/i);
});

test("company administrators cannot overwrite shared customer passwords", async () => {
  const route = await source("app/api/client-access/route.ts");
  assert.doesNotMatch(route, /auth\.admin\.updateUserById\(party\.auth_user_id/);
  assert.match(route, /cannot overwrite a shared login password/);
});

test("platform onboarding provisions and scopes company users", async () => {
  const route = await source("app/api/platform/admin/route.ts");
  const page = await source("app/platform-admin/page.tsx");
  assert.match(route, /action === "provisionCompany"/);
  assert.match(route, /action === "createCompanyUser"/);
  assert.match(route, /eq\("company_id", platformCompany\.app_company_id\)/);
  assert.match(route, /eq\("organization_id", platformCompany\.tenant_id\)/);
  assert.match(route, /subscription has used all/);
  assert.match(route, /Every company must keep at least one active administrator/);
  assert.match(route, /action === "activateCompany"/);
  assert.match(route, /platformErrorMessage/);
  assert.match(route, /Payroll Deductions Payable/);
  assert.match(page, /Add first company administrator/);
  assert.match(page, /Shared DB · company isolated/);
  assert.match(page, /1 · Provision workspace/);
  assert.match(page, /2 · Add first admin/);
  assert.match(page, /3 · Activate login/);
  assert.doesNotMatch(page, /Supabase project ref/);
});

test("embedded business reads disambiguate tenant-safe foreign keys", async () => {
  const [accounting, reports, cheques, funds, crm, orders] = await Promise.all([
    source("app/api/accounting/route.ts"),
    source("app/api/reports/route.ts"),
    source("app/api/cheques/route.ts"),
    source("app/api/funds/route.ts"),
    source("app/api/crm/route.ts"),
    source("app/api/orders/route.ts"),
  ]);
  assert.match(accounting, /parties!vouchers_company_party_fkey/);
  assert.match(accounting, /money_accounts!vouchers_company_money_account_fkey/);
  assert.match(reports, /ledger_entries!ledger_company_voucher_fkey/);
  assert.match(reports, /journal_entries!journal_line_company_entry_fkey/);
  assert.match(cheques, /parties!vouchers_company_party_fkey/);
  assert.match(funds, /parties!movement_company_party_fkey/);
  assert.match(crm, /team_members!leads_company_assignee_fkey/);
  assert.match(orders, /parties!orders_company_party_fkey/);
});

test("accounting operations remain tenant scoped and server-only", async () => {
  const [route, migration] = await Promise.all([
    source("app/api/accounting-suite/route.ts"),
    source("supabase/migrations/202609040001_accounting_operations_suite.sql"),
  ]);
  assert.match(route, /assertCompanyRecord\(db, "purchase_orders"/);
  assert.match(route, /assertCompanyRecords\(db, "accounts"/);
  assert.match(route, /assertCompanyRecords\(db, "money_accounts"/);
  assert.match(route, /assertCompanyRecord\(db, "bills_of_materials"/);
  assert.match(migration, /po_company_supplier_fkey/i);
  assert.match(migration, /bom_component_company_guard/i);
  assert.match(migration, /payroll_line_company_guard/i);
  assert.match(migration, /revoke all on function public\.record_manual_journal/i);
  assert.match(migration, /grant execute on function public\.record_goods_return[^;]+to service_role/is);
});

test("non-posting purchase orders, balanced journals and BOM production are explicit", async () => {
  const migration = await source("supabase/migrations/202609040001_accounting_operations_suite.sql");
  const purchaseOrderFunction = migration.slice(migration.indexOf("create or replace function public.record_purchase_order"), migration.indexOf("create or replace function public.convert_purchase_order_to_bill"));
  assert.doesNotMatch(purchaseOrderFunction, /insert into vouchers|insert into ledger_entries|insert into stock_movements/i);
  assert.match(migration, /Journal debit and credit must be equal/);
  assert.match(migration, /record_bom_production/);
  assert.match(migration, /Production consumption/);
  assert.match(migration, /Cost of goods sold/);
});

test("report center includes financial, ageing, tax and stock controls", async () => {
  const [route, workspace] = await Promise.all([
    source("app/api/reports/route.ts"), source("app/reports-workspace.tsx"),
  ]);
  for (const report of ["balance_sheet", "profit_loss", "aging_receivable", "aging_payable", "stock_statement", "stock_movement", "tax_summary"]) {
    assert.match(route, new RegExp(report));
    assert.match(workspace, new RegExp(report));
  }
  assert.match(route, /allocation: "FIFO"/);
  assert.match(workspace, /0–30 DAYS/);
  assert.match(workspace, /ABOVE 90 DAYS/);
});
