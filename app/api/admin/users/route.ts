import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { sendTeamEmail } from "../../../../lib/resend-email";

export const dynamic = "force-dynamic";

async function authorizedAdmin(request: Request) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase server configuration is missing");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { db, allowed: false, user: null };
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return { db, allowed: false, user: null };
  const { data: member } = await db.from("team_members").select("id,role,active").eq("auth_user_id", auth.user.id).maybeSingle();
  return { db, allowed: member?.active === true && member.role === "admin", user: auth.user };
}

async function setupLink(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, email: string) {
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010"}/reset-password`;
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
  if (error) throw error;
  return data.properties.action_link;
}

export async function GET(request: Request) {
  try {
    const { db, allowed } = await authorizedAdmin(request);
    if (!allowed) return NextResponse.json({ error: "Administrator sign-in required" }, { status: 401 });
    const { data, error } = await db.from("team_members").select("id,name,email,phone,role,active,auth_user_id,created_at").order("created_at");
    if (error) throw error;
    return NextResponse.json({ users: data || [] });
  } catch (error: any) { return NextResponse.json({ error: error?.message || "User management error" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const { db, allowed } = await authorizedAdmin(request);
    if (!allowed) return NextResponse.json({ error: "Administrator sign-in required" }, { status: 401 });
    const body = await request.json();
    const action = String(body.action || "");
    if (action === "create") {
      const name = String(body.name || "").trim(); const email = String(body.email || "").trim().toLowerCase();
      const role = ["admin","manager","accountant","staff"].includes(body.role) ? body.role : "staff";
      if (!name || !email) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
      const temporaryPassword = `${crypto.randomUUID()}Aa1!${crypto.randomUUID()}`;
      const { data: auth, error: authError } = await db.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { name, role } });
      if (authError) throw authError;
      const { data: companies } = await db.from("companies").select("id").order("created_at").limit(1);
      const { error: memberError } = await db.from("team_members").upsert({ company_id: companies?.[0].id, name, email, phone: body.phone || null, role, active: true, auth_user_id: auth.user.id }, { onConflict: "company_id,email" });
      if (memberError) { await db.auth.admin.deleteUser(auth.user.id); throw memberError; }
      const link = await setupLink(db, email);
      await sendTeamEmail({ to: email, subject: "Your Hamro Afno Enterprises account", heading: "Your account is ready", message: `Hi ${name}, you have been added as ${role}. Set your password using the secure link below.`, actionLabel: "Set password", actionUrl: link });
      return NextResponse.json({ success: true });
    }
    if (action === "reset") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
      const link = await setupLink(db, email);
      await sendTeamEmail({ to: email, subject: "Reset your Hamro Afno password", heading: "Password reset requested", message: "Use this secure link to choose a new password. The link should only be used by you.", actionLabel: "Reset password", actionUrl: link });
      return NextResponse.json({ success: true });
    }
    if (action === "status") {
      const { error } = await db.from("team_members").update({ active: Boolean(body.active) }).eq("id", body.memberId);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error: any) { return NextResponse.json({ error: error?.message || "User management error" }, { status: 500 }); }
}
