import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";
import { openingBalanceInput } from "../../../lib/party-opening";

export const dynamic = "force-dynamic";
const canEdit = (role: string) => ["admin", "manager", "accountant"].includes(role);
const validId = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function GET(request: Request) {
  try {
    await requireFeature("accounting");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Database configuration is missing");
    const { company, member } = await getBusinessContext(db);
    const q = new URL(request.url).searchParams;
    if (!validId(q.get("partyId")) || !validId(q.get("fiscalYearId"))) return NextResponse.json({error:"Select a party and fiscal year"},{status:400});
    const {data,error} = await db.rpc("get_party_opening_balance",{p_company_id:company.id,p_fiscal_year_id:q.get("fiscalYearId"),p_party_id:q.get("partyId")});
    if (error) throw error;
    return NextResponse.json({...data,canEdit:canEdit(member.role)},{headers:{"Cache-Control":"private, no-store"}});
  } catch (error: any) { return NextResponse.json({error:error?.message || "Could not load opening balance"},{status:500}); }
}

export async function PUT(request: Request) {
  try {
    await requireFeature("accounting");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Database configuration is missing");
    const {company,member} = await getBusinessContext(db);
    if (!canEdit(member.role)) return NextResponse.json({error:"Only an administrator, manager or accountant can change opening balances"},{status:403});
    const body = await request.json();
    if (!validId(body.partyId) || !validId(body.fiscalYearId)) return NextResponse.json({error:"Select a party and fiscal year"},{status:400});
    let input;
    try { input = openingBalanceInput(body); } catch (error: any) { return NextResponse.json({error:error.message},{status:400}); }
    const {data,error} = await db.rpc("set_party_opening_balance",{
      p_company_id:company.id,p_fiscal_year_id:body.fiscalYearId,p_party_id:body.partyId,
      p_member_id:member.id,p_amount:input.amount,p_source:input.source,p_note:input.note,p_expected_revision:input.revision,
    });
    if (error) return NextResponse.json({error:error.message},{status:/Another user changed/.test(error.message)?409:400});
    return NextResponse.json({saved:true,opening:data});
  } catch (error: any) { return NextResponse.json({error:error?.message || "Could not save opening balance"},{status:500}); }
}
