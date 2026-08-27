type EmailInput = {
  to: string;
  subject: string;
  heading: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  brandName?: string;
  footer?: string;
};

export async function sendTeamEmail(input: EmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !input.to) return { skipped: true, reason: "Email configuration is missing" };
  const from = normalizeEmailSender(process.env.RESEND_FROM_EMAIL)
    || "Kritech Global <notifications@kritechglobal.com>";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
  const actionUrl = input.actionUrl || appUrl;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#17233d"><div style="font-size:24px;font-weight:800;color:#315fc8">${escapeHtml(input.brandName || "हाम्रो खाता")}</div><h2 style="margin:24px 0 10px">${escapeHtml(input.heading)}</h2><p style="font-size:15px;line-height:1.65;color:#536078">${escapeHtml(input.message)}</p>${input.actionLabel ? `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin-top:18px;padding:11px 18px;background:#315fc8;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">${escapeHtml(input.actionLabel)}</a>` : ""}<p style="margin-top:30px;font-size:12px;color:#97a0b0">${escapeHtml(input.footer || "Hamro Khata · Internal work notification")}</p></div>`,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.message || "Resend could not send email");
  return { skipped: false, id: result.id };
}

export function normalizeEmailSender(rawValue?: string) {
  let value = String(rawValue || "").trim().replace(/^RESEND_FROM_EMAIL\s*=\s*/i, "").trim();
  while (
    value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) value = value.slice(1, -1).trim();

  const email = "[^\\s<>@]+@[^\\s<>@]+\\.[^\\s<>@]+";
  if (new RegExp(`^${email}$`).test(value) || new RegExp(`^.+\\s<${email}>$`).test(value)) return value;
  return "";
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}
