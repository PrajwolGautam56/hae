import { NextRequest, NextResponse } from "next/server";

const STAFF_PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/api/auth/login", "/api/auth/logout", "/api/auth/forgot-password", "/api/platform/companies"];
const CLIENT_PUBLIC_PATHS = ["/client-login", "/client-forgot-password", "/client-reset-password", "/api/client/auth/login", "/api/client/auth/logout", "/api/client/auth/forgot-password"];
const PWA_PUBLIC_PATHS = ["/manifest.webmanifest", "/sw.js", "/offline", "/icons"];
const PLATFORM_PUBLIC_PATHS = ["/platform-admin/login", "/platform-admin/forgot-password", "/platform-admin/reset-password", "/api/platform/auth/login", "/api/platform/auth/logout", "/api/platform/auth/forgot-password", "/api/platform/auth/reset-password"];
const COMPANY_COOKIE = "hae_company";
const PLATFORM_ACCESS_COOKIE = "kritech_platform_access";
const PLATFORM_REFRESH_COOKIE = "kritech_platform_refresh";

type BusinessConfig = { url: string; key: string; secret: string };

function tenantSlugForHost(host?: string) {
  if (!host || host === "localhost" || host === "127.0.0.1") return process.env.DEFAULT_TENANT_SLUG || "hamro";
  if (host === "crm.hamroafno.com.np" || host === "m.hamroafno.com.np") return "hamro";
  const root = (process.env.PLATFORM_ROOT_DOMAIN || "kritechglobal.com").toLowerCase();
  return host.endsWith(`.${root}`) ? host.slice(0, -(root.length + 1)).split(".").pop() || "hamro" : process.env.DEFAULT_TENANT_SLUG || "hamro";
}

function businessConfig(companySlug: string | undefined): BusinessConfig | null {
  const unifiedUrl = process.env.UNIFIED_SUPABASE_URL;
  const unifiedKey = process.env.UNIFIED_SUPABASE_PUBLISHABLE_KEY;
  const unifiedSecret = process.env.UNIFIED_SUPABASE_SECRET_KEY;
  if (companySlug && unifiedUrl && unifiedKey && unifiedSecret) return { url: unifiedUrl, key: unifiedKey, secret: unifiedSecret };
  if (companySlug === "hamro-afno") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.SUPABASE_SECRET_KEY;
    return url && key && secret ? { url, key, secret } : null;
  }
  if (companySlug === "ag-manufacturing") {
    const url = process.env.AG_SUPABASE_URL;
    const key = process.env.AG_SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.AG_SUPABASE_SECRET_KEY;
    return url && key && secret ? { url, key, secret } : null;
  }
  return null;
}

function platformConfig(): BusinessConfig | null {
  const url = process.env.CONTROL_SUPABASE_URL;
  const key = process.env.CONTROL_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.CONTROL_SUPABASE_SECRET_KEY;
  return url && key && secret ? { url, key, secret } : null;
}

function matches(path: string, entries: string[]) {
  return entries.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

async function lookupIdentity(token: string, table: "team_members" | "parties", activeColumn: "active" | "portal_active", config: BusinessConfig, companySlug?: string, tenantSlug?: string) {
  const validation = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.key, Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!validation.ok) return false;
  const user = await validation.json() as { id?: string };
  if (!user.id) return false;
  let companyFilter = "";
  if (companySlug) {
    let organizationFilter = "";
    if (process.env.UNIFIED_SUPABASE_URL && tenantSlug) {
      const tenantResponse = await fetch(`${config.url}/rest/v1/platform_tenants?slug=eq.${encodeURIComponent(tenantSlug)}&active=eq.true&select=id&limit=1`, { headers: { apikey: config.secret, Authorization: `Bearer ${config.secret}` }, cache: "no-store" });
      if (!tenantResponse.ok) return false;
      const tenants = await tenantResponse.json() as Array<{ id: string }>;
      if (!tenants[0]?.id) return false;
      organizationFilter = `&organization_id=eq.${encodeURIComponent(tenants[0].id)}`;
    }
    const companyResponse = await fetch(`${config.url}/rest/v1/companies?slug=eq.${encodeURIComponent(companySlug)}${organizationFilter}&active=eq.true&select=id&limit=1`, { headers: { apikey: config.secret, Authorization: `Bearer ${config.secret}` }, cache: "no-store" });
    if (companyResponse.ok) {
      const companies = await companyResponse.json() as Array<{ id: string }>;
      if (!companies[0]?.id) return false;
      companyFilter = `&company_id=eq.${encodeURIComponent(companies[0].id)}`;
    } else if (process.env.UNIFIED_SUPABASE_URL || companySlug !== "hamro-afno") return false;
  }
  const identity = await fetch(`${config.url}/rest/v1/${table}?auth_user_id=eq.${encodeURIComponent(user.id)}&${activeColumn}=eq.true${companyFilter}&select=id&limit=1`, {
    headers: { apikey: config.secret, Authorization: `Bearer ${config.secret}` },
    cache: "no-store",
  });
  return identity.ok && ((await identity.json()) as Array<{ id: string }>).length > 0;
}

