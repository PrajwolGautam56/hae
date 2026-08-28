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
  assert.match(page, /Add first company administrator/);
  assert.match(page, /Shared DB · company isolated/);
  assert.doesNotMatch(page, /Supabase project ref/);
});
