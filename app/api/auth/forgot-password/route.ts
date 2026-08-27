import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { businessAuthConfig, loginCompany } from "../../../../lib/platform-control";
import { sendTeamEmail } from "../../../../lib/resend-email";
import { resolvePlatformBusinessCompany } from "../../../../lib/company-context";

const generic = "If this email belongs to an active account in the selected company, a secure reset link has been sent.";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const companySlug = String(body.companySlug || "");
    if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
    if (!companySlug) return NextResponse.json({ error: "Select a company first" }, { status: 400 });
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const selected = await loginCompany(host, companySlug);
    if (!selected || !selected.company.loginEnabled || selected.company.status !== "active") return NextResponse.json({ message: generic });
    const config = businessAuthConfig(selected.company.connectionKey);
    if (!config) throw new Error("Selected company authentication is not configured");
    const db = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const company = await resolvePlatformBusinessCompany(db, selected.company);
    if (!company) return NextResponse.json({ message: generic });
    const { data: member } = await db.from("team_members").select("name,email,active,auth_user_id").eq("company_id", company.id).eq("email", email).maybeSingle();
    if (!member?.active || !member.auth_user_id) return NextResponse.json({ message: generic });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
    const redirect = new URL("/reset-password", appUrl);
    redirect.searchParams.set("company", selected.company.slug);
    const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: redirect.toString() } });
    if (error) throw error;
    redirect.searchParams.set("token_hash", data.properties.hashed_token);
    redirect.searchParams.set("type", "recovery");
    await sendTeamEmail({ to: email, subject: `Reset your ${selected.company.name} password`, heading: "Reset your password", message: `Hi ${member.name}, use the secure link below to choose a new password for ${selected.company.name}.`, actionLabel: "Reset password", actionUrl: redirect.toString() });
    return NextResponse.json({ message: generic });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send reset email" }, { status: 500 });
  }
}
