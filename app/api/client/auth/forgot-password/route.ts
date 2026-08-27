import { NextResponse } from "next/server";
import { sendClientPasswordEmail } from "../../../../../lib/client-auth-email";
import { businessAuthConfig, loginCompany } from "../../../../../lib/platform-control";
import { resolvePlatformBusinessCompany } from "../../../../../lib/company-context";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const generic = { message: "If this email has active customer access, a secure password link has been sent." };
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Enter your customer email" }, { status: 400 });
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const selected = await loginCompany(host, String(body.companySlug || ""));
    const config = selected ? businessAuthConfig(selected.company.connectionKey) : null;
    if (!selected || !config) return NextResponse.json(generic);
    const db = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const company = await resolvePlatformBusinessCompany(db, selected.company);
    if (!company) return NextResponse.json(generic);
    const { data: party } = await db.from("parties").select("name,portal_email,portal_active,auth_user_id").eq("company_id", company.id).ilike("portal_email", email).eq("portal_active", true).maybeSingle();
    if (party?.portal_email && party.auth_user_id) {
      try { await sendClientPasswordEmail(db, { email: party.portal_email, name: party.name, reset: true }); }
      catch (emailError) { console.error("Customer self-service reset email failed", emailError); }
    }
    return NextResponse.json(generic);
  } catch (error) {
    console.error("Customer forgot-password request failed", error);
    return NextResponse.json(generic);
  }
}
