import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";
import { companyOverdue } from "../../../lib/overdue-reminder-data";
import { deliverOverdueReminder, reminderPreview } from "../../../lib/overdue-reminder-service";
import { reminderProviderReady } from "../../../lib/overdue-reminder-provider";
const canSend = (role: string) => ["admin", "manager", "accountant"].includes(role);
const validId = (value: unknown) => typeof value === "string" && /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
export const dynamic = "force-dynamic";

async function context() {
  await requireFeature("accounting");
  const db = getSupabaseAdmin(); if (!db) throw new Error("Database configuration missing");
  const { company, member } = await getBusinessContext(db);
  if (!company.organization_id) throw new Error("This company has no client organization");
  const { data: wallet, error } = await db.from("sms_credit_wallets").select("balance,held,spent,credited,enabled,credits_per_segment").eq("tenant_id", company.organization_id).maybeSingle();
  if (error) throw error;
  return { db, company, member, wallet: wallet || { balance: 0, held: 0, spent: 0, credited: 0, enabled: false, credits_per_segment: null } };
}

export async function GET() {
  try {
    const { db, company, member, wallet } = await context();
    const [overdue, history, sent] = await Promise.all([
      companyOverdue(db, company),
      db.from("overdue_reminder_deliveries").select("id,party_id,channel,status,recipient,message,credits,segments,automatic,created_at,completed_at,detail").eq("company_id", company.id).order("created_at", { ascending: false }).limit(30),
      db.from("overdue_reminder_deliveries").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("channel", "sms").eq("status", "accepted"),
    ]);
    if (history.error || sent.error) throw history.error || sent.error;
    return NextResponse.json({ ...overdue, rows: overdue.rows.map((row: any) => reminderPreview(row, wallet)), company: { name: company.name }, wallet, smsAccepted: sent.count || 0, history: history.data || [], canSend: canSend(member.role), providers: { sms: reminderProviderReady("sms"), email: reminderProviderReady("email") } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not load overdue reminders", setupRequired: /schema cache|does not exist|sms_credit_wallets|auto_overdue/.test(error.message || "") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin reminder request denied" }, { status: 403 });
    const { db, company, member, wallet } = await context();
    if (!canSend(member.role)) return NextResponse.json({ error: "Only an administrator, manager or accountant can send reminders" }, { status: 403 });
    const body = await request.json();
    if (!validId(body.partyId) || !validId(body.requestId) || !["sms", "email"].includes(body.channel) || !/^[a-f0-9]{64}$/.test(body.previewHash || "")) return NextResponse.json({ error: "Open a current reminder preview first" }, { status: 400 });
    // An ambiguous client retry returns the existing delivery, even if the balance changed meanwhile.
    const prior = await db.from("overdue_reminder_deliveries").select("id,party_id,channel,status,detail").eq("company_id", company.id).eq("request_id", body.requestId).maybeSingle();
    if (prior.error) throw prior.error;
    if (prior.data) {
      if (prior.data.party_id !== body.partyId || prior.data.channel !== body.channel) return NextResponse.json({ error: "Request ID belongs to another reminder" }, { status: 409 });
      return NextResponse.json({ delivery: prior.data, duplicate: true });
    }
    const overdue = await companyOverdue(db, company);
    const row = overdue.rows.find((party: any) => party.partyId === body.partyId);
    if (!row) return NextResponse.json({ error: "This party no longer has an overdue balance. Refresh the list" }, { status: 409 });
    const delivery = await deliverOverdueReminder(db, company, row, wallet, { channel: body.channel, requestId: body.requestId, actorId: member.id, automatic: false, previewHash: body.previewHash, expectedCredits: body.expectedCredits });
    return NextResponse.json({ delivery });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Reminder could not be sent" }, { status: 409 }); }
}
