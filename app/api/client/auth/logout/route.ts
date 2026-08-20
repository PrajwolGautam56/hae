import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set("hae_party_access_token", "", { path: "/", maxAge: 0 });
  response.cookies.set("hae_party_refresh_token", "", { path: "/", maxAge: 0 });
  return response;
}
