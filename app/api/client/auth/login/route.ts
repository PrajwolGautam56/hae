import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { businessAuthConfig, COMPANY_COOKIE, loginCompany } from "../../../../../lib/platform-control";
import { resolvePlatformBusinessCompany } from "../../../../../lib/company-context";

export async function POST(request: Request) {
  try {
    const { email, password, companySlug } = await request.json();
    if (!companySlug) return NextResponse.json({ error: "Select a company before signing in" }, { status: 400 });
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const selected = await loginCompany(host, String(companySlug));
    if (!selected || !selected.company.loginEnabled || selected.company.status !== "active") return NextResponse.json({ error: "This company portal is not active" }, { status: 403 });
    if (selected.subscription && !["trial", "active"].includes(selected.subscription.status)) return NextResponse.json({ error: "This workspace subscription is not active" }, { status: 403 });
    if (selected.subscription?.expiresOn && selected.subscription.expiresOn < new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "This workspace subscription has expired" }, { status: 403 });
    if (selected.entitlements.customer_portal !== true) return NextResponse.json({ error: "Customer portal is not included in this subscription" }, { status: 403 });
    const config = businessAuthConfig(selected.company.connectionKey);
    if (!config) throw new Error("Authentication configuration is missing");
    const authClient = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password: String(password) });
    if (error || !data.session) return NextResponse.json({ error: "Email or password is incorrect. Use Forgot password or ask the office to set a new password." }, { status: 401 });
    const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const company = await resolvePlatformBusinessCompany(admin, selected.company);
    if (!company) return NextResponse.json({ error: "Customer portal workspace is not linked" }, { status: 409 });
    const { data: party } = await admin.from("parties").select("id,name,portal_active").eq("auth_user_id", data.user.id).eq("company_id", company.id).maybeSingle();
    if (!party) return NextResponse.json({ error: "This email is not linked to a customer account" }, { status: 403 });
    if (!party.portal_active) return NextResponse.json({ error: "Customer portal access is disabled. Please contact the office." }, { status: 403 });
    const response = NextResponse.json({ user: { name: party.name, email: data.user.email } });
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set("hae_party_access_token", data.session.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: data.session.expires_in });
    response.cookies.set("hae_party_refresh_token", data.session.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    response.cookies.set(COMPANY_COOKIE, selected.company.slug, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sign in" }, { status: 500 });
  }
}
