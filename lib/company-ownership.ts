import type { getSupabaseAdmin } from "./supabase-server";

type Db = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type CompanyOwnedTable =
  | "parties" | "products" | "vouchers" | "fiscal_years" | "team_members"
  | "money_accounts" | "leads" | "work_tasks" | "crm_activities"
  | "customer_orders" | "production_batches" | "purchase_orders"
  | "bills_of_materials" | "accounts";

export async function assertCompanyRecord(
  db: Db,
  table: CompanyOwnedTable,
  id: unknown,
  companyId: string,
  label = "Selected record",
) {
  const recordId = String(id || "");
  if (!recordId) throw new Error(`${label} is required`);
  const { data, error } = await db.from(table).select("id").eq("id", recordId).eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`${label} does not belong to the selected company`);
  return recordId;
}

export async function assertOptionalCompanyRecord(
  db: Db,
  table: CompanyOwnedTable,
  id: unknown,
  companyId: string,
  label?: string,
) {
  if (id === null || id === undefined || id === "") return null;
  return assertCompanyRecord(db, table, id, companyId, label);
}

export async function assertCompanyRecords(
  db: Db,
  table: CompanyOwnedTable,
  ids: unknown[],
  companyId: string,
  label = "Selected records",
) {
  const uniqueIds = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const { data, error } = await db.from(table).select("id").eq("company_id", companyId).in("id", uniqueIds);
  if (error) throw error;
  if ((data || []).length !== uniqueIds.length) throw new Error(`${label} include a record from another company`);
  return uniqueIds;
}
