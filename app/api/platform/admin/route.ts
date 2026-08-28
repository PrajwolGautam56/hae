import { NextResponse } from "next/server";
import { authorizePlatformAdmin, canManage, canManageAdmins, writePlatformAudit } from "../../../../lib/platform-admin";
import { sendTeamEmail } from "../../../../lib/resend-email";
import { getUnifiedAdmin } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const tenantStatuses = ["pending", "active", "suspended", "expired"];
const onboardingStages = ["new", "database", "admin", "domain", "ready"];
const companyStatuses = ["active", "pending", "disabled"];
const databaseStatuses = ["pending", "connecting", "ready", "error"];
const subscriptionStatuses = ["trial", "active", "past_due", "cancelled", "expired"];
const adminRoles = ["super_admin", "operator", "support", "viewer"];
const companyRoles = ["admin", "manager", "accountant", "staff"];
const featureKeys = ["accounting", "sales", "purchases", "inventory", "manufacturing", "crm", "tasks", "orders", "customer_portal", "cash_bank", "cheques", "reports"];

function cleanSlug(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function textOrNull(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

async function authUserByEmail(db: NonNullable<ReturnType<typeof getUnifiedAdmin>>, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 100) break;
  }
  return null;
}

async function seedCompanyFoundation(unified: NonNullable<ReturnType<typeof getUnifiedAdmin>>, companyId: string) {
  const accounts = [
    ["1000", "Cash and Bank", "asset", "debit", "cash_bank"],
    ["1100", "Accounts Receivable", "asset", "debit", "accounts_receivable"],
    ["1200", "Raw Material Inventory", "asset", "debit", "raw_inventory"],
    ["1210", "Finished Goods Inventory", "asset", "debit", "finished_inventory"],
    ["2000", "Accounts Payable", "liability", "credit", "accounts_payable"],
    ["3000", "Opening Balance Equity", "equity", "credit", "opening_equity"],
    ["4000", "Sales Revenue", "income", "credit", "sales_revenue"],
    ["5000", "Cost of Goods Sold", "expense", "debit", "cost_of_goods"],
    ["6000", "Office and Operating Expenses", "expense", "debit", "office_expense"],
  ].map(([code, name, account_type, normal_side, system_key]) => ({ company_id: companyId, code, name, account_type, normal_side, system_key, active: true }));
  const { error: accountError } = await unified.from("accounts").upsert(accounts, { onConflict: "company_id,code" });
  if (accountError) throw accountError;
  const { error: cashError } = await unified.from("money_accounts").upsert({ company_id: companyId, account_type: "office_cash", name: "Office Counter Cash", opening_balance: 0, active: true }, { onConflict: "company_id,name" });
  if (cashError) throw cashError;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { error: fiscalError } = await unified.rpc("ensure_fiscal_year_for_date", { p_company_id: companyId, p_date: today });
  if (fiscalError) throw fiscalError;
}

