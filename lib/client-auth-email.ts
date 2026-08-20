import { getSupabaseAdmin } from "./supabase-server";
import { sendTeamEmail } from "./resend-email";

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

export function clientPortalBaseUrl() {
  return (process.env.CLIENT_PORTAL_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010").replace(/\/$/, "");
}

export async function generateClientRecoveryLink(db: AdminClient, email: string) {
  const redirectTo = `${clientPortalBaseUrl()}/client-reset-password`;
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
  if (error) throw error;
  const url = new URL(redirectTo);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "recovery");
  return url.toString();
}

export async function sendClientPasswordEmail(db: AdminClient, options: { email: string; name: string; reset?: boolean }) {
  const link = await generateClientRecoveryLink(db, options.email);
  await sendTeamEmail({
    to: options.email,
    subject: options.reset ? "Reset your Hamro Afno customer password" : "Your Hamro Afno customer portal",
    heading: options.reset ? "Customer password reset" : "Your customer portal is ready",
    message: options.reset
      ? `Hi ${options.name}, use the secure link below to choose a new customer portal password.`
      : `Hi ${options.name}, use the secure link below to set your password and view your ledger or place an order.`,
    actionLabel: options.reset ? "Reset password" : "Set password",
    actionUrl: link,
  });
}
