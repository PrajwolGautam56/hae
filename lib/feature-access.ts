import { headers } from "next/headers";
import { companiesForHost, type TenantCompanies } from "./platform-control";

export async function tenantAccess(): Promise<TenantCompanies> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const registry = await companiesForHost(host);
  if (!registry) throw new Error("This workspace is not registered");
  if (registry.subscription && !["trial", "active"].includes(registry.subscription.status)) throw new Error("This workspace subscription is not active");
  if (registry.subscription?.expiresOn && registry.subscription.expiresOn < new Date().toISOString().slice(0, 10)) throw new Error("This workspace subscription has expired");
  return registry;
}

export async function requireFeature(featureKey: string) {
  const registry = await tenantAccess();
  if (registry.entitlements[featureKey] !== true) throw new Error(`The ${featureKey.replaceAll("_", " ")} module is not included in this subscription`);
  return registry;
}
