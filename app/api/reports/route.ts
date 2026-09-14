import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";

import { financialReport } from "../../../lib/financial-reports";
import { connectedReport } from "../../../lib/connected-reports";
import { allReportRows } from "../../../lib/report-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFeature("reports");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Supabase server configuration is missing");
    const q = new URL(request.url).searchParams;
    const partyId = q.get("partyId");
    const fiscalYearId = q.get("fiscalYearId");
    const reportType = q.get("type") || "daybook";
    const accountId = q.get("accountId");
    const from = q.get("from");
    const to = q.get("to");

    const { company } = await getBusinessContext(db);
    let fyQuery = db.from("fiscal_years").select("*").eq("company_id", company.id);
    if (fiscalYearId) fyQuery = fyQuery.eq("id", fiscalYearId);
    const { data: years, error: fyError } = await fyQuery.order("start_ad", { ascending: false }).limit(1);
    if (fyError || !years?.[0]) throw fyError || new Error("Fiscal year not found");
    const fy = years[0];
    const dateFrom = from || fy.start_ad;
    const dateTo = to || fy.end_ad;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return NextResponse.json({ error: "Valid report dates are required" }, { status: 400 });
    if (dateFrom < fy.start_ad || dateTo > fy.end_ad) return NextResponse.json({error:"Select dates inside the selected fiscal year"},{status:400});
    if (dateFrom > dateTo) return NextResponse.json({ error: "From date must be before To date" }, { status: 400 });

    if (["monthly_accounting","party_summary","aging_receivable","aging_payable","daybook"].includes(reportType)) {
      return NextResponse.json(await connectedReport(db,company,fy,reportType,dateFrom,dateTo,partyId));
    }

    if (["balance_sheet","profit_loss","group_summary","trial_balance","general_ledger"].includes(reportType)) {
      return NextResponse.json(await financialReport(db,company,fy,reportType,dateFrom,dateTo,accountId));
    }

    if (reportType === "stock_statement" || reportType === "stock_movement") {
      const [productsResult, periodResult, futureResult] = await Promise.all([
        allReportRows(db.from("products").select("id,sku,name,unit,item_type,stock_qty,purchase_price,sale_price").eq("company_id", company.id).order("name").order("id")).then(data=>({data,error:null})),
        allReportRows(db.from("stock_movements").select("id,product_id,movement_date,quantity,movement_type,unit_cost,notes,vouchers!stock_company_voucher_fkey(voucher_no,voucher_type)")
          .eq("company_id", company.id).gte("movement_date", dateFrom).lte("movement_date", dateTo).order("movement_date").order("created_at").order("id")).then(data=>({data,error:null})),
        allReportRows(db.from("stock_movements").select("product_id,quantity").eq("company_id", company.id).gt("movement_date", dateTo).order("id")).then(data=>({data,error:null})),
      ]);
      if (productsResult.error || periodResult.error || futureResult.error) throw productsResult.error || periodResult.error || futureResult.error;
      const future = new Map<string, number>();
      for (const move of futureResult.data || []) future.set(move.product_id, (future.get(move.product_id) || 0) + Number(move.quantity));
      const period = new Map<string, { inward: number; outward: number; net: number }>();
      for (const move of periodResult.data || []) {
        const quantity = Number(move.quantity); const value = period.get(move.product_id) || { inward: 0, outward: 0, net: 0 };
        if (quantity >= 0) value.inward += quantity; else value.outward += Math.abs(quantity); value.net += quantity; period.set(move.product_id, value);
      }
      if (reportType === "stock_movement") {
        const productMap = new Map((productsResult.data || []).map((product) => [product.id, product]));
        const rows = (periodResult.data || []).map((move) => ({ ...move, product: productMap.get(move.product_id), quantity: Number(move.quantity), unitCost: Number(move.unit_cost || 0), reference: (move.vouchers as any)?.voucher_no || "—", voucherType: (move.vouchers as any)?.voucher_type || move.movement_type }));
        return NextResponse.json({ company, fiscalYear: fy, from: dateFrom, to: dateTo, reportType, rows });
      }
      const rows = (productsResult.data || []).map((product) => {
        const activity = period.get(product.id) || { inward: 0, outward: 0, net: 0 };
        const closing = Number(product.stock_qty) - (future.get(product.id) || 0);
        const opening = closing - activity.net;
        return { ...product, opening, inward: activity.inward, outward: activity.outward, closing, stockValue: closing * Number(product.purchase_price) };
      });
      const totals = rows.reduce((sum, row) => ({ opening: sum.opening + row.opening, inward: sum.inward + row.inward,
        outward: sum.outward + row.outward, closing: sum.closing + row.closing, stockValue: sum.stockValue + row.stockValue }),
      { opening: 0, inward: 0, outward: 0, closing: 0, stockValue: 0 });
      return NextResponse.json({ company, fiscalYear: fy, from: dateFrom, to: dateTo, reportType, rows, totals });
    }

    if (reportType === "tax_summary") {
      const report:any=await connectedReport(db,company,fy,"monthly_accounting",dateFrom,dateTo,partyId);
      return NextResponse.json({...report,reportType,rows:report.rows.map((r:any)=>({...r,label:`${r.side} · ${r.label}${r.isReturn?" · Return":""}`})),
        totals:{...report.totals,netTaxPayable:report.totals.netTax}});
    }

    const voucherReportTypes:Record<string,string>={sales:"sale",purchases:"purchase",payments:"receipt",expenses:"expense",sales_returns:"sale_return",purchase_returns:"purchase_return",journals:"journal",contra:"contra",stock_adjustments:"stock_adjustment",payroll:"payroll",payments_given:"payment"};
    if(!voucherReportTypes[reportType])return NextResponse.json({error:"Unknown report type"},{status:400});
    let query=db.from("vouchers").select("id,voucher_no,voucher_type,voucher_date,narration,bill_category,supplier_bill_no,payment_mode,cheque_status,subtotal,discount_amount,tax_amount,total,party_id,parties!vouchers_company_party_fkey(name)")
      .eq("company_id",company.id).eq("fiscal_year_id",fy.id).eq("document_status","posted").eq("voucher_type",voucherReportTypes[reportType]).gte("voucher_date",dateFrom).lte("voucher_date",dateTo).order("voucher_date").order("created_at").order("id");
    let party=null;
    if(partyId){
      const {data,error}=await db.from("parties").select("id,name,place,phone,tax_no").eq("company_id",company.id).eq("id",partyId).single();
      if(error)throw error;party=data;query=query.eq("party_id",partyId);
    }
    const vouchers=await allReportRows(query);
    const rows=vouchers.map((v:any)=>{
      const amount=Number(v.total),both=["journal","contra","stock_adjustment","payroll"].includes(v.voucher_type);
      const debit=both||["sale","purchase_return","payment","expense"].includes(v.voucher_type)?amount:0;
      const credit=both||["purchase","sale_return","receipt"].includes(v.voucher_type)?amount:0;
      return {id:v.id,voucherId:v.id,ref:v.voucher_no,type:v.voucher_type,date:v.voucher_date,party:v.parties?.name||"Cash / Office",
        particulars:[v.narration,v.cheque_status==="cancelled"?"Cheque cancelled · see dated ledger reversal":""].filter(Boolean).join(" · "),
        paymentMode:v.payment_mode,subtotal:Number(v.subtotal),discount:Number(v.discount_amount),tax:Number(v.tax_amount),amount,debit,credit,balance:null};
    });
    const totals=rows.reduce((s,r)=>({debit:s.debit+r.debit,credit:s.credit+r.credit,amount:s.amount+r.amount}),{debit:0,credit:0,amount:0});
    return NextResponse.json({company,fiscalYear:fy,party,from:dateFrom,to:dateTo,reportType,opening:null,closing:null,totals,rows,registerOnly:true,
      basis:"Original posted documents by document date. For settlements and cheque reversals use the day book or party ledger."});
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Report database error" }, { status: 500 });
  }
}
