import { normalizeEmailSender } from "./resend-email";
import { smsEstimate, smsPhone } from "./overdue-reminder-model";

export type ProviderOutcome = { status: "accepted" | "failed" | "unknown"; providerId?: string; detail: string };
export function reminderProviderReady(channel: "sms" | "email") {
  if (process.env.OVERDUE_REMINDERS_ENABLED !== "true") return { ready: false, reason: "Reminder sending has not been activated by the platform administrator" };
  if (channel === "sms") return { ready: Boolean(process.env.SMSPASAL_API_KEY && process.env.SMSPASAL_SENDER_ID && process.env.SMSPASAL_ROUTE_ID && process.env.SMSPASAL_BILLING_CONFIRMED === "true"), reason: "Configure SMS Pasal credentials/approved sender/route and confirm segment billing before activating paid sends" };
  return { ready: Boolean(process.env.RESEND_API_KEY && normalizeEmailSender(process.env.RESEND_FROM_EMAIL)), reason: "Configure a verified Resend sender and API key" };
}

/** Only explicit provider acceptance is charged as accepted; never blindly retry SMS. */
export async function sendReminderProvider(channel: "sms" | "email", input: { id: string; recipient: string; message: string; companyName: string }): Promise<ProviderOutcome> {
  const availability = reminderProviderReady(channel);
  if (!availability.ready) return { status: "failed", detail: availability.reason };
  if (channel === "sms") {
    if (input.message.length > 720) return { status: "failed", detail: "SMS Pasal permits at most 720 characters; shorten party/company names or the reminder" };
    const payload = new URLSearchParams({ key: process.env.SMSPASAL_API_KEY!, senderid: process.env.SMSPASAL_SENDER_ID!, routeid: process.env.SMSPASAL_ROUTE_ID!, contacts: smsPhone(input.recipient).slice(4), type: smsEstimate(input.message, null).encoding === "GSM-7" ? "text" : "unicode", responsetype: "http", msg: input.message });
    if (process.env.SMSPASAL_CAMPAIGN_ID) payload.set("campaign", process.env.SMSPASAL_CAMPAIGN_ID);
    try {
      const response = await fetch("https://sms.smspasal.com/smsapi/index.php", { method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: payload.toString() });
      const text = (await response.text()).trim();
      return smsPasalOutcome(text, response.status);
    } catch { return { status: "unknown", detail: "SMS Pasal acceptance is unknown after a connection error. Check provider records before retrying" }; }
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `overdue-reminder/${input.id}` },
      body: JSON.stringify({ from: `${input.companyName.replace(/[<>"\r\n]/g, "")} <${normalizeEmailSender(process.env.RESEND_FROM_EMAIL).match(/<?([^\s<>]+@[^\s<>]+)>?$/)?.[1]}>`, to: [input.recipient], subject: `Payment overdue · ${input.companyName}`, text: input.message }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && typeof body?.id === "string") return { status: "accepted", providerId: body.id, detail: "Accepted by Resend; delivery to the inbox is not yet confirmed" };
    // Ambiguous responses must never lead to a blind retry or a credit refund.
    if (response.status >= 500 || response.status === 408 || response.status === 409 || response.ok) return { status: "unknown", detail: "Provider outcome is uncertain; platform review required before retry" };
    return { status: "failed", detail: `Provider rejected the request (HTTP ${response.status}); no message accepted` };
  } catch {
    return { status: "unknown", detail: "Connection interrupted; provider acceptance is unknown. Do not resend until reviewed" };
  }
}

export function smsPasalOutcome(text: string, status: number): ProviderOutcome {
  const match = /^SMS-SHOOT-ID\/\{?([a-z0-9_-]{1,200})\}?$/i.exec(text.trim());
  if (status >= 200 && status < 300 && match) return { status: "accepted", providerId: match[1], detail: "Accepted by SMS Pasal; delivery to the phone is not yet confirmed" };
  if (/^ERR\s*:/i.test(text.trim()) && status < 500) return { status: "failed", detail: "SMS Pasal explicitly rejected this request. Check the provider account/sender/route before trying again" };
  return { status: "unknown", detail: "Unexpected SMS Pasal response; platform review required. No automatic resend" };
}
