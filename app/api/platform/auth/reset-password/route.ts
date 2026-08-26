import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { controlConfig, getControlAdmin } from "../../../../../lib/platform-control";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const tokenHash = String(body.tokenHash || "");
    const password = String(body.password || "");
    if (!tokenHash) return NextResponse.json({ error: "This secure link is invalid or incomplete" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Use at least 8 characters" }, { status: 400 });
    const config = controlConfig();
    if (!config) throw new Error("Kritech Control authentication is not configured");
    const client = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    if (error || !data.user) return NextResponse.json({ error: error?.message || "This secure link has expired" }, { status: 400 });

    // Password recovery is limited to active Kritech Control administrators.
    // Updating through the verified user's id also avoids relying on a browser
    // session inside this server-only recovery request.
    const adminClient = getControlAdmin();
    if (!adminClient) throw new Error("Kritech Control authentication is not configured");
    const email = String(data.user.email || "").trim().toLowerCase();
    const { data: platformAdmin, error: adminError } = await adminClient
      .from("platform_admins")
      .select("id,auth_user_id,active")
      .eq("email", email)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!platformAdmin?.active || (platformAdmin.auth_user_id && platformAdmin.auth_user_id !== data.user.id)) {
      return NextResponse.json({ error: "This administrator account is not authorized" }, { status: 403 });
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(data.user.id, {
      password,
      email_confirm: true,
    });
    if (updateError) throw updateError;
    if (!platformAdmin.auth_user_id) {
      const { error: bindError } = await adminClient
        .from("platform_admins")
        .update({ auth_user_id: data.user.id, updated_at: new Date().toISOString() })
        .eq("id", platformAdmin.id);
      if (bindError) throw bindError;
    }
    return NextResponse.json({ success: true, message: "Password saved. You can now sign in to Kritech Control." });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save password" }, { status: 500 });
  }
}
