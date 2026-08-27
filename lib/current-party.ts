import { cookies } from "next/headers";
import { getSupabaseAdmin } from "./supabase-server";
import { getSelectedBusinessCompany } from "./company-context";

export async function getCurrentParty(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  const token = (await cookies()).get("hae_party_access_token")?.value;
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  const company = await getSelectedBusinessCompany(db);
  const { data: party } = await db
    .from("parties")
    .select("id,company_id,name,place,phone,tax_no,portal_email,portal_active")
    .eq("auth_user_id", data.user.id)
    .eq("company_id", company.id)
    .maybeSingle();
  return party?.portal_active ? party : null;
}
