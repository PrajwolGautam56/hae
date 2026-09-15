import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = async (file) => ts.transpileModule(await fs.readFile(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const passwordModule = url(await compile("lib/temporary-password.ts"));
const { createTemporaryPassword } = await import(passwordModule);

// Isolated in-memory adapters: no Supabase credentials, network calls or emails.
const adapters = url(`
export const state = { created: [], writes: [], emails: [], users: [], seats: 0, signedIn: true, linked: true };
export const NextResponse = { json: (body, options) => new Response(JSON.stringify(body), options) };
const company = { id: "control-company", tenant_id: "tenant", app_company_id: "business-company", name: "QA Company", slug: "qa" };
export const db = {
  from(table) {
    let fields, options, mutation;
    const query = {
      select(value, opts) { fields = value; options = opts; return query; },
      eq() { return query; }, in() { return query; }, ilike() { return query; }, not() { return query; },
      upsert(value) { mutation = value; state.writes.push({ table, value }); return query; },
      insert(value) { mutation = value; state.writes.push({ table, value }); return query; },
      update(value) { mutation = value; state.writes.push({ table, value }); return query; },
      single() { return query; }, maybeSingle() { return query; },
      then(resolve, reject) {
        let data = null;
        if (table === "platform_companies") data = fields === "app_company_id" ? [company] : company;
        if (table === "companies") data = state.linked ? { id: company.app_company_id } : null;
        if (table === "platform_subscriptions") data = { user_limit: 10 };
        if (table === "platform_tenants") data = { id: "tenant", name: "QA", primary_domain: "qa.example.invalid" };
        if (mutation) data = { id: "new-member", ...mutation };
        return Promise.resolve({ data, error: null, count: options?.head ? state.seats : null }).then(resolve, reject);
      }
    };
    return query;
  },
  auth: { admin: {
    async listUsers() { return { data: { users: state.users }, error: null }; },
    async createUser(input) {
      if (Buffer.byteLength(input.password) > 72) return { data: null, error: { message: "Password cannot be longer than 72 characters" } };
      state.created.push(input);
      return { data: { user: { id: "new-auth" } }, error: null };
    },
    async generateLink() { return { data: { properties: { hashed_token: "test-token" } }, error: null }; },
    async deleteUser() { return { error: null }; }
  } }
};
export const authorizePlatformAdmin = async () => ({ db, admin: state.signedIn ? { id: "operator", role: "super_admin" } : null });
export const canManage = () => true;
export const canManageAdmins = () => true;
export const writePlatformAudit = async () => {};
export const sendTeamEmail = async (input) => { state.emails.push(input); return { success: true }; };
export const getUnifiedAdmin = () => db;
`);
const { state } = await import(adapters);
let route = await compile("app/api/platform/admin/route.ts");
route = route.replace(/from "([^"]+)"/g, (_, specifier) => `from "${specifier.endsWith("temporary-password") ? passwordModule : adapters}"`);
const { POST } = await import(url(route));
const request = (action, extra = {}) => new Request("https://admin.example.invalid/api/platform/admin", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action, companyId: "control-company", name: "QA Admin", email: "qa@example.invalid", role: "staff", ...extra }),
});
function reset() {
  Object.assign(state, { created: [], writes: [], emails: [], users: [], seats: 0, signedIn: true, linked: true });
}

test("bootstrap passwords are random, policy-compatible ASCII within Supabase's byte limit", () => {
  const values = new Set();
  for (let i = 0; i < 100; i++) {
    const value = createTemporaryPassword();
    assert.equal(Buffer.byteLength(value), 68);
    assert.match(value, /^[a-f0-9]{64}Aa1!$/);
    values.add(value);
  }
  assert.equal(values.size, 100);
});

test("all four bootstrap paths use the shared bounded password generator", async () => {
  const files = ["app/api/platform/admin/route.ts", "app/api/platform/auth/forgot-password/route.ts", "app/api/admin/users/route.ts"];
  let calls = 0;
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    calls += [...source.matchAll(/createTemporaryPassword\(\)/g)].length;
    assert.ok(!source.includes('Aa1!${crypto.randomUUID()}'));
  }
  assert.equal(calls, 4);
});

test("first company user is created as administrator with a company-scoped setup link", async () => {
  reset();
  const response = await POST(request("createCompanyUser"));
  assert.equal(response.status, 200);
  assert.equal(state.created.length, 1);
  assert.equal(Buffer.byteLength(state.created[0].password), 68);
  const membership = state.writes.find((row) => row.table === "team_members").value;
  assert.equal(membership.role, "admin");
  assert.equal(membership.company_id, "business-company");
  assert.equal(membership.auth_user_id, "new-auth");
  const link = new URL(state.emails[0].actionUrl);
  assert.equal(link.hostname, "qa.example.invalid");
  assert.equal(link.searchParams.get("company"), "qa");
});

test("platform administrator creation succeeds with the bounded bootstrap password", async () => {
  reset();
  const response = await POST(request("createAdmin", { role: "operator" }));
  assert.equal(response.status, 200);
  assert.equal(state.created.length, 1);
  assert.equal(state.writes.find((row) => row.table === "platform_admins").value.role, "operator");
  assert.equal(state.emails.length, 1);
});

test("adding an existing identity does not overwrite its password", async () => {
  reset();
  state.users = [{ id: "existing-auth", email: "qa@example.invalid" }];
  const response = await POST(request("createCompanyUser"));
  assert.equal(response.status, 200);
  assert.equal(state.created.length, 0);
  assert.equal(state.writes.find((row) => row.table === "team_members").value.auth_user_id, "existing-auth");
});

test("unauthenticated and unverified-company requests cannot create users", async () => {
  reset();
  state.signedIn = false;
  assert.equal((await POST(request("createCompanyUser"))).status, 401);
  state.signedIn = true;
  state.linked = false;
  assert.equal((await POST(request("createCompanyUser"))).status, 409);
  assert.equal(state.created.length, 0);
  assert.equal(state.writes.length, 0);
});

test("subscription seat limit still blocks new memberships", async () => {
  reset();
  state.seats = 10;
  assert.equal((await POST(request("createCompanyUser"))).status, 409);
  assert.equal(state.created.length, 0);
});
