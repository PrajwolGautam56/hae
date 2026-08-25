import { NextResponse } from "next/server";
import { authorizePlatformAdmin } from "../../../../../lib/platform-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { admin } = await authorizePlatformAdmin(request);
    if (!admin) return NextResponse.json({ error: "Platform administrator sign-in required" }, { status: 401 });
    return NextResponse.json({ user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Session check failed" }, { status: 500 });
  }
}
