import { NextResponse } from "next/server";
import { PLATFORM_ACCESS_COOKIE, PLATFORM_REFRESH_COOKIE } from "../../../../../lib/platform-admin";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(PLATFORM_ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(PLATFORM_REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