async function lookupPlatformIdentity(token: string, config: BusinessConfig) {
  const validation = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.key, Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!validation.ok) return false;
  const user = await validation.json() as { id?: string; email?: string };
  if (!user.id || !user.email) return false;
  const query = `or=(auth_user_id.eq.${encodeURIComponent(user.id)},email.eq.${encodeURIComponent(user.email.toLowerCase())})&active=eq.true&select=id&limit=1`;
  const identity = await fetch(`${config.url}/rest/v1/platform_admins?${query}`, { headers: { apikey: config.secret, Authorization: `Bearer ${config.secret}` }, cache: "no-store" });
  return identity.ok && ((await identity.json()) as Array<{ id: string }>).length > 0;
}

async function refreshSession(refreshToken: string, config: BusinessConfig) {
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: config.key, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }), cache: "no-store" });
  if (!response.ok) return null;
  return await response.json() as { access_token: string; refresh_token: string; expires_in: number };
}

function continueWithClientSession(request: NextRequest, session: { access_token: string; refresh_token: string; expires_in: number }) {
  request.cookies.set("hae_party_access_token", session.access_token);
  request.cookies.set("hae_party_refresh_token", session.refresh_token);
  const headers = new Headers(request.headers);
  headers.set("cookie", request.cookies.toString());
  const response = NextResponse.next({ request: { headers } });
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("hae_party_access_token", session.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: session.expires_in });
  response.cookies.set("hae_party_refresh_token", session.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

function clearClientSession(response: NextResponse) {
  response.cookies.set("hae_party_access_token", "", { path: "/", maxAge: 0 });
  response.cookies.set("hae_party_refresh_token", "", { path: "/", maxAge: 0 });
  return response;
}

function clearStaffSession(response: NextResponse) {
  response.cookies.set("hae_access_token", "", { path: "/", maxAge: 0 });
  response.cookies.set("hae_refresh_token", "", { path: "/", maxAge: 0 });
  response.cookies.set(COMPANY_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

function continueWithPlatformSession(request: NextRequest, session: { access_token: string; refresh_token: string; expires_in: number }) {
  request.cookies.set(PLATFORM_ACCESS_COOKIE, session.access_token);
  request.cookies.set(PLATFORM_REFRESH_COOKIE, session.refresh_token);
  const headers = new Headers(request.headers);
  headers.set("cookie", request.cookies.toString());
  const response = NextResponse.next({ request: { headers } });
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(PLATFORM_ACCESS_COOKIE, session.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: session.expires_in });
  response.cookies.set(PLATFORM_REFRESH_COOKIE, session.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

function clearPlatformSession(response: NextResponse) {
  response.cookies.set(PLATFORM_ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(PLATFORM_REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const customerHost = process.env.CLIENT_PORTAL_HOST?.toLowerCase();
  const platformAdminHost = (process.env.PLATFORM_ADMIN_HOST || "admin.kritechglobal.com").toLowerCase();
  const controlOnly = process.env.PLATFORM_CONTROL_ONLY === "true";
  const isCustomerHost = Boolean(customerHost && host === customerHost);
  const isPlatformHost = controlOnly || host === platformAdminHost;
  const isClientPath = path === "/client" || path.startsWith("/client/") || path === "/api/client" || path.startsWith("/api/client/");
  const isPlatformPath = path === "/platform-admin" || path.startsWith("/platform-admin/") || path === "/api/platform/admin" || path.startsWith("/api/platform/auth/");
  const tenantSlug = tenantSlugForHost(host);

  if (isPlatformHost && path === "/") return NextResponse.redirect(new URL("/platform-admin", request.url));
  if (isPlatformHost && !isPlatformPath && !matches(path, PWA_PUBLIC_PATHS)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.redirect(new URL("/platform-admin", request.url));
  }
  if (isPlatformPath) {
    if (matches(path, PLATFORM_PUBLIC_PATHS)) return NextResponse.next();
    const config = platformConfig();
    if (!config) return NextResponse.json({ error: "Kritech Control configuration is missing" }, { status: 503 });
    const token = request.cookies.get(PLATFORM_ACCESS_COOKIE)?.value;
    if (token && await lookupPlatformIdentity(token, config)) return NextResponse.next();
    const refreshToken = request.cookies.get(PLATFORM_REFRESH_COOKIE)?.value;
    if (refreshToken) {
      const session = await refreshSession(refreshToken, config);
      if (session && await lookupPlatformIdentity(session.access_token, config)) return continueWithPlatformSession(request, session);
    }
    if (path.startsWith("/api/")) return clearPlatformSession(NextResponse.json({ error: "Platform administrator sign-in required" }, { status: 401 }));
    return clearPlatformSession(NextResponse.redirect(new URL("/platform-admin/login", request.url)));
  }

  if (isCustomerHost && path === "/") return NextResponse.redirect(new URL("/client", request.url));
  if (isCustomerHost && matches(path, STAFF_PUBLIC_PATHS)) return NextResponse.redirect(new URL("/client-login", request.url));
  if (matches(path, [...STAFF_PUBLIC_PATHS, ...CLIENT_PUBLIC_PATHS, ...PWA_PUBLIC_PATHS])) return NextResponse.next();

  if (isCustomerHost && !isClientPath) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.redirect(new URL("/client", request.url));
  }

  if (isClientPath) {
    const selectedCompany = request.cookies.get(COMPANY_COOKIE)?.value;
    const clientConfig = businessConfig(selectedCompany);
    if (!clientConfig) return NextResponse.json({ error: "Customer portal configuration is missing" }, { status: 503 });
    const token = request.cookies.get("hae_party_access_token")?.value;
    if (token && await lookupIdentity(token, "parties", "portal_active", clientConfig, selectedCompany, tenantSlug)) return NextResponse.next();
    const refreshToken = request.cookies.get("hae_party_refresh_token")?.value;
    if (refreshToken) {
      const session = await refreshSession(refreshToken, clientConfig);
      if (session && await lookupIdentity(session.access_token, "parties", "portal_active", clientConfig, selectedCompany, tenantSlug)) return continueWithClientSession(request, session);
    }
    if (path.startsWith("/api/")) return clearClientSession(NextResponse.json({ error: "Customer sign-in required" }, { status: 401 }));
    const login = new URL("/client-login", request.url);
    return clearClientSession(NextResponse.redirect(login));
  }

  const selectedCompany = request.cookies.get(COMPANY_COOKIE)?.value;
  const selectedConfig = businessConfig(selectedCompany);
  const token = request.cookies.get("hae_access_token")?.value;
  if (selectedConfig && token && await lookupIdentity(token, "team_members", "active", selectedConfig, selectedCompany, tenantSlug)) return NextResponse.next();
  if (path.startsWith("/api/")) return clearStaffSession(NextResponse.json({ error: "Authentication required" }, { status: 401 }));
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${path}${request.nextUrl.search}`);
  return clearStaffSession(NextResponse.redirect(login));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|hamro-afno-logo.jpeg).*)"] };
