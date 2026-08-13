import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/reset-password", "/api/auth/login", "/api/auth/logout"];
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.some((entry) => path === entry || path.startsWith(`${entry}/`))) return NextResponse.next();
  const token = request.cookies.get("hae_access_token")?.value;
  if (token) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (url && key) {
      const validation = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (validation.ok) return NextResponse.next();
    }
  }
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const login = new URL("/login", request.url); login.searchParams.set("next", `${path}${request.nextUrl.search}`); const response=NextResponse.redirect(login); response.cookies.set("hae_access_token","",{path:"/",maxAge:0}); response.cookies.set("hae_refresh_token","",{path:"/",maxAge:0}); return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|hamro-afno-logo.jpeg).*)"] };
