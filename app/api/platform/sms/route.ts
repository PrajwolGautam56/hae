import { NextResponse } from "next/server";
import { authorizePlatformAdmin, canManage } from "../../../../lib/platform-admin";
import { getUnifiedAdmin } from "../../../../lib/supabase-server";
import { reminderProviderReady } from "../../../../lib/overdue-reminder-provider";
const validId = (value: unknown) => typeof value === "string" && /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
export const dynamic = "force-dynamic";
async function context(request: Request, tenantId: unknown) {
  const { db: control, admin } = await authorizePlatformAdmin(request);
  if (!admin) throw new Error("Platform administrator sign-in required");
  if (!validId(tenantId)) throw new Error("Select a client");
  const tenant = await control.from("platform_tenants").select("id,name").eq("id", tenantId).maybeSingle();
  if (tenant.error) throw tenant.error;
  if (!tenant.data) throw new Error("Client not found");
  const db = getUnifiedAdmin(); if (!db) throw new Error("Shared database configuration missing");
  return { db, admin, tenant: tenant.data };
}
export async function GET(request: Request) {
  try {
    const { db, admin, tenant } = await context(request, new URL(request.url).searchParams.get("tenantId"));
    const [wallet, ledger, deliveries] = await Promise.all([
      db.from("sms_credit_wallets").select("*").eq("tenant_id", tenant.id).maybeSingle(),
      db.from("sms_credit_ledger").select("id,kind,available_delta,held_delta,spent_delta,paid_amount,actor,note,created_at").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(50),
      db.from("overdue_reminder_deliveries").select("id,company_id,channel,status,recipient,credits,created_at,detail,provider_id").eq("tenant_id", tenant.id).in("status", ["reserved", "unknown"]).order("created_at", { ascending: false }).limit(30),
    ]);
    if (wallet.error || ledger.error || deliveries.error) throw wallet.error || ledger.error || deliveries.error;
    return NextResponse.json({ wallet: wallet.data || { balance: 0, held: 0, spent: 0, credited: 0, enabled: false, credits_per_segment: null }, ledger: ledger.data || [], pending: deliveries.data || [], canManage: canManage(admin), provider: reminderProviderReady("sms") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not load SMS credits" }, { status: 400 }); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin credit request denied" }, { status: 403 });
    const body = await request.json();
    const { db, admin, tenant } = await context(request, body.tenantId);
    if (!canManage(admin)) return NextResponse.json({ error: "Only a platform super administrator or operator can manage paid credits" }, { status: 403 });
    const note = String(body.note || "").trim();
    if (!note || note.length > 1000) throw new Error("Add an audit note / payment reference (up to 1000 characters)");
    if (body.action === "resolve") {
      if (!validId(body.deliveryId) || !["accepted", "failed"].includes(body.status) || body.providerChecked !== true) throw new Error("Check the provider records and confirm an accepted / not accepted outcome first");
      const existing = await db.from("overdue_reminder_deliveries").select("id").eq("id", body.deliveryId).eq("tenant_id", tenant.id).maybeSingle();
      if (existing.error) throw existing.error; if (!existing.data) throw new Error("Reminder not found for this client");
      const { data, error } = await db.rpc("finish_overdue_reminder", { p_id: existing.data.id, p_status: body.status, p_provider_id: String(body.providerId || "").slice(0, 250) || null, p_detail: note, p_resolution_actor: admin.email });
      if (error) throw error;
      return NextResponse.json({ saved: true, delivery: data });
    }
    if (!validId(body.requestId) || !["topup", "settings"].includes(body.action)) throw new Error("Invalid credit action");
    const credits = Number(body.credits), paid = body.paidAmount === "" || body.paidAmount === undefined ? null : Number(body.paidAmount);
    const rate = body.creditsPerSegment === "" || body.creditsPerSegment === null || body.creditsPerSegment === undefined ? null : Number(body.creditsPerSegment);
    if (body.action === "topup" && (!Number.isSafeInteger(credits) || credits < 1 || credits > 10_000_000 || (paid !== null && (!Number.isFinite(paid) || paid < 0 || Math.abs(paid * 100 - Math.round(paid * 100)) > 0.00001)))) throw new Error("Enter valid whole credits and an optional payment amount with two decimal places");
    if (body.action === "settings" && ((rate !== null && (!Number.isSafeInteger(rate) || rate < 1 || rate > 10000)) || typeof body.enabled !== "boolean")) throw new Error("Enter whole credits per segment and enable/disable SMS");
    // The unified tenant mirror must already exist through normal company provisioning.
    const { data, error } = await db.rpc("manage_sms_credits", { p_tenant_id: tenant.id, p_actor: admin.email, p_request_id: body.requestId, p_action: body.action, p_credits: body.action === "topup" ? credits : 0, p_paid: paid, p_note: note, p_enabled: body.enabled ?? false, p_rate: rate });
    if (error) throw error;
    return NextResponse.json({ saved: true, wallet: data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Could not save SMS credits" }, { status: 400 }); }
}
