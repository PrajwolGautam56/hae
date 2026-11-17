import {clientAvailability, clientWallet} from "./client-messaging";
import {reminderProviderReady} from "./overdue-reminder-provider";

export async function readSmsWallet(db: any, tenantId: string | null | undefined) {
  if (!tenantId) throw new Error("This company has no client organization");
  const result = await db.from("sms_credit_wallets").select("balance,held,spent,enabled,credits_per_segment,updated_at").eq("tenant_id", tenantId).maybeSingle();
  if (result.error) throw result.error;
  return result.data || {balance: 0, held: 0, spent: 0, enabled: false, credits_per_segment: null, updated_at: null};
}

export function publicSmsCreditState(companyId: string, wallet: any) {
  return {companyId, wallet: clientWallet(wallet), service: clientAvailability(reminderProviderReady("sms"))};
}
