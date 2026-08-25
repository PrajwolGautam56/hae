import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { controlConfig } from "../../../../../lib/platform-control";

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
    if (error || !data.session) return NextResponse.json({ error: error?.message || "This secure link has expired" }, { status: 400 });
    const authenticated = createClient(config.url, config.publishableKey, { global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { error: updateError } = await authenticated.auth.updateUser({ password });
    if (updateError) throw updateError;
    return NextResponse.json({ success: true, message: "Password saved. You can now sign in to Kritech Control." });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save password" }, { status: 500 });
  }
}
