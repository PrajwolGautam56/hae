import { createClient } from "@supabase/supabase-js";

export const COMPANY_COOKIE = "hae_company";

export type PlatformCompany = {
  id: string;
  tenantId: string;
  appCompanyId: string | null;
  slug: string;
  name: string;
  connectionKey: string | null;
  status: "active" | "pending" | "disabled";
  loginEnabled: boolean;
};

export type TenantCompanies = {
  tenant: { id: string; slug: string; name: string; domain: string };
  companies: PlatformCompany[];
  subscription: { planName: string; status: string; companyLimit: number; userLimit: number; expiresOn: string | null } | null;
  entitlements: Record<string, boolean>;
};

export const DEFAULT_ENTITLEMENTS = [
  "accounting", "sales", "purchases", "inventory", "manufacturing", "crm",
  "tasks", "orders", "customer_portal", "cash_bank", "cheques", "reports",
] as const;

const fallback: TenantCompanies = {
  tenant: {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "hamro",
    name: "Hamro Business Group",
    domain: "hamro.kritechglobal.com",
  },
  companies: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      tenantId: "10000000-0000-4000-8000-000000000001",
      appCompanyId: null,
      slug: "hamro-afno",
      name: "Hamro Aafno Enterprises",
      connectionKey: "HAE",
      status: "active",
      loginEnabled: true,
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      tenantId: "10000000-0000-4000-8000-000000000001",
      appCompanyId: null,
      slug: "ag-manufacturing",
      name: "A.G. Manufacturing & Trading",
      connectionKey: "AG",
      status: "pending",
      loginEnabled: false,
    },
  ],
  subscription: { planName: "Internal", status: "active", companyLimit: 5, userLimit: 50, expiresOn: null },
  entitlements: Object.fromEntries(DEFAULT_ENTITLEMENTS.map((feature) => [feature, true])),
};
const registryCache = new Map<string, { expires: number; value: TenantCompanies | null }>();
const rememberRegistry = (slug: string, value: TenantCompanies | null) => {
  registryCache.set(slug, { value, expires: Date.now() + 15_000 });
  return value;
};

function cleanHost(rawHost?: string | null) {
  return String(rawHost || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
}

export function tenantSlugForHost(rawHost?: string | null) {
  const host = cleanHost(rawHost);
  if (!host || host === "localhost" || host === "127.0.0.1") return process.env.DEFAULT_TENANT_SLUG || "hamro";
  if (host === "crm.hamroafno.com.np" || host === "m.hamroafno.com.np") return "hamro";
  const root = (process.env.PLATFORM_ROOT_DOMAIN || "kritechglobal.com").toLowerCase();
  if (host.endsWith(`.${root}`)) return host.slice(0, -(root.length + 1)).split(".").pop() || "hamro";
  return process.env.DEFAULT_TENANT_SLUG || "hamro";
}

export function controlConfig() {
  const url = process.env.CONTROL_SUPABASE_URL;
  const publishableKey = process.env.CONTROL_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.CONTROL_SUPABASE_SECRET_KEY;
  return url && publishableKey && secret ? { url, publishableKey, secret } : null;
}

export function getControlAdmin() {
  const config = controlConfig();
  if (!config) return null;
  const { url, secret } = config;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function companiesForHost(rawHost?: string | null): Promise<TenantCompanies | null> {
  const slug = tenantSlugForHost(rawHost);
  const cached = registryCache.get(slug);
  if (cached && cached.expires > Date.now()) return cached.value;
  const control = getControlAdmin();
  if (control) {
    const { data: tenant } = await control
      .from("platform_tenants")
      .select("id,slug,name,primary_domain")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();
    if (tenant) {
      let companiesResult: { data: Array<Record<string, unknown>> | null; error: { message: string } | null } = await control
        .from("platform_companies")
        .select("id,app_company_id,slug,name,connection_key,status,login_enabled")
        .eq("tenant_id", tenant.id)
        .order("sort_order")
        .order("name");
      if (companiesResult.error && /app_company_id.*(does not exist|schema cache)/i.test(companiesResult.error.message)) {
        companiesResult = await control
          .from("platform_companies")
          .select("id,slug,name,connection_key,status,login_enabled")
          .eq("tenant_id", tenant.id)
          .order("sort_order")
          .order("name");
      }
      const [{ data: subscription }, { data: entitlementRows }] = await Promise.all([
        control.from("platform_subscriptions").select("plan_name,status,company_limit,user_limit,expires_on").eq("tenant_id", tenant.id).maybeSingle(),
        control.from("platform_entitlements").select("feature_key,enabled").eq("tenant_id", tenant.id),
      ]);
      const companies = companiesResult.data;
      if (companies) return rememberRegistry(slug, {
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, domain: tenant.primary_domain },
        companies: companies.map((company) => ({
          id: String(company.id),
          tenantId: tenant.id,
          appCompanyId: "app_company_id" in company ? String(company.app_company_id || "") || null : null,
          slug: String(company.slug),
          name: String(company.name),
          connectionKey: company.connection_key ? String(company.connection_key) : null,
          status: company.status as PlatformCompany["status"],
          loginEnabled: Boolean(company.login_enabled),
        })),
        subscription: subscription ? {
          planName: subscription.plan_name,
          status: subscription.status,
          companyLimit: subscription.company_limit,
          userLimit: subscription.user_limit,
          expiresOn: subscription.expires_on,
        } : null,
        entitlements: entitlementRows?.length
          ? Object.fromEntries(entitlementRows.map((row) => [row.feature_key, row.enabled]))
          : Object.fromEntries(DEFAULT_ENTITLEMENTS.map((feature) => [feature, tenant.slug === "hamro" || ["accounting", "sales", "purchases", "inventory", "reports"].includes(feature)])),
      });
    }
  }
  return rememberRegistry(slug, slug === fallback.tenant.slug ? fallback : null);
}

export async function loginCompany(rawHost: string | null, companySlug: string) {
  const registry = await companiesForHost(rawHost);
  const company = registry?.companies.find((item) => item.slug === companySlug);
  if (!registry || !company) return null;
  return { tenant: registry.tenant, company, subscription: registry.subscription, entitlements: registry.entitlements };
}

export function businessAuthConfig(connectionKey: string | null) {
  const unifiedUrl = process.env.UNIFIED_SUPABASE_URL;
  const unifiedPublishableKey = process.env.UNIFIED_SUPABASE_PUBLISHABLE_KEY;
  const unifiedSecretKey = process.env.UNIFIED_SUPABASE_SECRET_KEY;
  if (unifiedUrl && unifiedPublishableKey && unifiedSecretKey) {
    return { url: unifiedUrl, publishableKey: unifiedPublishableKey, secretKey: unifiedSecretKey };
  }
  if (connectionKey === "HAE") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    return url && publishableKey && secretKey ? { url, publishableKey, secretKey } : null;
  }
  if (connectionKey === "AG") {
    const url = process.env.AG_SUPABASE_URL;
    const publishableKey = process.env.AG_SUPABASE_PUBLISHABLE_KEY;
    const secretKey = process.env.AG_SUPABASE_SECRET_KEY;
    return url && publishableKey && secretKey ? { url, publishableKey, secretKey } : null;
  }
  return null;
}
