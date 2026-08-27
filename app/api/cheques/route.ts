import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getCurrentMember } from "../../../lib/current-member";
import { getSelectedBusinessCompany } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";

export const dynamic = "force-dynamic";

async function list() {
  await requireFeature("cheques");
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase server configuration is missing");
  const company = await getSelectedBusinessCompany(db);
  const [{ data, error }, { data: banks, error: bankError }, { data: accounts, error: accountError }] = await Promise.all([
    db.from("vouchers").select("id,voucher_no,voucher_date,total,cheque_no,cheque_bank,cheque_exchange_date,cheque_status,cheque_cleared_at,narration,party_id,money_account_id,parties(name,phone),money_account:money_accounts(name,account_type)").eq("company_id", company.id).eq("voucher_type", "receipt").eq("payment_mode", "Cheque").order("cheque_exchange_date", { ascending: true }).order("created_at", { ascending: false }),
    db.from("cheque_banks").select("id,name").eq("company_id", company.id).eq("active", true).order("name"),
    db.from("money_account_balances").select("id,name,account_type,balance").eq("company_id", company.id).eq("active", true).in("account_type", ["bank", "office_cash"]).order("account_type").order("name"),
  ]);
  if (error || bankError || accountError) throw error || bankError || accountError;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const rows = (data || []).map((x:any) => ({ ...x, party: x.parties?.name || "Unknown party", phone: x.parties?.phone || "", days_pending: x.cheque_status === "pending" && x.cheque_exchange_date < today ? Math.floor((Date.parse(`${today}T00:00:00Z`)-Date.parse(`${x.cheque_exchange_date}T00:00:00Z`))/86400000) : 0, due_today: x.cheque_status === "pending" && x.cheque_exchange_date === today, overdue: x.cheque_status === "pending" && x.cheque_exchange_date < today }));
  return { today, rows, banks: banks || [], accounts: (accounts || []).map((account:any)=>({...account,balance:Number(account.balance)})), counts: { pending: rows.filter(x=>x.cheque_status==="pending").length, dueToday: rows.filter(x=>x.due_today).length, overdue: rows.filter(x=>x.overdue).length, cleared: rows.filter(x=>x.cheque_status==="cleared").length } };
}

export async function GET(){try{return NextResponse.json(await list())}catch(error:any){return NextResponse.json({error:error?.message||"Cheque register error"},{status:500})}}

export async function POST(request:Request){
  try{
    const db=getSupabaseAdmin();if(!db)throw new Error("Supabase server configuration is missing");
    const company=await getSelectedBusinessCompany(db);const member=await getCurrentMember(db,company.id);if(!member)return NextResponse.json({error:"Active team access is required"},{status:401});
    const body=await request.json();const status=String(body.status||"");
    if(!["pending","cleared","cancelled"].includes(status))return NextResponse.json({error:"Invalid cheque status"},{status:400});
    if(status==="cleared"&&!body.destinationAccountId)return NextResponse.json({error:"Select where the cleared cheque amount was deposited"},{status:400});
    const {error}=await db.rpc("set_received_cheque_status",{p_voucher_id:body.chequeId,p_status:status,p_destination_account_id:status==="cleared"?body.destinationAccountId:null,p_approved_by:member.id});
    if(error)throw error;return NextResponse.json(await list());
  }catch(error:any){return NextResponse.json({error:error?.message||"Cheque update failed"},{status:500})}
}
