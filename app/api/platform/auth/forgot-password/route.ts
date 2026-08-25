import { NextResponse } from "next/server";
import { getControlAdmin } from "../../../../../lib/platform-control";
import { sendTeamEmail } from "../../../../../lib/resend-email";

const generic = "If this email is an authorized platform account, a secure setup or reset link has been sent.";

export async function POST(request: Request) {
  try {
    const email = String((await request.json()).email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
    const db = getControlAdmin();
    if (!db) throw new Error("Kritech Control authentication is not configured");
    const { data: admin } = await db.from("platform_admins").select("id,name,email,active,auth_user_id").eq("email", email).maybeSingle();
    if (!admin?.active) return NextResponse.json({ message: generic });

    if (!admin.auth_user_id) {
      const temporaryPassword = `${crypto.randomUUID()}Aa1!${crypto.randomUUID()}`;
      const { data: created, error: createError } = await db.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { name: admin.name, platform_role: true } });
      if (createError && !createError.message.toLowerCase().includes("already")) throw createError;
      if (created.user) await db.from("platform_admins").update({ auth_user_id: created.user.id, updated_at: new Date().toISOString() }).eq("id", admin.id);
    }

    const base = process.env.PLATFORM_ADMIN_URL || "http://localhost:3010";
    const redirect = new URL("/platform-admin/reset-password", base);
    const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: redirect.toString() } });
    if (error) throw error;
    redirect.searchParams.set("token_hash", data.properties.hashed_token);
    redirect.searchParams.set("type", "recovery");
    await sendTeamEmail({
      to: email,
      subject: "Kritech Control secure access",
      heading: "Set or reset your platform password",
      message: `Hi ${admin.name}, use this one-time secure link to access the Kritech Control administrator dashboard.`,
      actionLabel: "Set platform password",
      actionUrl: redirect.toString(),
      brandName: "Kritech Global",
      footer: "Kritech Control · Platform administration",
    });
    return NextResponse.json({ message: generic });
  } catch (error: unknown) {
    console.error("Platform administrator recovery failed", error);
    const message = error instanceof Error && typeof error.message === "string" && error.message !== "{}" ? error.message : "Could not send secure link. Check the email and authentication configuration.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
