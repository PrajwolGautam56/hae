import type { SupabaseClient } from "@supabase/supabase-js";

// PostgREST cannot reliably resolve the composite self-referencing voucher
// relationship. Fetch the referenced invoices explicitly, scoped to the same
// company, including invoices from earlier fiscal years.
export async function loadSuiteVouchers(db: SupabaseClient, companyId: string, fiscalYearId: string) {
  const { data: vouchers, error } = await db.from("vouchers")
    .select("id,voucher_no,sequence_no,voucher_type,voucher_date,narration,total,source_voucher_id,source_order_id,document_status,party:parties!vouchers_company_party_fkey(id,name)")
    .eq("company_id", companyId).eq("fiscal_year_id", fiscalYearId)
    .in("voucher_type", ["sale_return", "purchase_return", "journal", "contra", "stock_adjustment", "payroll"])
    .order("voucher_date", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const rows = vouchers || [];
  const ids = [...new Set(rows.map(row => row.source_voucher_id as string | null).filter((id): id is string => Boolean(id)))];
  const sources = new Map<string, { voucher_no: string; voucher_type: string }>();
  if (ids.length) {
    const { data, error: sourceError } = await db.from("vouchers")
      .select("id,company_id,voucher_no,voucher_type").eq("company_id", companyId).in("id", ids);
    if (sourceError) throw sourceError;
    for (const source of data || []) {
      if (source.company_id === companyId) sources.set(source.id, { voucher_no: source.voucher_no, voucher_type: source.voucher_type });
    }
  }
  return rows.map(row => ({ ...row, source: sources.get(row.source_voucher_id) || null }));
}
