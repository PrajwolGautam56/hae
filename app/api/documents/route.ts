import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";
import { assertCompanyRecord } from "../../../lib/company-ownership";
import { commercialInput } from "../../../lib/commercial-documents";

export const dynamic = "force-dynamic";
async function context(fy: string) {
  await requireFeature("sales");
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase is not configured");
  const { company, member } = await getBusinessContext(db);
  await assertCompanyRecord(db, "fiscal_years", fy, company.id, "Fiscal year");
  return { db, company, member };
}
function failure(error: unknown) {
  const message = (error as { message?: string })?.message || "Document could not be saved";
  return NextResponse.json({ error: /commercial_document.*(schema cache|does not exist)|issue_commercial_document/i.test(message) ? "Document storage is not enabled yet. Apply migration 202609260001 before using this feature." : message }, { status: 400 });
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const fy = url.searchParams.get("fy") || "";
    const { db, company } = await context(fy);
    const id = url.searchParams.get("id");
    if (id) {
      const { data, error } = await db.from("commercial_documents").select("*").eq("id", id).eq("company_id", company.id).eq("fiscal_year_id", fy).single();
      if (error) throw error;
      return NextResponse.json({ document: data });
    }
    const page = Math.max(0, Math.min(100000, Math.floor(Number(url.searchParams.get("page")) || 0)));
    const type = url.searchParams.get("type") === "proforma" ? "proforma" : "quotation";
    const [documents, sequences] = await Promise.all([
      db.from("commercial_documents").select("id,document_type,sequence_no,document_date,recipient_name,total,status,created_at", { count: "exact" }).eq("company_id", company.id).eq("fiscal_year_id", fy).eq("document_type", type).order("sequence_no", { ascending: false }).range(page * 25, page * 25 + 24),
      db.from("commercial_document_sequences").select("document_type,last_number").eq("company_id", company.id).eq("fiscal_year_id", fy),
    ]);
    if (documents.error || sequences.error) throw documents.error || sequences.error;
    return NextResponse.json({ company, documents: documents.data, total: documents.count, lastNumber: sequences.data?.find(s => s.document_type === type)?.last_number || 0 });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = commercialInput(body);
    const { db, company, member } = await context(String(body.fiscalYearId || ""));
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId || "")) throw new Error("A valid request ID is required");
    const { data, error } = await db.rpc("issue_commercial_document", { p_company_id: company.id, p_fiscal_year_id: body.fiscalYearId, p_actor_id: member.id, p_request_id: body.requestId, p_input: input });
    if (error) throw error;
    return NextResponse.json({ document: data }, { status: 201 });
  } catch (e) { return failure(e); }
}
