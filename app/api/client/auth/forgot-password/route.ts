import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/supabase-server";
import { sendClientPasswordEmail } from "../../../../../lib/client-auth-email";

export async function POST(request: Request) {
  const generic = { message: "If this email has active customer access, a secure password link has been sent." };
  try {
    const email = String((await request.json()).email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Enter your customer email" }, { status: 400 });
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Authentication configuration is missing");
    const { data: party } = await db.from("parties").select("name,portal_email,portal_active,auth_user_id").ilike("portal_email", email).eq("portal_active", true).maybeSingle();
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
