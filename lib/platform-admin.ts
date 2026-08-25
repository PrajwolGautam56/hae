import { getControlAdmin } from "./platform-control";

export const PLATFORM_ACCESS_COOKIE = "kritech_platform_access";
export const PLATFORM_REFRESH_COOKIE = "kritech_platform_refresh";

export type PlatformAdministrator = {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string;
  role: "super_admin" | "operator" | "support" | "viewer";
  active: boolean;
};

function cookieValue(request: Request, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))?.[1];
}

export async function authorizePlatformAdmin(request: Request) {
  const db = getControlAdmin();
  if (!db) throw new Error("Kritech Control Supabase configuration is missing");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = bearer || cookieValue(request, PLATFORM_ACCESS_COOKIE);
  if (!token) return { db, admin: null, user: null };

  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user?.email) return { db, admin: null, user: null };
  const email = auth.user.email.toLowerCase();
  const { data: existing, error } = await db
    .from("platform_admins")
    .select("id,auth_user_id,name,email,role,active")
    .or(`auth_user_id.eq.${auth.user.id},email.eq.${email}`)
    .maybeSingle();
  if (error) throw error;
  if (!existing?.active) return { db, admin: null, user: auth.user };

  let admin = existing as PlatformAdministrator;
  if (!admin.auth_user_id) {
    const { data: bound, error: bindError } = await db
      .from("platform_admins")
      .update({ auth_user_id: auth.user.id, last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", admin.id)
      .is("auth_user_id", null)
      .select("id,auth_user_id,name,email,role,active")
      .single();
    if (bindError) throw bindError;
    admin = bound as PlatformAdministrator;
  }
  return { db, admin, user: auth.user };
}

export function canManage(admin: PlatformAdministrator | null) {
  return admin?.role === "super_admin" || admin?.role === "operator";
}

export function canManageAdmins(admin: PlatformAdministrator | null) {
  return admin?.role === "super_admin";
}

export async function writePlatformAudit(
  db: NonNullable<ReturnType<typeof getControlAdmin>>,
  admin: PlatformAdministrator,
  request: Request,
  input: { action: string; entityType: string; entityId?: string | null; summary: string; metadata?: Record<string, unknown> },
) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const { error } = await db.from("platform_audit_logs").insert({
    admin_id: admin.id,
    admin_email: admin.email,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    summary: input.summary,
    metadata: input.metadata || {},
    ip_address: forwarded || null,
  });
  if (error) throw error;
}
