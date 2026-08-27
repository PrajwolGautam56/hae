import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getCurrentMember } from "../../../lib/current-member";
import { getSelectedBusinessCompany } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";

export const dynamic = "force-dynamic";

type OrderLineRow = { quantity: number | string; product?: { stock_qty?: number | string } | null };
type OrderRow = { status: string; customer_order_lines?: OrderLineRow[]; [key: string]: unknown };

async function snapshot() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Database configuration is missing");
  const company = await getSelectedBusinessCompany(db);
  const member = await getCurrentMember(db, company.id);
  if (!member) return { unauthorized: true as const };
  const { data: orders, error } = await db.from("customer_orders")
    .select("id,party_id,order_no,status,notes,total,placed_at,updated_at,delivered_at,delivered_by,party:parties(name,place,phone),customer_order_lines(id,product_id,product_name,unit,quantity,unit_price,amount,product:products(stock_qty)),customer_order_status_history(id,from_status,to_status,changed_by_type,note,created_at)")
    .eq("company_id",member.company_id).order("placed_at",{ascending:false}).limit(250);
  if (error) throw error;
  const rows=((orders||[]) as unknown as OrderRow[]).map((order)=>({...order,hasShortage:(order.customer_order_lines||[]).some((line)=>Number(line.quantity)>Number(line.product?.stock_qty||0))}));
  return { member, orders: rows, counts: rows.reduce<Record<string,number>>((result,order)=>{result[order.status]=(result[order.status]||0)+1;return result},{}) };
}

export async function GET() {
  try { await requireFeature("orders");const data=await snapshot();if("unauthorized" in data)return NextResponse.json({error:"Staff sign-in required"},{status:401});return NextResponse.json(data); }
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Orders could not load"},{status:500})}
}

export async function POST(request:Request){
  try{
    await requireFeature("orders");
    const db=getSupabaseAdmin();if(!db)throw new Error("Database configuration is missing");
    const company=await getSelectedBusinessCompany(db);const member=await getCurrentMember(db,company.id);if(!member)return NextResponse.json({error:"Staff sign-in required"},{status:401});
    const body=await request.json();const status=String(body.status||"");
    const allowed=["pending","accepted","preparing","packing","sent","delivered","out_of_stock","rejected","cancelled"];
    if(!allowed.includes(status))return NextResponse.json({error:"Invalid order status"},{status:400});
    const {data:order}=await db.from("customer_orders").select("id").eq("id",body.orderId).eq("company_id",member.company_id).maybeSingle();
    if(!order)return NextResponse.json({error:"Order not found"},{status:404});
    const {error}=await db.rpc("update_customer_order_status",{p_order_id:order.id,p_status:status,p_changed_by_type:"staff",p_changed_by:member.id,p_note:String(body.note||"")});if(error)throw error;
    return NextResponse.json(await snapshot());
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Order update failed"},{status:500})}
}
