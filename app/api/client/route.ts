import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getCurrentParty } from "../../../lib/current-party";
import { requireFeature } from "../../../lib/feature-access";

export const dynamic = "force-dynamic";

type FiscalYearRow = { id: string; label_bs: string; start_ad: string; end_ad: string; status: string };
type LedgerRow = {
  id: string;
  entry_date: string;
  account_name: string;
  debit: number | string;
  credit: number | string;
  created_at: string;
  vouchers: { voucher_no: string; voucher_type: string; narration: string | null; payment_mode: string | null; fiscal_year_id: string };
};
type SubmittedOrderLine = { productId?: unknown; quantity?: unknown };

async function clientSnapshot(requestedFiscalYearId?: string) {
  await requireFeature("customer_portal");
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Database configuration is missing");
  const party = await getCurrentParty(db);
  if (!party) return { unauthorized: true as const };
  const [{ data: company, error: companyError }, { data: years, error: yearError }, { data: products, error: productError }, { data: orders, error: orderError }] = await Promise.all([
    db.from("companies").select("id,name,currency,logo_url,address,phone").eq("id", party.company_id).single(),
    db.from("fiscal_years").select("id,label_bs,start_ad,end_ad,status").eq("company_id",party.company_id).order("start_ad",{ascending:false}),
    db.from("products").select("id,sku,name,unit,sale_price,stock_qty,item_type").eq("company_id",party.company_id).eq("active",true).in("item_type",["finished_good","resale_good"]).order("name"),
    db.from("customer_orders").select("id,order_no,status,notes,total,placed_at,updated_at,delivered_at,delivered_by,customer_order_lines(id,product_id,product_name,unit,quantity,unit_price,amount),customer_order_status_history(id,from_status,to_status,changed_by_type,note,created_at)").eq("company_id",party.company_id).eq("party_id",party.id).order("placed_at",{ascending:false}),
  ]);
  if (companyError || yearError || productError || orderError) throw companyError || yearError || productError || orderError;
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kathmandu",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const fiscalYears = (years || []) as FiscalYearRow[];
  const requestedFiscalYear = requestedFiscalYearId ? fiscalYears.find((year)=>year.id===requestedFiscalYearId) : undefined;
  const fiscalYear = requestedFiscalYear || fiscalYears.find((year)=>year.start_ad<=today&&year.end_ad>=today) || fiscalYears[0];
  if (!fiscalYear) throw new Error("Fiscal year not found");
  const [{ data: opening, error: openingError }, { data: ledger, error: ledgerError }] = await Promise.all([
    db.from("party_opening_balances").select("amount").eq("fiscal_year_id",fiscalYear.id).eq("party_id",party.id).maybeSingle(),
    db.from("ledger_entries").select("id,entry_date,account_name,debit,credit,created_at,vouchers!inner(id,voucher_no,voucher_type,narration,payment_mode,fiscal_year_id)").eq("company_id",party.company_id).eq("party_id",party.id).eq("vouchers.fiscal_year_id",fiscalYear.id).order("entry_date").order("created_at"),
  ]);
  if (openingError || ledgerError) throw openingError || ledgerError;
  let running = Number(opening?.amount || 0);
  const ledgerRows = ((ledger || []) as unknown as LedgerRow[]).map((entry)=>{running += Number(entry.debit)-Number(entry.credit);return {id:entry.id,date:entry.entry_date,reference:entry.vouchers.voucher_no,type:entry.account_name==="Cancelled Cheque Receipt Adjustment"?"cheque_adjustment":entry.vouchers.voucher_type,particulars:entry.account_name==="Cancelled Cheque Receipt Adjustment"?"Cancelled cheque receipt adjusted":entry.vouchers.narration||entry.account_name,paymentMode:entry.vouchers.payment_mode,debit:Number(entry.debit),credit:Number(entry.credit),balance:running}});
  return { company, party, fiscalYear, fiscalYears, products: products || [], orders: orders || [], ledger: ledgerRows, opening: Number(opening?.amount || 0), balance: running };
}

export async function GET(request: Request) {
  try {
    const snapshot = await clientSnapshot(new URL(request.url).searchParams.get("fy") || undefined);
    if ("unauthorized" in snapshot) return NextResponse.json({ error: "Customer sign-in required" }, { status: 401 });
    return NextResponse.json(snapshot);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Customer portal error" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    await requireFeature("customer_portal");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Database configuration is missing");
    const party = await getCurrentParty(db);
    if (!party) return NextResponse.json({ error: "Customer sign-in required" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "place_order");
    if (action === "place_order") {
      const lines = Array.isArray(body.lines) ? (body.lines as SubmittedOrderLine[]).filter((line)=>Number(line.quantity)>0).map((line)=>({product_id:String(line.productId),quantity:Number(line.quantity)})) : [];
      if (!lines.length) return NextResponse.json({ error: "Add at least one product" }, { status: 400 });
      const { error } = await db.rpc("place_customer_order",{p_party_id:party.id,p_lines:lines,p_notes:String(body.notes||"")});
      if (error) throw error;
    } else if (action === "confirm_delivery") {
      const { data: order } = await db.from("customer_orders").select("id,status").eq("id",body.orderId).eq("company_id",party.company_id).eq("party_id",party.id).maybeSingle();
      if (!order || order.status!=="sent") return NextResponse.json({ error: "Only dispatched orders can be confirmed delivered" }, { status: 400 });
      const { error } = await db.rpc("update_customer_order_status",{p_order_id:order.id,p_status:"delivered",p_changed_by_type:"customer",p_changed_by:party.id,p_note:"Delivery confirmed by buyer"});
      if (error) throw error;
    } else return NextResponse.json({ error: "Unsupported customer action" }, { status: 400 });
    const snapshot = await clientSnapshot();
    return NextResponse.json(snapshot,{status:201});
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Customer request failed" }, { status: 500 }); }
}
