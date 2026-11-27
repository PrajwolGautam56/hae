import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  companiesForHost,
  COMPANY_COOKIE,
} from "../../../../lib/platform-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const registry = await companiesForHost(host);
  if (!registry)
    return NextResponse.json(
      { error: "This workspace is not registered" },
      { status: 404 },
    );
  const selected = (await cookies()).get(COMPANY_COOKIE)?.value;
  const company = registry.companies.find(
    (item) =>
      item.slug === selected && item.status === "active" && item.loginEnabled,
  );
  const response = NextResponse.json({
    tenant: registry.tenant,
    companies: registry.companies.map((company) => ({
      id: company.id,
      slug: company.slug,
      name: company.name,
      status: company.status,
      loginEnabled: company.loginEnabled,
    })),
    subscription: registry.subscription,
    entitlements: {
      ...registry.entitlements,
      manufacturing:
        registry.entitlements.manufacturing === true &&
        company?.manufacturingEnabled === true,
    },
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
