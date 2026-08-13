import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Authentication configuration is missing");
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password: String(password) });
    if (error || !data.session) return NextResponse.json({ error: error?.message || "Invalid login" }, { status: 401 });
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error("Server authentication configuration is missing");
    const { data: member } = await admin.from("team_members").select("name,role,active").eq("auth_user_id",data.user.id).maybeSingle();
    if (!member?.active) return NextResponse.json({ error: "Your company account is not active. Contact an administrator." }, { status: 403 });
    const response = NextResponse.json({ user: { email: data.user.email, name: member.name, role: member.role } });
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set("hae_access_token", data.session.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: data.session.expires_in });
    response.cookies.set("hae_refresh_token", data.session.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error:any) { return NextResponse.json({ error: error?.message || "Could not sign in" }, { status: 500 }); }
}
