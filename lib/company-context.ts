import { cookies, headers } from "next/headers";
import type { getSupabaseAdmin } from "./supabase-server";
import { companiesForHost, COMPANY_COOKIE, type PlatformCompany } from "./platform-control";
import { getCurrentMember } from "./current-member";

type Db = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

export type BusinessCompany = {
  id: string;
  name: string;
  currency?: string;
  fiscal_year?: string;
  slug?: string | null;
  organization_id?: string | null;
  platform_company_id?: string | null;
  settings?: Record<string, unknown>;
};

const companyFields = "id,name,currency,fiscal_year,slug,organization_id,platform_company_id,settings";
const legacyCompanyFields = "id,name,currency,fiscal_year";

function missingTenantColumns(message?: string) {
  return Boolean(message && /(slug|organization_id|platform_company_id|settings).*(does not exist|schema cache)/i.test(message));
}

export async function resolvePlatformBusinessCompany(db: Db, company: PlatformCompany) {
  if (company.appCompanyId) {
    const byId = await db.from("companies").select(companyFields).eq("id", company.appCompanyId).eq("organization_id", company.tenantId).maybeSingle();
    if (!byId.error && byId.data) return byId.data as BusinessCompany;
    if (byId.error && !missingTenantColumns(byId.error.message)) throw byId.error;
  }
  const bySlug = await db.from("companies").select(companyFields).eq("organization_id", company.tenantId).eq("slug", company.slug).maybeSingle();
  if (!bySlug.error && bySlug.data) return bySlug.data as BusinessCompany;
  if (bySlug.error && !missingTenantColumns(bySlug.error.message)) throw bySlug.error;
  if (company.connectionKey === "HAE") {
    const legacy = await db.from("companies").select(legacyCompanyFields).order("created_at").limit(1).maybeSingle();
    if (legacy.error) throw legacy.error;
    return legacy.data as BusinessCompany | null;
  }
  return null;
}

export async function getSelectedBusinessCompany(db: Db) {
  const companySlug = (await cookies()).get(COMPANY_COOKIE)?.value;
  if (companySlug) {
    const requestHeaders = await headers();
    const registry = await companiesForHost(requestHeaders.get("x-forwarded-host") || requestHeaders.get("host"));
    let query = db.from("companies").select(companyFields).eq("slug", companySlug).eq("active", true);
    if (registry?.tenant.id) query = query.eq("organization_id", registry.tenant.id);
    const selected = await query.maybeSingle();
    if (!selected.error && selected.data) return selected.data as BusinessCompany;
    if (selected.error && !missingTenantColumns(selected.error.message)) throw selected.error;
    if (process.env.UNIFIED_SUPABASE_URL) throw new Error("Selected company does not belong to this workspace");
  }
  if (process.env.UNIFIED_SUPABASE_URL) throw new Error("Select a company before continuing");
  const legacy = await db.from("companies").select(legacyCompanyFields).order("created_at").limit(1).maybeSingle();
  if (legacy.error) throw legacy.error;
  if (!legacy.data) throw new Error("Company not found");
  return legacy.data as BusinessCompany;
}

export async function getBusinessContext(db: Db) {
  const company = await getSelectedBusinessCompany(db);
  const member = await getCurrentMember(db, company.id);
  if (!member) throw new Error("Active team access is required");
  return { company, member };
}
