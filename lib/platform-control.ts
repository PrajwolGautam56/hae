import { createClient } from "@supabase/supabase-js";

export const COMPANY_COOKIE = "hae_company";

export type PlatformCompany = {
  id: string;
  slug: string;
  name: string;
  connectionKey: string | null;
  status: "active" | "pending" | "disabled";
  loginEnabled: boolean;
};

export type TenantCompanies = {
  tenant: { id: string; slug: string; name: string; domain: string };
  companies: PlatformCompany[];
};

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
      slug: "hamro-afno",
      name: "Hamro Aafno Enterprises",
      connectionKey: "HAE",
      status: "active",
      loginEnabled: true,
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      slug: "ag-manufacturing",
      name: "A.G. Manufacturing & Trading",
      connectionKey: "AG",
      status: "pending",
      loginEnabled: false,
    },
  ],
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
  const control = getControlAdmin();
  if (control) {
    const { data: tenant } = await control
      .from("platform_tenants")
      .select("id,slug,name,primary_domain")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();
    if (tenant) {
      const { data: companies } = await control
        .from("platform_companies")
        .select("id,slug,name,connection_key,status,login_enabled")
        .eq("tenant_id", tenant.id)
        .order("sort_order")
        .order("name");
      if (companies) return {
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, domain: tenant.primary_domain },
        companies: companies.map((company) => ({
          id: company.id,
          slug: company.slug,
          name: company.name,
          connectionKey: company.connection_key,
          status: company.status as PlatformCompany["status"],
          loginEnabled: company.login_enabled,
        })),
      };
    }
  }
  return slug === fallback.tenant.slug ? fallback : null;
}

export async function loginCompany(rawHost: string | null, companySlug: string) {
  const registry = await companiesForHost(rawHost);
  const company = registry?.companies.find((item) => item.slug === companySlug);
  if (!registry || !company) return null;
  return { tenant: registry.tenant, company };
}

export function businessAuthConfig(connectionKey: string | null) {
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
