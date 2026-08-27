import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { businessAuthConfig, COMPANY_COOKIE, loginCompany } from "../../../../lib/platform-control";
import { resolvePlatformBusinessCompany } from "../../../../lib/company-context";

export async function POST(request: Request) {
  try {
    const { email, password, companySlug } = await request.json();
    if (!companySlug) return NextResponse.json({ error: "Select a company before signing in" }, { status: 400 });
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const selected = await loginCompany(host, String(companySlug));
    if (!selected) return NextResponse.json({ error: "This company does not belong to the current workspace" }, { status: 404 });
    if (selected.subscription && !["trial", "active"].includes(selected.subscription.status)) return NextResponse.json({ error: "This workspace subscription is not active" }, { status: 403 });
    if (selected.subscription?.expiresOn && selected.subscription.expiresOn < new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "This workspace subscription has expired" }, { status: 403 });
    if (!selected.company.loginEnabled || selected.company.status !== "active") return NextResponse.json({ error: `${selected.company.name} setup is not active yet` }, { status: 409 });
    const config = businessAuthConfig(selected.company.connectionKey);
    if (!config) throw new Error("Selected company authentication is not configured");
    const supabase = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password: String(password) });
    if (error || !data.session) return NextResponse.json({ error: error?.message || "Invalid login" }, { status: 401 });
    const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const businessCompany = await resolvePlatformBusinessCompany(admin, selected.company);
    if (!businessCompany) return NextResponse.json({ error: "This company has not been linked to its business workspace yet" }, { status: 409 });
    const { data: member } = await admin.from("team_members").select("name,role,active").eq("auth_user_id",data.user.id).eq("company_id", businessCompany.id).maybeSingle();
    if (!member?.active) return NextResponse.json({ error: "Your company account is not active. Contact an administrator." }, { status: 403 });
    const response = NextResponse.json({ user: { email: data.user.email, name: member.name, role: member.role }, company: { id: businessCompany.id, name: businessCompany.name, slug: selected.company.slug } });
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set("hae_access_token", data.session.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: data.session.expires_in });
    response.cookies.set("hae_refresh_token", data.session.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    response.cookies.set(COMPANY_COOKIE, selected.company.slug, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
    return response;
  } catch (error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sign in" }, { status: 500 }); }
}
