import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getCurrentMember } from "../../../lib/current-member";
import { sendClientPasswordEmail } from "../../../lib/client-auth-email";
import { getSelectedBusinessCompany } from "../../../lib/company-context";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Database configuration is missing");
  const company = await getSelectedBusinessCompany(db);
  const member = await getCurrentMember(db, company.id);
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

async function authUserByEmail(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 100) break;
  }
  return null;
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
      if (party.auth_user_id) return NextResponse.json({ error: "This party already has a portal login. Send a secure reset email instead." }, { status: 400 });
      const { data: emailOwner } = await db.from("parties").select("id,name").eq("company_id", member!.company_id).ilike("portal_email", email).not("auth_user_id", "is", null).maybeSingle();
      if (emailOwner) return NextResponse.json({ error: `This email is already used by ${emailOwner.name}` }, { status: 409 });
      let authUser = await authUserByEmail(db, email);
      let createdAuth = false;
      if (!authUser) {
        const { data: auth, error: authError } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: party.name } });
        if (authError) throw authError;
        authUser = auth.user;
        createdAuth = true;
      }
      const { error: updateError } = await db.from("parties").update({ auth_user_id: authUser.id, portal_email: email, portal_active: true }).eq("id", party.id).eq("company_id", member!.company_id);
      if (updateError) { if (createdAuth) await db.auth.admin.deleteUser(authUser.id); throw updateError; }
      if (!createdAuth) warning = "This email already had a Kritech login. Its existing password was not changed; a secure setup/reset email was sent to the account owner.";
      if (body.sendEmail !== false || !createdAuth) {
        try { await sendClientPasswordEmail(db, { email, name: party.name }); }
        catch (emailError) { console.error("Customer setup email failed", emailError); warning = createdAuth ? "Login was created and the initial password works, but the setup email could not be delivered." : "The existing Kritech identity was linked without changing its password, but the setup email could not be delivered."; }
      }
    } else if (action === "set_password") {
      return NextResponse.json({ error: "For tenant security, company administrators cannot overwrite a shared login password. Send the customer a secure reset email." }, { status: 403 });
    } else if (action === "status") {
      const { error } = await db.from("parties").update({ portal_active: Boolean(body.active) }).eq("id", party.id).eq("company_id", member!.company_id);
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
