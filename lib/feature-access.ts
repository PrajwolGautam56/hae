import { cookies, headers } from "next/headers";
import {
  companiesForHost,
  COMPANY_COOKIE,
  type TenantCompanies,
} from "./platform-control";

export async function tenantAccess(fresh = false): Promise<TenantCompanies> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const registry = await companiesForHost(host, fresh);
  if (!registry) throw new Error("This workspace is not registered");
  if (
    registry.subscription &&
    !["trial", "active"].includes(registry.subscription.status)
  )
    throw new Error("This workspace subscription is not active");
  if (
    registry.subscription?.expiresOn &&
    registry.subscription.expiresOn < new Date().toISOString().slice(0, 10)
  )
    throw new Error("This workspace subscription has expired");
  return registry;
}

export async function requireFeature(featureKey: string) {
  const registry = await tenantAccess(featureKey === "manufacturing");
  if (registry.entitlements[featureKey] !== true)
    throw new Error(
      `The ${featureKey.replaceAll("_", " ")} module is not included in this subscription`,
    );
  if (featureKey === "manufacturing") {
    const slug = (await cookies()).get(COMPANY_COOKIE)?.value;
    const company = registry.companies.find((item) => item.slug === slug);
    if (!company || company.status !== "active" || !company.loginEnabled)
      throw new Error("Select an active company before using manufacturing");
    if (company.manufacturingEnabled !== true)
      throw new Error(
        "Manufacturing is disabled for this company by your platform administrator",
      );
  }
  return registry;
}
