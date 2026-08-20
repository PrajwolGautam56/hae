import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../../../../lib/supabase-server";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Authentication configuration is missing");
    const authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password: String(password) });
    if (error || !data.session) return NextResponse.json({ error: "Email or password is incorrect. Use Forgot password or ask the office to set a new password." }, { status: 401 });
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error("Server authentication configuration is missing");
    const { data: party } = await admin.from("parties").select("id,name,portal_active").eq("auth_user_id", data.user.id).maybeSingle();
    if (!party) return NextResponse.json({ error: "This email is not linked to a customer account" }, { status: 403 });
    if (!party.portal_active) return NextResponse.json({ error: "Customer portal access is disabled. Please contact the office." }, { status: 403 });
    const response = NextResponse.json({ user: { name: party.name, email: data.user.email } });
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set("hae_party_access_token", data.session.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: data.session.expires_in });
    response.cookies.set("hae_party_refresh_token", data.session.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sign in" }, { status: 500 });
  }
}
