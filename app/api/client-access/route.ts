import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getCurrentMember } from "../../../lib/current-member";
import { sendClientPasswordEmail } from "../../../lib/client-auth-email";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Database configuration is missing");
  const member = await getCurrentMember(db);
  return { db, member, allowed: member?.role === "admin" };
}

async function partySnapshot(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, companyId: string) {
  const { data, error } = await db.from("parties").select("id,name,place,phone,portal_email,portal_active,auth_user_id").eq("company_id", companyId).order("name");
  if (error) throw error;
  const parties = await Promise.all((data || []).map(async (party) => {
    if (!party.auth_user_id) return { ...party, auth_exists: false, email_confirmed: false, last_sign_in_at: null };
    const { data: auth, error: authError } = await db.auth.admin.getUserById(party.auth_user_id);
    return { ...party, auth_exists: !authError && Boolean(auth.user), email_confirmed: Boolean(auth.user?.email_confirmed_at), last_sign_in_at: auth.user?.last_sign_in_at || null };
  }));
  return parties;
}

export async function GET() {
  try {
    const { db, member, allowed } = await requireAdmin();
    if (!allowed) return NextResponse.json({ error: "Administrator access required" }, { status: 401 });
    return NextResponse.json({ parties: await partySnapshot(db, member!.company_id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Client access could not load" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { db, member, allowed } = await requireAdmin();
    if (!allowed) return NextResponse.json({ error: "Administrator access required" }, { status: 401 });
    const body = await request.json();
    const action = String(body.action || "create");
    const { data: party, error: partyError } = await db.from("parties").select("id,name,auth_user_id,portal_email,portal_active").eq("id", body.partyId).eq("company_id", member!.company_id).single();
    if (partyError) throw partyError;
    let warning = "";

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email) return NextResponse.json({ error: "Customer email is required" }, { status: 400 });
      if (password.length < 8) return NextResponse.json({ error: "Create an initial password with at least 8 characters" }, { status: 400 });
      if (party.auth_user_id) return NextResponse.json({ error: "This party already has a portal login. Use Set password instead." }, { status: 400 });
      const { data: emailOwner } = await db.from("parties").select("id,name").eq("company_id", member!.company_id).ilike("portal_email", email).not("auth_user_id", "is", null).maybeSingle();
      if (emailOwner) return NextResponse.json({ error: `This email is already used by ${emailOwner.name}` }, { status: 409 });
      const { data: auth, error: authError } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: party.name, account_type: "customer" } });
      if (authError) throw new Error(authError.message.includes("already") ? "This email already exists in authentication. Use a different customer email or contact the administrator." : authError.message);
      const { error: updateError } = await db.from("parties").update({ auth_user_id: auth.user.id, portal_email: email, portal_active: true }).eq("id", party.id);
      if (updateError) { await db.auth.admin.deleteUser(auth.user.id); throw updateError; }
      if (body.sendEmail !== false) {
        try { await sendClientPasswordEmail(db, { email, name: party.name }); }
        catch (emailError) { console.error("Customer setup email failed", emailError); warning = "Login was created and the initial password works, but the setup email could not be delivered."; }
      }
    } else if (action === "set_password") {
      const password = String(body.password || "");
      if (!party.auth_user_id) return NextResponse.json({ error: "Create customer access first" }, { status: 400 });
      if (password.length < 8) return NextResponse.json({ error: "Password must contain at least 8 characters" }, { status: 400 });
      const { error } = await db.auth.admin.updateUserById(party.auth_user_id, { password, email_confirm: true, user_metadata: { name: party.name, account_type: "customer" } });
      if (error) throw error;
      const { error: partyUpdateError } = await db.from("parties").update({ portal_active: true }).eq("id", party.id);
      if (partyUpdateError) throw partyUpdateError;
    } else if (action === "status") {
      const { error } = await db.from("parties").update({ portal_active: Boolean(body.active) }).eq("id", party.id);
      if (error) throw error;
    } else if (action === "reset") {
      if (!party.portal_email || !party.auth_user_id) return NextResponse.json({ error: "Customer login email is missing" }, { status: 400 });
      await sendClientPasswordEmail(db, { email: party.portal_email, name: party.name, reset: true });
    } else return NextResponse.json({ error: "Unsupported action" }, { status: 400 });

    return NextResponse.json({ success: true, warning, parties: await partySnapshot(db, member!.company_id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Client access update failed" }, { status: 500 });
  }
}
