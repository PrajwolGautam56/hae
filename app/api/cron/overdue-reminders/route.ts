import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getUnifiedAdmin } from "../../../../lib/supabase-server";
import { getControlAdmin } from "../../../../lib/platform-control";
import { runOverdueReminderWorker } from "../../../../lib/overdue-reminder-worker";
import {loadMessagingRuntime,messagingValue} from "../../../../lib/messaging-runtime";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const actual = request.headers.get("authorization") || "";
  if(!actual.startsWith("Bearer ")||Buffer.byteLength(actual)<39)return NextResponse.json({error:"Unauthorized scheduler"},{status:401});
  await loadMessagingRuntime();
  const expected = messagingValue("CRON_SECRET");
  if (!expected || expected.length < 32 || Buffer.byteLength(actual) !== Buffer.byteLength(`Bearer ${expected}`) || !timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${expected}`))) return NextResponse.json({ error: "Unauthorized scheduler" }, { status: 401 });
  if (messagingValue("OVERDUE_REMINDERS_ENABLED") !== "true") return NextResponse.json({ disabled: true });
  try {
    const db = getUnifiedAdmin(), control = getControlAdmin();
    if (!db || !control) throw new Error("Business and control database configuration required");
    return NextResponse.json(await runOverdueReminderWorker(db, control), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Reminder worker could not complete; check database migration/configuration and retry safely" }, { status: 503 }); }
}
