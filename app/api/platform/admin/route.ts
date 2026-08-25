import { NextResponse } from "next/server";
import { authorizePlatformAdmin, canManage, canManageAdmins, writePlatformAudit } from "../../../../lib/platform-admin";
import { sendTeamEmail } from "../../../../lib/resend-email";

export const dynamic = "force-dynamic";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const tenantStatuses = ["pending", "active", "suspended", "expired"];
const onboardingStages = ["new", "database", "admin", "domain", "ready"];
const companyStatuses = ["active", "pending", "disabled"];
const databaseStatuses = ["pending", "connecting", "ready", "error"];
const subscriptionStatuses = ["trial", "active", "past_due", "cancelled", "expired"];
const adminRoles = ["super_admin", "operator", "support", "viewer"];

function cleanSlug(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function textOrNull(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

export async function GET(request: Request) {
  try {
    const { db, admin } = await authorizePlatformAdmin(request);
    if (!admin) return NextResponse.json({ error: "Platform administrator sign-in required" }, { status: 401 });
    const [tenants, companies, subscriptions, administrators, audits] = await Promise.all([
      db.from("platform_tenants").select("id,slug,name,primary_domain,status,active,contact_name,contact_email,contact_phone,address,notes,onboarding_stage,created_at,updated_at").order("created_at", { ascending: false }),
      db.from("platform_companies").select("id,tenant_id,slug,name,legal_name,connection_key,status,login_enabled,sort_order,project_ref,region,database_status,portal_enabled,notes,created_at,updated_at").order("created_at", { ascending: false }),
      db.from("platform_subscriptions").select("id,tenant_id,plan_name,status,starts_on,expires_on,company_limit,user_limit,monthly_amount,notes,updated_at"),
      db.from("platform_admins").select("id,name,email,role,active,last_login_at,created_at").order("created_at"),
      db.from("platform_audit_logs").select("id,admin_email,action,entity_type,entity_id,summary,metadata,ip_address,created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    const firstError = [tenants.error, companies.error, subscriptions.error, administrators.error, audits.error].find(Boolean);
    if (firstError) throw firstError;
    return NextResponse.json({
      viewer: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      tenants: tenants.data || [],
      companies: companies.data || [],
      subscriptions: subscriptions.data || [],
      administrators: administrators.data || [],
      audits: audits.data || [],
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
        connection_key: textOrNull(body.connectionKey)?.toUpperCase() || null,
        status: "pending",
        login_enabled: false,
        database_status: "pending",
        portal_enabled: false,
        notes: textOrNull(body.notes),
      }).select("id,name,slug").single();
      if (error) throw error;
      await writePlatformAudit(db, admin, request, { action, entityType: "company", entityId: data.id, summary: `Added company ${data.name}`, metadata: { tenantId, slug: data.slug } });
      return NextResponse.json({ success: true, company: data });
    }

    if (action === "updateCompany") {
      const companyId = String(body.companyId || "");
      const status = companyStatuses.includes(body.status) ? body.status : "pending";
      const databaseStatus = databaseStatuses.includes(body.databaseStatus) ? body.databaseStatus : "pending";
      const loginEnabled = Boolean(body.loginEnabled) && status === "active" && databaseStatus === "ready";
      const { data, error } = await db.from("platform_companies").update({
        name: String(body.name || "").trim(),
        legal_name: textOrNull(body.legalName),
        connection_key: textOrNull(body.connectionKey)?.toUpperCase() || null,
        status,
        login_enabled: loginEnabled,
        project_ref: textOrNull(body.projectRef),
        region: textOrNull(body.region),
        database_status: databaseStatus,
        portal_enabled: Boolean(body.portalEnabled),
        notes: textOrNull(body.notes),
        updated_at: new Date().toISOString(),
      }).eq("id", companyId).select("id,name").single();
      if (error) throw error;
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
