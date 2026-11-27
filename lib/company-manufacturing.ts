type Entitlement = {
  tenant_id?: string;
  feature_key: string;
  enabled: boolean;
  limits?: unknown;
};
const object = (value: unknown): Record<string, any> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
export function manufacturingOverride(
  limits: unknown,
  companyId: string,
): boolean | null {
  if (limits === null || limits === undefined) return null;
  const data = object(limits);
  if (!data) return false;
  if (data.company_overrides === undefined) return null;
  const overrides = object(data.company_overrides);
  if (!overrides) return false;
  if (!Object.prototype.hasOwnProperty.call(overrides, companyId)) return null;
  return typeof overrides[companyId] === "boolean"
    ? overrides[companyId]
    : false;
}
export function companyManufacturingPolicy(
  rows: Entitlement[],
  tenantId: string,
  tenantSlug: string,
  companyId: string,
) {
  const clientRows = rows.filter(
    (row) => row.tenant_id === undefined || row.tenant_id === tenantId,
  );
  const row = clientRows.find((row) => row.feature_key === "manufacturing");
  const clientEnabled = clientRows.length
    ? row?.enabled === true
    : tenantSlug === "hamro";
  const override = manufacturingOverride(row?.limits, companyId);
  return {
    clientEnabled,
    override,
    enabled: clientEnabled && override !== false,
  };
}
export function changedManufacturingLimits(
  limits: unknown,
  companyId: string,
  enabled: boolean | null,
) {
  const current = limits === undefined || limits === null ? {} : object(limits);
  if (
    !current ||
    (current.company_overrides !== undefined &&
      !object(current.company_overrides))
  )
    throw new Error("Module configuration needs administrator review");
  const overrides = { ...(object(current.company_overrides) || {}) };
  if (enabled === null) delete overrides[companyId];
  else overrides[companyId] = enabled;
  return { ...current, company_overrides: overrides };
}
