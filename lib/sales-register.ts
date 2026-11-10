import type { SupabaseClient } from "@supabase/supabase-js";

export const SALES_PAGE_SIZE = 25;
export type SalesSeries = "all" | "standard" | "non_vat";
export type SalesRegisterOptions = { search: string; series: SalesSeries; page: number };

export function salesRegisterOptions(params: URLSearchParams): SalesRegisterOptions {
  const search = (params.get("search") || "").trim().replace(/[०-९]/g, digit => String("०१२३४५६७८९".indexOf(digit)));
  if (search.length > 100) throw new Error("Invoice search must be 100 characters or fewer");
  const series = params.get("series") || "all";
  if (!["all", "standard", "non_vat"].includes(series)) throw new Error("Invalid bill series");
  const page = Number(params.get("page") || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new Error("Invalid page number");
  return { search, series: series as SalesSeries, page };
}

/** Independent of the overview's recent-50 snapshot; search the entire selected FY. */
export async function loadSalesRegister(db: SupabaseClient, companyId: string, fiscalYearId: string, options: SalesRegisterOptions) {
  let query = db.from("vouchers")
    .select("id,voucher_no,sequence_no,number_series,voucher_date,total,document_status,party:parties!vouchers_company_party_fkey(name)", { count: "exact" })
    .eq("company_id", companyId).eq("fiscal_year_id", fiscalYearId).eq("voucher_type", "sale");
  const serial = /^(NB[\s-]*)?(\d+)$/i.exec(options.search);
  if (options.series !== "all") query = query.eq("number_series", options.series);
  if (serial) {
    const number = Number(serial[2]);
    if (!Number.isSafeInteger(number)) throw new Error("Invalid invoice number");
    query = query.eq("sequence_no", number);
    if (serial[1]) query = query.eq("number_series", "non_vat");
  } else if (options.search) {
    // A single literal ILIKE value, never interpolated into a PostgREST OR expression.
    const literal = options.search.replace(/[\\%_]/g, value => `\\${value}`);
    query = query.ilike("voucher_no", `%${literal}%`);
  }
  const offset = (options.page - 1) * SALES_PAGE_SIZE;
  const { data, count, error } = await query
    .order("voucher_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + SALES_PAGE_SIZE - 1);
  if (error) throw error;
  if (count === null) throw new Error("Bill count could not be loaded");
  return { rows: data || [], total: count, page: options.page, pageSize: SALES_PAGE_SIZE, pages: Math.max(1, Math.ceil(count / SALES_PAGE_SIZE)) };
}
