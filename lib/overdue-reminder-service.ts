import { createHash } from "node:crypto";
import { isEmail, smsEstimate, smsPhone } from "./overdue-reminder-model";
import { reminderProviderReady, sendReminderProvider } from "./overdue-reminder-provider";

export function reminderPreview(row: any, wallet: any) {
  const binding = JSON.stringify({ companyId: row.companyId, partyId: row.partyId, phone: row.phone, email: row.email, message: row.message });
  return { ...row, estimate: smsEstimate(row.message, wallet?.credits_per_segment ?? null), previewHash: createHash("sha256").update(binding).digest("hex") };
}

export async function deliverOverdueReminder(db: any, company: any, row: any, wallet: any, input: { channel: "sms" | "email"; requestId: string; actorId: string | null; automatic: boolean; previewHash?: string; expectedCredits?: number }, provider = sendReminderProvider) {
  const preview = reminderPreview(row, wallet);
  if (input.previewHash && input.previewHash !== preview.previewHash) throw new Error("Party balance, contact or reminder changed. Refresh and review the latest preview before sending");
  const available = reminderProviderReady(input.channel);
  // All availability/format checks happen BEFORE reserving paid credits.
  if (provider === sendReminderProvider && !available.ready) throw new Error(available.reason);
  const recipient = input.channel === "sms" ? smsPhone(row.phone) : row.email;
  if (input.channel === "email" && !isEmail(recipient)) throw new Error("Add a valid email address to the party first");
  if (input.channel === "sms" && (!wallet?.enabled || preview.estimate.credits === null)) throw new Error("SMS credits and billing rate have not been enabled for this client");
  if (input.channel === "sms" && row.message.length > 720) throw new Error("SMS is longer than the provider's 720-character limit; shorten the party/company name before sending");
  if (!input.automatic && input.channel === "sms" && input.expectedCredits !== preview.estimate.credits) throw new Error("Credit cost changed. Refresh the preview before sending");
  const { data: reservation, error } = await db.rpc("reserve_overdue_reminder", {
    p_company_id: company.id, p_party_id: row.partyId, p_actor_id: input.actorId, p_request_id: input.requestId,
    p_channel: input.channel, p_automatic: input.automatic, p_recipient: recipient, p_message: row.message,
    p_snapshot: { overdue: row.overdue, total: row.total, oldestOverdueDays: row.oldestOverdueDays, termText: row.termText, asOf: row.asOf, companyName: company.name, oldestDue: row.oldestDue },
    p_segments: input.channel === "sms" ? preview.estimate.segments : 0, p_expected_credits: input.channel === "sms" ? preview.estimate.credits : 0,
  });
  if (error) throw error;
  if (!reservation.created) return { ...reservation.delivery, duplicate: true };
  let outcome;
  try { outcome = await provider(input.channel, { id: reservation.delivery.id, recipient, message: row.message, companyName: company.name }); }
  catch { outcome = { status: "unknown" as const, detail: "Provider result is unknown; platform review required" }; }
  const args = { p_id: reservation.delivery.id, p_status: outcome.status, p_provider_id: outcome.providerId || null, p_detail: outcome.detail };
  // Finalization is idempotent. A database interruption must not cause another provider send.
  let finished = await db.rpc("finish_overdue_reminder", args);
  if (finished.error) finished = await db.rpc("finish_overdue_reminder", args);
  if (finished.error) return { ...reservation.delivery, status: "reserved", detail: "Provider request completed but recording its outcome is pending. Do not resend; ask the platform administrator to reconcile this reminder." };
  return finished.data;
}
