export const REMINDER_INTERVAL_DAYS = 15;
export const businessToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dayDifference = (later: string, earlier: string) => Math.round((Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) / 86400000);
const plain = (text: unknown) => String(text || "").replace(/[\r\n\t]+/g, " ").trim();
export const isEmail = (value: string) => value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
export function smsPhone(value: string) {
  const phone = value.trim().replace(/[\s()-]/g, "");
  // Initially Nepal mobile numbers only; never guess a destination from multiple numbers.
  const local = phone.replace(/^(?:\+977|00977|977)/, "");
  if (!/^9[678]\d{8}$/.test(local)) throw new Error("Enter one valid Nepal mobile number (98/97/96, optionally +977)");
  return `+977${local}`;
}

const gsmBasic = new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const gsmExtended = new Set([..."\f^{}\\[~]|€"]);
/** Platform client-credit rule, independent of the platform's wholesale SMS purchase cost. */
export function smsEstimate(text: string, creditsPerSegment: number | null) {
  let units = 0; let gsm = true;
  for (const char of text) { if (gsmBasic.has(char)) units++; else if (gsmExtended.has(char)) units += 2; else { gsm = false; break; } }
  if (!gsm) units = text.length; // UCS-2/UTF-16 code units, including surrogate pairs.
  const single = gsm ? 160 : 70, multipart = gsm ? 153 : 67;
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multipart);
  const rate = Number.isSafeInteger(creditsPerSegment) && Number(creditsPerSegment) > 0 ? Number(creditsPerSegment) : null;
  return { encoding: gsm ? "GSM-7" : "Unicode", units, segments, credits: rate === null ? null : segments * rate };
}

export function reminderSnapshot(company: { id: string; name: string }, party: any, ageing: any, asOf: string) {
  const overdueBills = (ageing.details || []).filter((bill: any) => bill.status === "overdue" && bill.remaining > 0);
  if (!(Number(ageing.overdue) > 0) || !overdueBills.length) return null;
  const oldest = [...overdueBills].sort((a: any, b: any) => String(a.due).localeCompare(String(b.due)))[0];
  const terms = [...new Set(overdueBills.filter((bill: any) => bill.dueSource === "due_date" && bill.invoiceDate).map((bill: any) => Math.max(0, dayDifference(bill.due, bill.invoiceDate))))].sort((a: any, b: any) => a - b);
  const termText = terms.length ? `${terms.length > 3 ? `${terms[0]}-${terms[terms.length - 1]}` : terms.join("/")} days` : "No explicit payment term recorded; invoice date used";
  const amount = Number(ageing.overdue).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const days = Number(ageing.oldestOverdueDays);
  const message = `Dear ${plain(party.name)}, your overdue amount is Rs. ${amount} as of ${asOf}. Oldest overdue: ${days} day${days === 1 ? "" : "s"} (due ${oldest.due}; bill ${plain(oldest.reference)}). Payment term: ${termText}. Please arrange payment. From ${plain(company.name)}.`;
  return { companyId: company.id, partyId: party.id, party: party.name, phone: party.phone || "", email: party.email || "", autoSms: Boolean(party.auto_overdue_sms), autoEmail: Boolean(party.auto_overdue_email), overdue: Number(ageing.overdue), total: Number(ageing.total), notDue: Number(ageing.notDue), oldestOverdueDays: days, oldestDue: oldest.due, termText, asOf, overdueBills, message };
}

export function partyNotificationInput(body: Record<string, unknown>) {
  const email = String(body.email || "").trim().toLowerCase();
  if (email && !isEmail(email)) throw new Error("Enter a valid party email address");
  if (body.autoOverdueSms !== undefined && typeof body.autoOverdueSms !== "boolean") throw new Error("Invalid SMS reminder option");
  if (body.autoOverdueEmail !== undefined && typeof body.autoOverdueEmail !== "boolean") throw new Error("Invalid email reminder option");
  const autoSms = body.autoOverdueSms === true, autoEmail = body.autoOverdueEmail === true;
  if (autoSms) smsPhone(String(body.phone || ""));
  if (autoEmail && !email) throw new Error("Add an email address before enabling automatic email reminders");
  return { email, autoSms, autoEmail };
}
