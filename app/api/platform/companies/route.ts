import { NextResponse } from "next/server";
import { companiesForHost } from "../../../../lib/platform-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const registry = await companiesForHost(host);
  if (!registry) return NextResponse.json({ error: "This workspace is not registered" }, { status: 404 });
  const response = NextResponse.json({
    tenant: registry.tenant,
    companies: registry.companies.map((company) => ({ id: company.id, slug: company.slug, name: company.name, status: company.status, loginEnabled: company.loginEnabled })),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