async function provisionUnifiedCompany(
  controlDb: Awaited<ReturnType<typeof authorizePlatformAdmin>>["db"],
  tenantId: string,
  platformCompany: { id: string; slug: string; name: string },
) {
  const unified = getUnifiedAdmin();
  if (!unified) return null;
  const { data: tenant, error: tenantError } = await controlDb.from("platform_tenants")
    .select("id,slug,name,primary_domain,status,active,contact_name,contact_email,contact_phone,address,notes,onboarding_stage")
    .eq("id", tenantId).single();
  if (tenantError) throw tenantError;
  const { error: mirrorTenantError } = await unified.from("platform_tenants").upsert(tenant, { onConflict: "id" });
  if (mirrorTenantError) throw mirrorTenantError;
  const { error: mirrorCompanyError } = await unified.from("platform_companies").upsert({
    id: platformCompany.id, tenant_id: tenantId, slug: platformCompany.slug,
    name: platformCompany.name, legal_name: platformCompany.name, status: "active",
    login_enabled: false, database_status: "ready", portal_enabled: false,
  }, { onConflict: "id" });
  if (mirrorCompanyError) throw mirrorCompanyError;
  const existing = await unified.from("companies").select("id").eq("platform_company_id", platformCompany.id).maybeSingle();
  if (existing.error) throw existing.error;
  let businessCompanyId = existing.data?.id;
  if (!businessCompanyId) {
    const { data: businessCompany, error: businessError } = await unified.from("companies").insert({
      organization_id: tenantId, platform_company_id: platformCompany.id, slug: platformCompany.slug,
      name: platformCompany.name, currency: "NPR", fiscal_year: "BS", active: true,
    }).select("id").single();
    if (businessError) throw businessError;
    businessCompanyId = businessCompany.id;
  }
  await seedCompanyFoundation(unified, businessCompanyId);
  const { error: unifiedLinkError } = await unified.from("platform_companies").update({ app_company_id: businessCompanyId, database_status: "ready", status: "active" }).eq("id", platformCompany.id).eq("tenant_id", tenantId);
  if (unifiedLinkError) throw unifiedLinkError;
  return businessCompanyId;
}

