import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";
import { assertCompanyRecord, assertCompanyRecords } from "../../../lib/company-ownership";

export const dynamic = "force-dynamic";

async function company(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  return (await getBusinessContext(db)).company;
}

export async function GET() {
  try {
    await requireFeature("manufacturing");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Supabase configuration is missing");
    const selectedCompany = await company(db);
    const { data, error } = await db.from("production_batches")
      .select("id,batch_no,production_date,output_quantity,notes,products!production_batches_output_product_id_fkey(name,unit),production_consumptions(quantity,products(name,unit))")
      .eq("company_id", selectedCompany.id).order("production_date", { ascending: false }).limit(30);
    if (error) throw error;
    return NextResponse.json({ batches: data || [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Manufacturing error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireFeature("manufacturing");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Supabase configuration is missing");
    const selectedCompany = await company(db);
    const body = await request.json();
    const consumptionIds = Array.isArray(body.consumptions) ? body.consumptions.map((item: unknown) => typeof item === "object" && item !== null ? (item as Record<string, unknown>).product_id : null) : [];
    await Promise.all([
      assertCompanyRecord(db, "fiscal_years", body.fiscalYearId, selectedCompany.id, "Fiscal year"),
      assertCompanyRecord(db, "products", body.outputProductId, selectedCompany.id, "Output product"),
      assertCompanyRecords(db, "products", consumptionIds, selectedCompany.id, "Consumed products"),
    ]);
    const { data, error } = await db.rpc("record_production_batch", {
      p_company_id: selectedCompany.id, p_fiscal_year_id: body.fiscalYearId,
      p_date: body.date, p_output_product_id: body.outputProductId,
      p_output_quantity: Number(body.outputQuantity), p_consumptions: body.consumptions,
      p_notes: String(body.notes || ""),
    });
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record production" }, { status: 500 });
  }
}
