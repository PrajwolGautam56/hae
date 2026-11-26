import {NextResponse} from "next/server";
import {createHash} from "node:crypto";
import {getSupabaseAdmin} from "../../../../lib/supabase-server";
import {getBusinessContext} from "../../../../lib/company-context";
import {requireFeature} from "../../../../lib/feature-access";
import {allReportRows} from "../../../../lib/report-query";
import {readProductWorkbook} from "../../../../lib/product-import-file";
import {MAX_PRODUCT_IMPORT_BYTES,PRODUCT_IMPORT_TYPES,previewProductNames,newProductNameRows,type ProductImportType} from "../../../../lib/product-name-import";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
export async function POST(request: Request) {
  try{
    const origin=request.headers.get("origin");
    if(origin&&new URL(origin).origin!==new URL(request.url).origin)return NextResponse.json({error:"Cross-origin product import denied"},{status:403});
    await requireFeature("inventory");
    const db=getSupabaseAdmin();if(!db)throw new Error("Database configuration missing");
    const {company,member}=await getBusinessContext(db);
    if(!["admin","manager","accountant"].includes(member.role))return NextResponse.json({error:"Only an administrator, manager or accountant can import products"},{status:403});
    if(Number(request.headers.get("content-length")||0)>MAX_PRODUCT_IMPORT_BYTES+65536)return NextResponse.json({error:"Excel file must be 2 MB or smaller"},{status:413});
    const form=await request.formData(),file=form.get("file"),action=String(form.get("action")||""),type=String(form.get("productType")||"") as ProductImportType;
    if(form.get("companyId")!==company.id)return NextResponse.json({error:"Selected company changed. Reopen product import in the correct company."},{status:409});
    if(!PRODUCT_IMPORT_TYPES.includes(type)||!["preview","import"].includes(action))throw new Error("Select a product type and preview the worksheet first");
    if(!(file instanceof File))throw new Error("Select an Excel .xlsx file");
    const sheet=await readProductWorkbook(file);
    const existing=await allReportRows(db.from("products").select("name").eq("company_id",company.id).order("name").order("id"));
    const preview=previewProductNames(sheet,existing);
    const parsed=preview.rows.filter(row=>row.status!=="duplicate").map(row=>row.name);
    const previewHash=createHash("sha256").update(JSON.stringify({companyId:company.id,type,names:parsed})).digest("hex");
    if(action==="preview")return NextResponse.json({...preview,previewHash,company:{id:company.id,name:company.name}},{headers:{"Cache-Control":"private, no-store"}});
    if(form.get("previewHash")!==previewHash)return NextResponse.json({error:"File, company or product type changed. Preview it again before importing."},{status:409});
    const rows=newProductNameRows(company.id,type,preview.rows);
    // A single atomic INSERT; exact duplicates are DO NOTHING, never UPDATE existing stock/prices.
    // Replaying the same file after an interrupted response cannot create another identical product.
    let created=0;
    if(rows.length){
      const result=await db.from("products").upsert(rows,{onConflict:"company_id,name",ignoreDuplicates:true}).select("id");
      if(result.error)throw new Error(result.error.message);
      created=(result.data||[]).length;
    }
    return NextResponse.json({created,skipped:preview.total-created,total:preview.total,companyId:company.id,stockChanged:false},{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not import products"},{status:400});}
}
