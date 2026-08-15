import { cookies } from "next/headers";
import { getSupabaseAdmin } from "./supabase-server";

export async function getCurrentMember(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
) {
  const token = (await cookies()).get("hae_access_token")?.value;
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  const { data: member } = await db
    .from("team_members")
    .select("id,company_id,name,email,role,active")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  return member?.active ? member : null;
}
