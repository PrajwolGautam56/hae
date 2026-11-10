import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";
import { loadSalesRegister, salesRegisterOptions } from "../../../lib/sales-register";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFeature("sales");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Supabase server configuration is missing");
    const { company } = await getBusinessContext(db);
    const params = new URL(request.url).searchParams;
    let options;
    try { options = salesRegisterOptions(params); }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
    const fiscalYearId = params.get("fy");
    if (!fiscalYearId) return NextResponse.json({ error: "Select a fiscal year" }, { status: 400 });
    const { data: year, error } = await db.from("fiscal_years").select("id").eq("company_id", company.id).eq("id", fiscalYearId).maybeSingle();
    if (error) throw error;
    if (!year) return NextResponse.json({ error: "Fiscal year not found in this company" }, { status: 404 });
    return NextResponse.json(await loadSalesRegister(db, company.id, year.id, options), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error)?.message || "Sales register could not load" }, { status: 500 });
  }
}
