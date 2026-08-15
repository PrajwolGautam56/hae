import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/api/auth/login", "/api/auth/logout", "/api/auth/forgot-password"];
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.some((entry) => path === entry || path.startsWith(`${entry}/`))) return NextResponse.next();
  const token = request.cookies.get("hae_access_token")?.value;
  if (token) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (url && key && secret) {
      const validation = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (validation.ok) {
        const user = await validation.json() as { id?: string };
        if (user.id) {
          const memberLookup = await fetch(`${url}/rest/v1/team_members?auth_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id&limit=1`, {
            headers: { apikey: secret, Authorization: `Bearer ${secret}` },
            cache: "no-store",
          });
          if (memberLookup.ok && ((await memberLookup.json()) as Array<{ id: string }>).length > 0) return NextResponse.next();
        }
      }
    }
  }
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const login = new URL("/login", request.url); login.searchParams.set("next", `${path}${request.nextUrl.search}`); const response=NextResponse.redirect(login); response.cookies.set("hae_access_token","",{path:"/",maxAge:0}); response.cookies.set("hae_refresh_token","",{path:"/",maxAge:0}); return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|hamro-afno-logo.jpeg).*)"] };
