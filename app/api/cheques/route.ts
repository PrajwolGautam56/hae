import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";

async function list() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase server configuration is missing");
  const { data: companies, error: companyError } = await db.from("companies").select("id").order("created_at").limit(1);
  if (companyError || !companies?.[0]) throw companyError || new Error("Company not found");
  const [{ data, error }, { data: banks, error: bankError }] = await Promise.all([
    db.from("vouchers").select("id,voucher_no,voucher_date,total,cheque_no,cheque_bank,cheque_exchange_date,cheque_status,cheque_cleared_at,narration,party_id,parties(name,phone)").eq("company_id", companies[0].id).eq("voucher_type", "receipt").eq("payment_mode", "Cheque").order("cheque_exchange_date", { ascending: true }).order("created_at", { ascending: false }),
    db.from("cheque_banks").select("id,name").eq("company_id", companies[0].id).eq("active", true).order("name"),
  ]);
  if (error || bankError) throw error || bankError;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const rows = (data || []).map((x:any) => ({ ...x, party: x.parties?.name || "Unknown party", phone: x.parties?.phone || "", days_pending: x.cheque_status === "pending" && x.cheque_exchange_date < today ? Math.floor((Date.parse(`${today}T00:00:00Z`)-Date.parse(`${x.cheque_exchange_date}T00:00:00Z`))/86400000) : 0, due_today: x.cheque_status === "pending" && x.cheque_exchange_date === today, overdue: x.cheque_status === "pending" && x.cheque_exchange_date < today }));
  return { today, rows, banks: banks || [], counts: { pending: rows.filter(x=>x.cheque_status==="pending").length, dueToday: rows.filter(x=>x.due_today).length, overdue: rows.filter(x=>x.overdue).length, cleared: rows.filter(x=>x.cheque_status==="cleared").length } };
}

export async function GET(){try{return NextResponse.json(await list())}catch(error:any){return NextResponse.json({error:error?.message||"Cheque register error"},{status:500})}}

export async function POST(request:Request){
  try{
    const db=getSupabaseAdmin();if(!db)throw new Error("Supabase server configuration is missing");
    const body=await request.json();const status=String(body.status||"");
    if(!["pending","cleared","cancelled"].includes(status))return NextResponse.json({error:"Invalid cheque status"},{status:400});
    const {error}=await db.from("vouchers").update({cheque_status:status,cheque_cleared_at:status==="cleared"?new Date().toISOString():null}).eq("id",body.chequeId).eq("payment_mode","Cheque");
    if(error)throw error;return NextResponse.json(await list());
  }catch(error:any){return NextResponse.json({error:error?.message||"Cheque update failed"},{status:500})}
}
