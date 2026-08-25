import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { controlConfig, getControlAdmin } from "../../../../../lib/platform-control";
import { PLATFORM_ACCESS_COOKIE, PLATFORM_REFRESH_COOKIE } from "../../../../../lib/platform-admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    const config = controlConfig();
    const adminDb = getControlAdmin();
    if (!config || !adminDb) throw new Error("Kritech Control authentication is not configured");

    const auth = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user.email) return NextResponse.json({ error: "Invalid platform administrator login" }, { status: 401 });
    const { data: platformAdmin } = await adminDb
      .from("platform_admins")
      .select("id,name,email,role,active,auth_user_id")
      .or(`auth_user_id.eq.${data.user.id},email.eq.${data.user.email.toLowerCase()}`)
      .maybeSingle();
    if (!platformAdmin?.active) return NextResponse.json({ error: "This account is not authorized for Kritech Control" }, { status: 403 });
    const now = new Date().toISOString();
    await adminDb.from("platform_admins").update({ auth_user_id: data.user.id, last_login_at: now, updated_at: now }).eq("id", platformAdmin.id);

    const secure = process.env.NODE_ENV === "production";
    const response = NextResponse.json({ user: { name: platformAdmin.name, email: platformAdmin.email, role: platformAdmin.role } });
    response.cookies.set(PLATFORM_ACCESS_COOKIE, data.session.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: data.session.expires_in });
    response.cookies.set(PLATFORM_REFRESH_COOKIE, data.session.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sign in" }, { status: 500 });
  }
}
