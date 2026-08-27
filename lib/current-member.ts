import { cookies } from "next/headers";
import { getSupabaseAdmin } from "./supabase-server";

export async function getCurrentMember(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  companyId?: string,
) {
  const token = (await cookies()).get("hae_access_token")?.value;
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  let query = db
    .from("team_members")
    .select("id,company_id,name,email,role,active")
    .eq("auth_user_id", data.user.id)
    .eq("active", true);
  if (companyId) query = query.eq("company_id", companyId);
  const { data: members } = await query.limit(1);
  const member = members?.[0];
  return member?.active ? member : null;
}