export async function GET(request: Request) {
  try {
    const { db, admin } = await authorizePlatformAdmin(request);
    if (!admin) return NextResponse.json({ error: "Platform administrator sign-in required" }, { status: 401 });
    const [tenants, initialCompanies, subscriptions, administrators, audits, entitlements] = await Promise.all([
      db.from("platform_tenants").select("id,slug,name,primary_domain,status,active,contact_name,contact_email,contact_phone,address,notes,onboarding_stage,created_at,updated_at").order("created_at", { ascending: false }),
      db.from("platform_companies").select("id,tenant_id,app_company_id,slug,name,legal_name,connection_key,status,login_enabled,sort_order,database_status,portal_enabled,notes,created_at,updated_at").order("created_at", { ascending: false }),
      db.from("platform_subscriptions").select("id,tenant_id,plan_name,status,starts_on,expires_on,company_limit,user_limit,monthly_amount,notes,updated_at"),
      db.from("platform_admins").select("id,name,email,role,active,last_login_at,created_at").order("created_at"),
      db.from("platform_audit_logs").select("id,admin_email,action,entity_type,entity_id,summary,metadata,ip_address,created_at").order("created_at", { ascending: false }).limit(100),
      db.from("platform_entitlements").select("tenant_id,feature_key,enabled,limits"),
    ]);
    let companies = initialCompanies;
    if (companies.error && /app_company_id.*(does not exist|schema cache)/i.test(companies.error.message)) {
      const legacyCompanies = await db.from("platform_companies").select("id,tenant_id,slug,name,legal_name,connection_key,status,login_enabled,sort_order,database_status,portal_enabled,notes,created_at,updated_at").order("created_at", { ascending: false });
      companies = { ...legacyCompanies, data: legacyCompanies.data?.map((company) => ({ ...company, app_company_id: null })) || null } as typeof initialCompanies;
    }
    const firstError = [tenants.error, companies.error, subscriptions.error, administrators.error, audits.error].find(Boolean);
    if (firstError) throw firstError;
    const unified = getUnifiedAdmin();
    let companyUsers: Array<Record<string, unknown>> = [];
    let unifiedError = "";
    const appCompanyIds = (companies.data || []).map((company) => company.app_company_id).filter(Boolean) as string[];
    if (unified && appCompanyIds.length) {
      const users = await unified.from("team_members").select("id,company_id,name,email,phone,role,active,auth_user_id,created_at").in("company_id", appCompanyIds).order("created_at");
      if (users.error) unifiedError = users.error.message;
      else companyUsers = users.data || [];
    } else if (unified) {
      const health = await unified.from("companies").select("id", { count: "exact", head: true });
      if (health.error) unifiedError = `Shared database schema is not ready: ${health.error.message}`;
    } else if (!unified) unifiedError = "Shared Supabase is not configured on this deployment";
    return NextResponse.json({
      viewer: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      tenants: tenants.data || [],
      companies: companies.data || [],
      subscriptions: subscriptions.data || [],
      administrators: administrators.data || [],
      audits: audits.data || [],
      entitlements: entitlements.data || [],
      companyUsers,
      unifiedReady: Boolean(unified) && !unifiedError,
      unifiedError,
      entitlementMigrationRequired: Boolean(entitlements.error),
      rootDomain: process.env.PLATFORM_ROOT_DOMAIN || "kritechglobal.com",
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Platform data could not be loaded" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { db, admin } = await authorizePlatformAdmin(request);
    if (!admin) return NextResponse.json({ error: "Platform administrator sign-in required" }, { status: 401 });
    const body = await request.json();
    const action = String(body.action || "");
    if (!canManage(admin) && !["noop"].includes(action)) return NextResponse.json({ error: "Your platform role is read-only" }, { status: 403 });

    if (action === "createTenant") {
      const name = String(body.name || "").trim();
      const slug = cleanSlug(body.slug);
      if (!name || !slugPattern.test(slug)) return NextResponse.json({ error: "A valid client name and subdomain slug are required" }, { status: 400 });
      const root = process.env.PLATFORM_ROOT_DOMAIN || "kritechglobal.com";
      const primaryDomain = textOrNull(body.primaryDomain) || `${slug}.${root}`;
      const { data: tenant, error } = await db.from("platform_tenants").insert({
        name,
        slug,
        primary_domain: primaryDomain,
        status: "pending",
        active: true,
        onboarding_stage: "new",
        contact_name: textOrNull(body.contactName),
        contact_email: textOrNull(body.contactEmail)?.toLowerCase() || null,
        contact_phone: textOrNull(body.contactPhone),
        address: textOrNull(body.address),
        notes: textOrNull(body.notes),
      }).select("id,slug,name").single();
      if (error) throw error;
      const { error: subscriptionError } = await db.from("platform_subscriptions").insert({ tenant_id: tenant.id, plan_name: textOrNull(body.planName) || "Starter", status: "trial", company_limit: 1, user_limit: 10, monthly_amount: 0 });
      if (subscriptionError) {
        await db.from("platform_tenants").delete().eq("id", tenant.id);
        throw subscriptionError;
      }
      const { error: entitlementError } = await db.from("platform_entitlements").insert(
        featureKeys.map((featureKey) => ({ tenant_id: tenant.id, feature_key: featureKey, enabled: ["accounting", "sales", "purchases", "inventory", "reports"].includes(featureKey) })),
      );
      if (entitlementError && !/platform_entitlements.*(does not exist|schema cache)/i.test(entitlementError.message)) throw entitlementError;
      await writePlatformAudit(db, admin, request, { action, entityType: "tenant", entityId: tenant.id, summary: `Created client ${tenant.name}`, metadata: { slug: tenant.slug, domain: primaryDomain } });
      return NextResponse.json({ success: true, tenant });
    }

    if (action === "updateTenant") {
      const tenantId = String(body.tenantId || "");
      if (!tenantId) return NextResponse.json({ error: "Client is required" }, { status: 400 });
      const status = tenantStatuses.includes(body.status) ? body.status : "pending";
      const stage = onboardingStages.includes(body.onboardingStage) ? body.onboardingStage : "new";
      const { data, error } = await db.from("platform_tenants").update({
        name: String(body.name || "").trim(),
        primary_domain: String(body.primaryDomain || "").trim().toLowerCase(),
        status,
        active: status === "active" || status === "pending",
        onboarding_stage: stage,
        contact_name: textOrNull(body.contactName),
        contact_email: textOrNull(body.contactEmail)?.toLowerCase() || null,
        contact_phone: textOrNull(body.contactPhone),
        address: textOrNull(body.address),
        notes: textOrNull(body.notes),
        updated_at: new Date().toISOString(),
      }).eq("id", tenantId).select("id,name,status").single();
      if (error) throw error;
      await writePlatformAudit(db, admin, request, { action, entityType: "tenant", entityId: data.id, summary: `Updated client ${data.name}`, metadata: { status, onboardingStage: stage } });
      return NextResponse.json({ success: true });
    }

    if (action === "createCompany") {
      const tenantId = String(body.tenantId || "");
      const name = String(body.name || "").trim();
      const slug = cleanSlug(body.slug);
      if (!tenantId || !name || !slugPattern.test(slug)) return NextResponse.json({ error: "Client, company name and a valid slug are required" }, { status: 400 });
      const [{ count }, { data: subscription }] = await Promise.all([
        db.from("platform_companies").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
        db.from("platform_subscriptions").select("company_limit").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      if ((count || 0) >= (subscription?.company_limit || 1)) return NextResponse.json({ error: "This client has reached its company limit. Update the subscription first." }, { status: 409 });
      const { data, error } = await db.from("platform_companies").insert({
        tenant_id: tenantId,
        name,
        legal_name: textOrNull(body.legalName) || name,
        slug,
        connection_key: "UNIFIED",
        status: "pending",
        login_enabled: false,
        database_status: "pending",
        portal_enabled: false,
        notes: textOrNull(body.notes),
      }).select("id,name,slug").single();
      if (error) throw error;
      const appCompanyId = await provisionUnifiedCompany(db, tenantId, data);
      if (appCompanyId) {
        const { error: linkError } = await db.from("platform_companies").update({ app_company_id: appCompanyId, database_status: "ready", status: "active", updated_at: new Date().toISOString() }).eq("id", data.id);
        if (linkError) throw new Error(`Company was provisioned but Control could not link it. Apply the Control entitlement migration. ${linkError.message}`);
      }
      await writePlatformAudit(db, admin, request, { action, entityType: "company", entityId: data.id, summary: `Added company ${data.name}`, metadata: { tenantId, slug: data.slug } });
      return NextResponse.json({ success: true, company: { ...data, app_company_id: appCompanyId } });
    }

    if (action === "provisionCompany") {
      const companyId = String(body.companyId || "");
      const { data: platformCompany, error: companyError } = await db.from("platform_companies").select("id,tenant_id,slug,name").eq("id", companyId).single();
      if (companyError) throw companyError;
      const appCompanyId = await provisionUnifiedCompany(db, platformCompany.tenant_id, platformCompany);
      if (!appCompanyId) return NextResponse.json({ error: "Configure UNIFIED_SUPABASE_URL and UNIFIED_SUPABASE_SECRET_KEY before provisioning companies" }, { status: 503 });
      const { error: linkError } = await db.from("platform_companies").update({ app_company_id: appCompanyId, connection_key: "UNIFIED", database_status: "ready", status: "active", updated_at: new Date().toISOString() }).eq("id", platformCompany.id).eq("tenant_id", platformCompany.tenant_id);
      if (linkError) throw linkError;
      await db.from("platform_tenants").update({ onboarding_stage: "admin", updated_at: new Date().toISOString() }).eq("id", platformCompany.tenant_id);
      await writePlatformAudit(db, admin, request, { action, entityType: "company", entityId: platformCompany.id, summary: `Provisioned shared workspace for ${platformCompany.name}`, metadata: { tenantId: platformCompany.tenant_id, appCompanyId } });
      return NextResponse.json({ success: true, appCompanyId });
    }

    if (action === "createCompanyUser") {
      const platformCompanyId = String(body.companyId || "");
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      let role = companyRoles.includes(String(body.role)) ? String(body.role) : "staff";
      if (!platformCompanyId || !name || !email) return NextResponse.json({ error: "Company, full name and email are required" }, { status: 400 });
      const { data: platformCompany, error: companyError } = await db.from("platform_companies").select("id,tenant_id,app_company_id,slug,name,status,database_status").eq("id", platformCompanyId).single();
      if (companyError) throw companyError;
      if (!platformCompany.app_company_id) return NextResponse.json({ error: "Provision this company workspace before adding users" }, { status: 409 });
      const unified = getUnifiedAdmin();
      if (!unified) return NextResponse.json({ error: "Shared Supabase configuration is missing" }, { status: 503 });
      const { data: linkedCompany, error: linkedCompanyError } = await unified.from("companies").select("id").eq("id", platformCompany.app_company_id).eq("organization_id", platformCompany.tenant_id).eq("platform_company_id", platformCompany.id).maybeSingle();
      if (linkedCompanyError) throw linkedCompanyError;
      if (!linkedCompany) return NextResponse.json({ error: "Company link failed tenant verification. Re-provision this workspace before adding users." }, { status: 409 });
      const [{ data: subscription }, { data: tenantCompanies }, { data: tenant }] = await Promise.all([
        db.from("platform_subscriptions").select("user_limit").eq("tenant_id", platformCompany.tenant_id).maybeSingle(),
        db.from("platform_companies").select("app_company_id").eq("tenant_id", platformCompany.tenant_id).not("app_company_id", "is", null),
        db.from("platform_tenants").select("id,name,primary_domain").eq("id", platformCompany.tenant_id).single(),
      ]);
      if (!tenant) throw new Error("Client workspace was not found");
      const tenantCompanyIds = (tenantCompanies || []).map((company) => company.app_company_id).filter(Boolean) as string[];
      const { count: usedSeats, error: seatsError } = await unified.from("team_members").select("id", { count: "exact", head: true }).in("company_id", tenantCompanyIds).eq("active", true);
      if (seatsError) throw seatsError;
      const { count: companyUserCount, error: companyUserCountError } = await unified.from("team_members").select("id", { count: "exact", head: true }).eq("company_id", platformCompany.app_company_id).eq("active", true);
      if (companyUserCountError) throw companyUserCountError;
      if ((companyUserCount || 0) === 0) role = "admin";
      const { data: existingMembership } = await unified.from("team_members").select("id,active").eq("company_id", platformCompany.app_company_id).ilike("email", email).maybeSingle();
      if (!existingMembership?.active && (usedSeats || 0) >= (subscription?.user_limit || 10)) return NextResponse.json({ error: `This subscription has used all ${subscription?.user_limit || 10} user seats` }, { status: 409 });
      let authUser = await authUserByEmail(unified, email);
      let createdAuth = false;
      if (!authUser) {
        const temporaryPassword = `${crypto.randomUUID()}Aa1!${crypto.randomUUID()}`;
        const { data: created, error: authError } = await unified.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { name } });
        if (authError) throw authError;
        authUser = created.user;
        createdAuth = true;
      }
      const { data: member, error: memberError } = await unified.from("team_members").upsert({ company_id: platformCompany.app_company_id, name, email, phone: textOrNull(body.phone), role, active: true, auth_user_id: authUser.id }, { onConflict: "company_id,email" }).select("id").single();
      if (memberError) {
        if (createdAuth) await unified.auth.admin.deleteUser(authUser.id);
        throw memberError;
      }
      const redirect = new URL("/reset-password", `https://${tenant.primary_domain}`);
      redirect.searchParams.set("company", platformCompany.slug);
      const { data: link, error: linkError } = await unified.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: redirect.toString() } });
      if (linkError) throw linkError;
      redirect.searchParams.set("token_hash", link.properties.hashed_token);
      redirect.searchParams.set("type", "recovery");
      await sendTeamEmail({ to: email, subject: `Your ${platformCompany.name} account`, heading: "Your company account is ready", message: `Hi ${name}, you have been added to ${platformCompany.name} as ${role}. Use the secure link below to choose your password.`, actionLabel: "Set password", actionUrl: redirect.toString(), brandName: platformCompany.name, footer: `${tenant.name} · Powered by Kritech Global` });
      if (role === "admin") {
        await Promise.all([
          db.from("platform_companies").update({ login_enabled: true, status: "active", database_status: "ready", updated_at: new Date().toISOString() }).eq("id", platformCompany.id).eq("tenant_id", platformCompany.tenant_id),
          unified.from("platform_companies").update({ login_enabled: true, status: "active", database_status: "ready", updated_at: new Date().toISOString() }).eq("id", platformCompany.id).eq("tenant_id", platformCompany.tenant_id),
          db.from("platform_tenants").update({ onboarding_stage: "domain", updated_at: new Date().toISOString() }).eq("id", platformCompany.tenant_id),
        ]);
      }
      await writePlatformAudit(db, admin, request, { action, entityType: "company_user", entityId: member.id, summary: `Added ${email} to ${platformCompany.name}`, metadata: { platformCompanyId, role, createdAuth } });
      return NextResponse.json({ success: true });
    }

    if (action === "companyUserStatus") {
      const platformCompanyId = String(body.companyId || "");
      const memberId = String(body.memberId || "");
      const role = companyRoles.includes(String(body.role)) ? String(body.role) : undefined;
      const { data: platformCompany, error: companyError } = await db.from("platform_companies").select("id,tenant_id,app_company_id,name").eq("id", platformCompanyId).single();
      if (companyError) throw companyError;
      if (!platformCompany.app_company_id) return NextResponse.json({ error: "Company workspace is not provisioned" }, { status: 409 });
      const unified = getUnifiedAdmin();
      if (!unified) return NextResponse.json({ error: "Shared Supabase configuration is missing" }, { status: 503 });
      const { data: linkedCompany, error: linkedCompanyError } = await unified.from("companies").select("id").eq("id", platformCompany.app_company_id).eq("organization_id", platformCompany.tenant_id).eq("platform_company_id", platformCompany.id).maybeSingle();
      if (linkedCompanyError) throw linkedCompanyError;
      if (!linkedCompany) return NextResponse.json({ error: "Company link failed tenant verification" }, { status: 409 });
      const { data: previous, error: previousError } = await unified.from("team_members").select("id,email,role,active").eq("id", memberId).eq("company_id", platformCompany.app_company_id).single();
      if (previousError) throw previousError;
      if (Boolean(body.active) && !previous.active) {
        const [{ data: tenantCompanies }, { data: subscription }] = await Promise.all([
          db.from("platform_companies").select("app_company_id").eq("tenant_id", platformCompany.tenant_id).not("app_company_id", "is", null),
          db.from("platform_subscriptions").select("user_limit").eq("tenant_id", platformCompany.tenant_id).maybeSingle(),
        ]);
        const tenantCompanyIds = (tenantCompanies || []).map((company) => company.app_company_id).filter(Boolean) as string[];
        const { count: usedSeats, error: seatError } = await unified.from("team_members").select("id", { count: "exact", head: true }).in("company_id", tenantCompanyIds).eq("active", true);
        if (seatError) throw seatError;
        if ((usedSeats || 0) >= (subscription?.user_limit || 10)) return NextResponse.json({ error: `This subscription has used all ${subscription?.user_limit || 10} user seats` }, { status: 409 });
      }
      const update: { active: boolean; role?: string } = { active: Boolean(body.active) };
      if (role) update.role = role;
      const { data: member, error } = await unified.from("team_members").update(update).eq("id", memberId).eq("company_id", platformCompany.app_company_id).select("id,email,role,active").single();
      if (error) throw error;
      const { count: activeAdmins, error: activeAdminError } = await unified.from("team_members").select("id", { count: "exact", head: true }).eq("company_id", platformCompany.app_company_id).eq("role", "admin").eq("active", true);
      if (activeAdminError) throw activeAdminError;
      if ((activeAdmins || 0) === 0) {
        await unified.from("team_members").update({ active: previous.active, role: previous.role }).eq("id", previous.id).eq("company_id", platformCompany.app_company_id);
        return NextResponse.json({ error: "Every company must keep at least one active administrator" }, { status: 409 });
      }
      await writePlatformAudit(db, admin, request, { action, entityType: "company_user", entityId: member.id, summary: `Updated ${member.email} in ${platformCompany.name}`, metadata: { role: member.role, active: member.active } });
      return NextResponse.json({ success: true });
    }

    if (action === "updateCompany") {
      const companyId = String(body.companyId || "");
      const { data: currentCompany, error: currentCompanyError } = await db.from("platform_companies").select("id,tenant_id,app_company_id,status,database_status,connection_key").eq("id", companyId).single();
      if (currentCompanyError) throw currentCompanyError;
      const status = companyStatuses.includes(body.status) ? body.status : currentCompany.status;
      const databaseStatus = databaseStatuses.includes(body.databaseStatus) ? body.databaseStatus : currentCompany.database_status;
      const loginEnabled = Boolean(body.loginEnabled) && status === "active" && databaseStatus === "ready";
      if (loginEnabled) {
        if (!currentCompany.app_company_id) return NextResponse.json({ error: "Provision the shared company workspace first" }, { status: 409 });
        const unified = getUnifiedAdmin();
        if (!unified) return NextResponse.json({ error: "Shared Supabase configuration is missing" }, { status: 503 });
        const { count, error: adminCountError } = await unified.from("team_members").select("id", { count: "exact", head: true }).eq("company_id", currentCompany.app_company_id).eq("role", "admin").eq("active", true);
        if (adminCountError) throw adminCountError;
        if ((count || 0) === 0) return NextResponse.json({ error: "Add at least one active company administrator before enabling login" }, { status: 409 });
      }
      const { data, error } = await db.from("platform_companies").update({
        name: String(body.name || "").trim(),
        legal_name: textOrNull(body.legalName),
        connection_key: currentCompany.app_company_id ? "UNIFIED" : currentCompany.connection_key,
        status,
        login_enabled: loginEnabled,
        database_status: databaseStatus,
        portal_enabled: Boolean(body.portalEnabled),
        notes: textOrNull(body.notes),
        updated_at: new Date().toISOString(),
      }).eq("id", companyId).select("id,name").single();
      if (error) throw error;
      if (currentCompany.app_company_id) {
        const unified = getUnifiedAdmin();
        if (unified) {
          const { error: mirrorError } = await unified.from("platform_companies").update({ name: String(body.name || "").trim(), legal_name: textOrNull(body.legalName), status, login_enabled: loginEnabled, database_status: databaseStatus, portal_enabled: Boolean(body.portalEnabled), updated_at: new Date().toISOString() }).eq("id", companyId).eq("tenant_id", currentCompany.tenant_id);
          if (mirrorError) throw mirrorError;
          await unified.from("companies").update({ name: String(body.name || "").trim(), active: status === "active" }).eq("id", currentCompany.app_company_id).eq("organization_id", currentCompany.tenant_id);
        }
      }
      await writePlatformAudit(db, admin, request, { action, entityType: "company", entityId: data.id, summary: `Updated company ${data.name}`, metadata: { status, databaseStatus, loginEnabled } });
      return NextResponse.json({ success: true });
    }

    if (action === "updateSubscription") {
      const tenantId = String(body.tenantId || "");
      const status = subscriptionStatuses.includes(body.status) ? body.status : "trial";
      const record = {
        tenant_id: tenantId,
        plan_name: String(body.planName || "Starter").trim(),
        status,
        starts_on: textOrNull(body.startsOn),
        expires_on: textOrNull(body.expiresOn),
        company_limit: Math.max(1, Number(body.companyLimit) || 1),
        user_limit: Math.max(1, Number(body.userLimit) || 10),
        monthly_amount: Math.max(0, Number(body.monthlyAmount) || 0),
        notes: textOrNull(body.notes),
        updated_at: new Date().toISOString(),
      };
      const { error } = await db.from("platform_subscriptions").upsert(record, { onConflict: "tenant_id" });
      if (error) throw error;
      const requestedFeatures = body.features && typeof body.features === "object" ? body.features as Record<string, unknown> : {};
      const { error: entitlementError } = await db.from("platform_entitlements").upsert(
        featureKeys.map((featureKey) => ({ tenant_id: tenantId, feature_key: featureKey, enabled: Boolean(requestedFeatures[featureKey]), updated_at: new Date().toISOString() })),
        { onConflict: "tenant_id,feature_key" },
      );
      if (entitlementError) throw new Error(`Feature controls could not be saved. Apply the Control entitlement migration first. ${entitlementError.message}`);
      await writePlatformAudit(db, admin, request, { action, entityType: "subscription", entityId: tenantId, summary: `Updated ${record.plan_name} subscription`, metadata: { status, expiresOn: record.expires_on } });
      return NextResponse.json({ success: true });
    }

    if (action === "createAdmin") {
      if (!canManageAdmins(admin)) return NextResponse.json({ error: "Only a super administrator can add platform users" }, { status: 403 });
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const role = adminRoles.includes(body.role) ? body.role : "viewer";
      if (!name || !email) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
      const temporaryPassword = `${crypto.randomUUID()}Aa1!${crypto.randomUUID()}`;
      const { data: auth, error: authError } = await db.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { name, platform_role: role } });
      if (authError) throw authError;
      const { data: created, error } = await db.from("platform_admins").insert({ auth_user_id: auth.user.id, name, email, role, active: true }).select("id,name,email").single();
      if (error) { await db.auth.admin.deleteUser(auth.user.id); throw error; }
      const base = process.env.PLATFORM_ADMIN_URL || "http://localhost:3010";
      const redirect = new URL("/platform-admin/reset-password", base);
      const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: redirect.toString() } });
      if (linkError) throw linkError;
      redirect.searchParams.set("token_hash", link.properties.hashed_token);
      redirect.searchParams.set("type", "recovery");
      await sendTeamEmail({ to: email, subject: "Your Kritech Control account", heading: "Platform access granted", message: `Hi ${name}, you have been added as ${role.replace("_", " ")}. Use the secure link below to set your password.`, actionLabel: "Set password", actionUrl: redirect.toString(), brandName: "Kritech Global", footer: "Kritech Control · Platform administration" });
      await writePlatformAudit(db, admin, request, { action, entityType: "platform_admin", entityId: created.id, summary: `Added platform administrator ${created.email}`, metadata: { role } });
      return NextResponse.json({ success: true });
    }

    if (action === "adminStatus") {
      if (!canManageAdmins(admin)) return NextResponse.json({ error: "Only a super administrator can change platform users" }, { status: 403 });
      const adminId = String(body.adminId || "");
      if (adminId === admin.id && !body.active) return NextResponse.json({ error: "You cannot deactivate your own account" }, { status: 400 });
      const role = adminRoles.includes(body.role) ? body.role : undefined;
      const update: { active: boolean; role?: string; updated_at: string } = { active: Boolean(body.active), updated_at: new Date().toISOString() };
      if (role) update.role = role;
      const { data, error } = await db.from("platform_admins").update(update).eq("id", adminId).select("id,email,role,active").single();
      if (error) throw error;
      await writePlatformAudit(db, admin, request, { action, entityType: "platform_admin", entityId: data.id, summary: `Updated platform access for ${data.email}`, metadata: { role: data.role, active: data.active } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported platform action" }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Platform action failed" }, { status: 500 });
  }
}
