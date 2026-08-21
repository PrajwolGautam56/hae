import { NextRequest, NextResponse } from "next/server";

const STAFF_PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/api/auth/login", "/api/auth/logout", "/api/auth/forgot-password"];
const CLIENT_PUBLIC_PATHS = ["/client-login", "/client-forgot-password", "/client-reset-password", "/api/client/auth/login", "/api/client/auth/logout", "/api/client/auth/forgot-password"];
const PWA_PUBLIC_PATHS = ["/manifest.webmanifest", "/sw.js", "/offline", "/icons"];

function matches(path: string, entries: string[]) {
  return entries.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

async function lookupIdentity(token: string, table: "team_members" | "parties", activeColumn: "active" | "portal_active") {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !secret) return false;
  const validation = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!validation.ok) return false;
  const user = await validation.json() as { id?: string };
  if (!user.id) return false;
  const identity = await fetch(`${url}/rest/v1/${table}?auth_user_id=eq.${encodeURIComponent(user.id)}&${activeColumn}=eq.true&select=id&limit=1`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  return identity.ok && ((await identity.json()) as Array<{ id: string }>).length > 0;
}

async function refreshSession(refreshToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }), cache: "no-store" });
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
  return response;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const customerHost = process.env.CLIENT_PORTAL_HOST?.toLowerCase();
  const isCustomerHost = Boolean(customerHost && host === customerHost);
  const isClientPath = path === "/client" || path.startsWith("/client/") || path === "/api/client" || path.startsWith("/api/client/");

  if (isCustomerHost && path === "/") return NextResponse.redirect(new URL("/client", request.url));
  if (isCustomerHost && matches(path, STAFF_PUBLIC_PATHS)) return NextResponse.redirect(new URL("/client-login", request.url));
  if (matches(path, [...STAFF_PUBLIC_PATHS, ...CLIENT_PUBLIC_PATHS, ...PWA_PUBLIC_PATHS])) return NextResponse.next();

  if (isCustomerHost && !isClientPath) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.redirect(new URL("/client", request.url));
  }

  if (isClientPath) {
    const token = request.cookies.get("hae_party_access_token")?.value;
    if (token && await lookupIdentity(token, "parties", "portal_active")) return NextResponse.next();
    const refreshToken = request.cookies.get("hae_party_refresh_token")?.value;
    if (refreshToken) {
      const session = await refreshSession(refreshToken);
      if (session && await lookupIdentity(session.access_token, "parties", "portal_active")) return continueWithClientSession(request, session);
    }
    if (path.startsWith("/api/")) return clearClientSession(NextResponse.json({ error: "Customer sign-in required" }, { status: 401 }));
    const login = new URL("/client-login", request.url);
    return clearClientSession(NextResponse.redirect(login));
  }

  const token = request.cookies.get("hae_access_token")?.value;
  if (token && await lookupIdentity(token, "team_members", "active")) return NextResponse.next();
  if (path.startsWith("/api/")) return clearStaffSession(NextResponse.json({ error: "Authentication required" }, { status: 401 }));
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${path}${request.nextUrl.search}`);
  return clearStaffSession(NextResponse.redirect(login));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|hamro-afno-logo.jpeg).*)"] };
