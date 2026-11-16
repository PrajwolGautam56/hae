import { randomUUID } from "node:crypto";
import { businessToday } from "./overdue-reminder-model";
import { companyOverdue } from "./overdue-reminder-data";
import { deliverOverdueReminder } from "./overdue-reminder-service";
import { reminderProviderReady } from "./overdue-reminder-provider";

export async function reminderTenantAllowed(control: any, company: any, today: string) {
  const [tenant, subscription, entitlement, link] = await Promise.all([
    control.from("platform_tenants").select("id,active,status").eq("id", company.organization_id).maybeSingle(),
    control.from("platform_subscriptions").select("status,expires_on").eq("tenant_id", company.organization_id).maybeSingle(),
    control.from("platform_entitlements").select("enabled").eq("tenant_id", company.organization_id).eq("feature_key", "accounting").maybeSingle(),
    control.from("platform_companies").select("id,login_enabled,status").eq("tenant_id", company.organization_id).eq("app_company_id", company.id).maybeSingle(),
  ]);
  if ([tenant, subscription, entitlement, link].some(result => result.error)) throw new Error("Could not verify client subscription; reminders were not sent");
  return Boolean(tenant.data?.active && tenant.data.status === "active" && subscription.data && ["active", "trial"].includes(subscription.data.status) && (!subscription.data.expires_on || subscription.data.expires_on >= today) && entitlement.data?.enabled && link.data?.login_enabled && link.data.status === "active");
}

/** Bounded, fair queue claims; invoke every 15 minutes using a server scheduler. */
export async function runOverdueReminderWorker(db: any, control: any, deadline = Date.now() + 45_000) {
  const today = businessToday();
  const { data: parties, error } = await db.rpc("claim_overdue_reminder_parties", { p_limit: 20 });
  if (error) throw error;
  const companies = new Map<string, any>();
  const stats = { claimed: parties.length, checked: 0, accepted: 0, failed: 0, unknown: 0, skipped: 0, deferred: 0 };
  for (const party of parties) {
    if (Date.now() > deadline - 25_000) { stats.deferred++; continue; }
    try {
      if (!companies.has(party.company_id)) {
        const company = await db.from("companies").select("id,name,organization_id,active").eq("id", party.company_id).maybeSingle();
        if (company.error) throw company.error;
        let context = null;
        if (company.data?.active && company.data.organization_id && await reminderTenantAllowed(control, company.data, today)) {
          const wallet = await db.from("sms_credit_wallets").select("enabled,balance,credits_per_segment").eq("tenant_id", company.data.organization_id).maybeSingle();
          if (wallet.error) throw wallet.error;
          context = { company: company.data, wallet: wallet.data, overdue: await companyOverdue(db, company.data, today) };
        }
        companies.set(party.company_id, context);
      }
      const context = companies.get(party.company_id);
      const row = context?.overdue.rows.find((item: any) => item.partyId === party.id);
      if (row) for (const channel of ["sms", "email"] as const) {
        if (!(channel === "sms" ? party.auto_overdue_sms : party.auto_overdue_email) || !reminderProviderReady(channel).ready) continue;
        try {
          const result = await deliverOverdueReminder(db, context.company, row, context.wallet, { channel, automatic: true, requestId: randomUUID(), actorId: null });
          if (result.status === "accepted") stats.accepted++; else if (result.status === "failed") stats.failed++; else stats.unknown++;
        } catch { stats.skipped++; } // Invalid contact, 15-day cooldown or insufficient credits: no provider call.
      }
      const recorded = await db.from("parties").update({ reminder_checked_at: new Date().toISOString(), reminder_claim_until: null }).eq("id", party.id).eq("company_id", party.company_id);
      if (recorded.error) throw recorded.error;
      stats.checked++;
    } catch { stats.deferred++; } // Claim expires; another run can safely resume without duplicate sends.
  }
  return stats;
}
