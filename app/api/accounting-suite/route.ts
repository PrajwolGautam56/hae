import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getBusinessContext } from "../../../lib/company-context";
import { getCurrentMember } from "../../../lib/current-member";
import { requireFeature } from "../../../lib/feature-access";
import { assertCompanyRecord, assertCompanyRecords } from "../../../lib/company-ownership";

export const dynamic = "force-dynamic";

const businessDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

async function context(fiscalYearId?: string) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase server configuration is missing");
  const { company } = await getBusinessContext(db);
  const today = businessDate();
  let fiscalYearQuery = db.from("fiscal_years").select("*").eq("company_id", company.id);
  if (fiscalYearId) fiscalYearQuery = fiscalYearQuery.eq("id", fiscalYearId);
  const { data: fiscalYears, error } = await fiscalYearQuery.order("start_ad", { ascending: false });
  if (error) throw error;
  const fiscalYear = fiscalYears?.find((year) => year.start_ad <= today && year.end_ad >= today) || fiscalYears?.[0];
  if (!fiscalYear) throw new Error("Fiscal year not found");
  const member = await getCurrentMember(db, company.id);
  if (!member) throw new Error("Active team access is required");
  return { db, company, fiscalYear, member };
}

async function suiteSnapshot(fiscalYearId?: string) {
  const { db, company, fiscalYear, member } = await context(fiscalYearId);
  const [ordersResult, bomsResult, batchesResult, accountsResult, vouchersResult, sequencesResult, sourceInvoicesResult, payrollResult] = await Promise.all([
    db.from("purchase_orders")
      .select("id,order_no,sequence_no,order_date,expected_date,supplier_reference,narration,subtotal,discount_percent,discount_amount,tax_percent,tax_amount,total,status,created_at,supplier:parties!po_company_supplier_fkey(id,name,place,phone,tax_no),creator:team_members!po_company_creator_fkey(name),purchase_order_lines(id,product_id,description,quantity,received_quantity,billed_quantity,rate,amount,unit,item_type,products(name,sku,stock_qty))")
      .eq("company_id", company.id).eq("fiscal_year_id", fiscalYear.id)
      .order("order_date", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    db.from("bills_of_materials")
      .select("id,name,version,output_quantity,notes,active,created_at,output:products!bom_company_output_fkey(id,name,sku,unit,stock_qty,item_type),bom_components(id,product_id,quantity,wastage_percent,notes,products(name,sku,unit,stock_qty,item_type,purchase_price))")
      .eq("company_id", company.id).order("updated_at", { ascending: false }),
    db.from("production_batches")
      .select("id,batch_no,production_date,output_quantity,notes,production_status,bom_id,output:products!production_company_output_fkey(name,unit),bills_of_materials(name,version),production_consumptions(quantity,products(name,unit))")
      .eq("company_id", company.id).eq("fiscal_year_id", fiscalYear.id)
      .order("production_date", { ascending: false }).limit(50),
    db.from("accounts").select("id,code,name,account_type,normal_side,system_key,active")
      .eq("company_id", company.id).eq("active", true).order("code"),
    db.from("vouchers")
      .select("id,voucher_no,sequence_no,voucher_type,voucher_date,narration,total,source_voucher_id,source_order_id,document_status,party:parties!vouchers_company_party_fkey(id,name),source:vouchers!vouchers_company_source_voucher_fkey(voucher_no,voucher_type)")
      .eq("company_id", company.id).eq("fiscal_year_id", fiscalYear.id)
      .in("voucher_type", ["sale_return", "purchase_return", "journal", "contra", "stock_adjustment", "payroll"])
      .order("voucher_date", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    db.from("voucher_sequences").select("voucher_type,last_number").eq("fiscal_year_id", fiscalYear.id),
    db.from("vouchers")
      .select("id,voucher_no,sequence_no,voucher_type,voucher_date,total,party:parties!vouchers_company_party_fkey(id,name),voucher_lines(id,product_id,description,quantity,rate,amount,products(name,sku,unit,stock_qty))")
      .eq("company_id", company.id).eq("fiscal_year_id", fiscalYear.id).in("voucher_type", ["sale", "purchase"])
      .order("voucher_date", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    db.from("payroll_runs")
      .select("id,run_no,sequence_no,period_label,pay_date,gross_amount,deduction_amount,net_amount,status,notes,payroll_lines(id,basic_salary,allowances,deductions,net_amount,notes,team_members(name,role))")
      .eq("company_id", company.id).eq("fiscal_year_id", fiscalYear.id).order("pay_date", { ascending: false }).limit(50),
  ]);
  const error = ordersResult.error || bomsResult.error || batchesResult.error || accountsResult.error || vouchersResult.error || sequencesResult.error || sourceInvoicesResult.error || payrollResult.error;
  if (error) throw error;
  return {
    company, fiscalYear, currentMember: member,
    purchaseOrders: ordersResult.data || [], boms: bomsResult.data || [],
    productionBatches: batchesResult.data || [], accounts: accountsResult.data || [],
    vouchers: vouchersResult.data || [], sourceInvoices: sourceInvoicesResult.data || [], payrollRuns: payrollResult.data || [],
    nextNumbers: Object.fromEntries(["purchase_order", "sale_return", "purchase_return", "journal", "contra", "stock_adjustment"]
      .map((type) => [type, Number(sequencesResult.data?.find((row) => row.voucher_type === type)?.last_number || 0) + 1])),
  };
}

export async function GET(request: Request) {
  try {
    await requireFeature("accounting");
    return NextResponse.json(await suiteSnapshot(new URL(request.url).searchParams.get("fy") || undefined));
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Accounting suite could not load" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireFeature("accounting");
    const body = await request.json();
    const action = String(body.action || "");
    if (["save_bom", "bom_production"].includes(action)) await requireFeature("manufacturing");
    const { db, company, fiscalYear, member } = await context(String(body.fiscalYearId || ""));
    const date = String(body.date || businessDate());
    if (date < fiscalYear.start_ad || date > fiscalYear.end_ad) {
      return NextResponse.json({ error: "Date is outside selected fiscal year" }, { status: 400 });
    }

    let result: { data: unknown; error: { message: string } | null };
    if (action === "purchase_order") {
      await assertCompanyRecord(db, "parties", body.supplierId, company.id, "Supplier");
      await assertCompanyRecords(db, "products", (body.lines || []).map((line: Record<string, unknown>) => line.product_id), company.id, "Purchase order products");
      result = await db.rpc("record_purchase_order", {
        p_company_id: company.id, p_fiscal_year_id: fiscalYear.id, p_supplier_id: body.supplierId,
        p_order_date: date, p_expected_date: body.expectedDate || null, p_lines: body.lines,
        p_discount_percent: Number(body.discountPercent || 0), p_tax_percent: Number(body.taxPercent || 0),
        p_narration: String(body.narration || ""), p_supplier_reference: String(body.supplierReference || ""),
        p_created_by: member.id,
      });
    } else if (action === "convert_purchase_order") {
      await assertCompanyRecord(db, "purchase_orders", body.purchaseOrderId, company.id, "Purchase order");
      result = await db.rpc("convert_purchase_order_to_bill", {
        p_purchase_order_id: body.purchaseOrderId, p_bill_date: date, p_generated_by: member.id,
      });
    } else if (action === "goods_return") {
      await assertCompanyRecord(db, "vouchers", body.sourceVoucherId, company.id, "Original invoice");
      await assertCompanyRecords(db, "products", (body.lines || []).map((line: Record<string, unknown>) => line.product_id), company.id, "Returned products");
      result = await db.rpc("record_goods_return", {
        p_company_id: company.id, p_fiscal_year_id: fiscalYear.id,
        p_source_voucher_id: body.sourceVoucherId, p_return_type: body.returnType,
        p_date: date, p_lines: body.lines, p_narration: String(body.narration || ""), p_generated_by: member.id,
      });
    } else if (action === "manual_journal") {
      const journalLines = Array.isArray(body.lines) ? body.lines : [];
      await Promise.all([
        assertCompanyRecords(db, "accounts", journalLines.map((line: Record<string, unknown>) => line.account_id), company.id, "Journal accounts"),
        assertCompanyRecords(db, "parties", journalLines.map((line: Record<string, unknown>) => line.party_id), company.id, "Journal parties"),
      ]);
      result = await db.rpc("record_manual_journal", {
        p_company_id: company.id, p_fiscal_year_id: fiscalYear.id, p_date: date,
        p_lines: journalLines, p_narration: String(body.narration || ""), p_generated_by: member.id,
      });
    } else if (action === "contra") {
      await assertCompanyRecords(db, "money_accounts", [body.fromAccountId, body.toAccountId], company.id, "Cash or bank accounts");
      result = await db.rpc("record_contra_voucher", {
        p_company_id: company.id, p_fiscal_year_id: fiscalYear.id, p_date: date,
        p_from_account_id: body.fromAccountId, p_to_account_id: body.toAccountId,
        p_amount: Number(body.amount), p_narration: String(body.narration || ""), p_generated_by: member.id,
      });
    } else if (action === "stock_adjustment") {
      const stockLines = Array.isArray(body.lines) ? body.lines : [];
      await assertCompanyRecords(db, "products", stockLines.map((line: Record<string, unknown>) => line.product_id), company.id, "Stock adjustment products");
      result = await db.rpc("record_stock_adjustment", {
        p_company_id: company.id, p_fiscal_year_id: fiscalYear.id, p_date: date,
        p_lines: stockLines, p_narration: String(body.narration || ""), p_generated_by: member.id,
      });
    } else if (action === "save_bom") {
      const components = Array.isArray(body.components) ? body.components : [];
      await Promise.all([
        assertCompanyRecord(db, "products", body.outputProductId, company.id, "Output product"),
        assertCompanyRecords(db, "products", components.map((line: Record<string, unknown>) => line.product_id), company.id, "BOM components"),
      ]);
      if (body.bomId) await assertCompanyRecord(db, "bills_of_materials", body.bomId, company.id, "BOM");
      result = await db.rpc("save_bill_of_materials", {
        p_company_id: company.id, p_output_product_id: body.outputProductId,
        p_name: String(body.name || "Standard BOM"), p_version: String(body.version || "1"),
        p_output_quantity: Number(body.outputQuantity), p_components: components,
        p_notes: String(body.notes || ""), p_created_by: member.id, p_bom_id: body.bomId || null,
      });
    } else if (action === "bom_production") {
      await assertCompanyRecord(db, "bills_of_materials", body.bomId, company.id, "BOM");
      result = await db.rpc("record_bom_production", {
        p_company_id: company.id, p_fiscal_year_id: fiscalYear.id, p_bom_id: body.bomId,
        p_date: date, p_output_quantity: Number(body.outputQuantity), p_notes: String(body.notes || ""),
      });
    } else if (action === "payroll") {
      const payrollLines = Array.isArray(body.lines) ? body.lines : [];
      await assertCompanyRecords(db, "team_members", payrollLines.map((line: Record<string, unknown>) => line.team_member_id), company.id, "Payroll employees");
      result = await db.rpc("record_payroll_run", {
        p_company_id: company.id, p_fiscal_year_id: fiscalYear.id, p_date: date,
        p_period_label: String(body.periodLabel || ""), p_lines: payrollLines,
        p_notes: String(body.narration || ""), p_created_by: member.id,
      });
    } else {
      return NextResponse.json({ error: "Unsupported accounting action" }, { status: 400 });
    }
    if (result.error) throw result.error;
    return NextResponse.json({ result: result.data, snapshot: await suiteSnapshot(fiscalYear.id) }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Accounting operation failed" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await requireFeature("accounting");
    const body = await request.json();
    const { db, company, fiscalYear } = await context(String(body.fiscalYearId || ""));
    if (String(body.action) !== "purchase_order_status") return NextResponse.json({ error: "Unsupported update" }, { status: 400 });
    await assertCompanyRecord(db, "purchase_orders", body.purchaseOrderId, company.id, "Purchase order");
    const status = String(body.status || "");
    if (!["draft", "sent", "cancelled"].includes(status)) return NextResponse.json({ error: "Invalid purchase order status" }, { status: 400 });
    const { error } = await db.from("purchase_orders").update({ status, updated_at: new Date().toISOString() })
      .eq("id", body.purchaseOrderId).eq("company_id", company.id).not("status", "in", "(billed,cancelled)");
    if (error) throw error;
    return NextResponse.json({ snapshot: await suiteSnapshot(fiscalYear.id) });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Purchase order could not update" }, { status: 500 });
  }
}
