import{NextResponse}from"next/server";
import{getSupabaseAdmin}from"../../../../lib/supabase-server";
import{getBusinessContext}from"../../../../lib/company-context";
import{requireFeature}from"../../../../lib/feature-access";
import{manualStockInput}from"../../../../lib/manual-stock";
export const dynamic="force-dynamic";
const allowed=(role:string)=>["admin","manager","accountant"].includes(role);
async function context(){await requireFeature("inventory");await requireFeature("accounting");const db=getSupabaseAdmin();if(!db)throw new Error("Database configuration missing");const{company,member}=await getBusinessContext(db);return{db,company,member};}
const setupError=(error:any)=>/manual_stock_requests|record_manual_stock_adjustment/.test(String(error?.message||""))&&/schema cache|does not exist|could not find/i.test(String(error?.message||""));
export async function GET(request:Request){try{
 const{db,company,member}=await context();if(!allowed(member.role))return NextResponse.json({error:"Only an administrator, manager or accountant can manage manual stock"},{status:403});
 const id=new URL(request.url).searchParams.get("productId")||"";
 const product=await db.from("products").select("id,name,stock_qty,purchase_price,unit,active").eq("company_id",company.id).eq("id",id).maybeSingle();if(product.error)throw product.error;if(!product.data)throw new Error("Product not found in this company");
 const history=await db.from("manual_stock_requests").select("request_id,result,created_at,actor:team_members!manual_stock_requests_company_actor_fkey(name)").eq("company_id",company.id).eq("product_id",id).order("created_at",{ascending:false}).limit(20);
 if(history.error&&!setupError(history.error))throw history.error;
 return NextResponse.json({companyId:company.id,product:product.data,history:history.data||[],setupRequired:Boolean(history.error)},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error:any){return NextResponse.json({error:error.message||"Could not load manual stock"},{status:400});}}
export async function POST(request:Request){let attempted=false;try{
 const origin=request.headers.get("origin");if(origin&&new URL(origin).origin!==new URL(request.url).origin)return NextResponse.json({error:"Cross-origin stock request denied"},{status:403});
 const{db,company,member}=await context();if(!allowed(member.role))return NextResponse.json({error:"Only an administrator, manager or accountant can adjust stock"},{status:403});
 const body=await request.json();if(body.companyId!==company.id)return NextResponse.json({error:"Company changed. Reopen the correct product before adjusting stock.",outcome:"not_applied"},{status:409});
 const input=manualStockInput(body);
 attempted=true;
 const{data,error}=await db.rpc("record_manual_stock_adjustment",{p_company_id:company.id,p_fiscal_year_id:input.fiscalYearId,p_product_id:input.productId,p_actor_id:member.id,p_request_id:input.requestId,p_date:input.date,p_mode:input.mode,p_quantity:input.quantity,p_expected_stock:input.expectedStock,p_expected_cost:input.expectedCost,p_reason:input.reason});
 if(error){if(setupError(error))return NextResponse.json({error:"Manual stock is awaiting the approved database migration. No stock was changed.",setupRequired:true,outcome:"not_applied"},{status:503});if(/^(P0001|22|23|42)/.test(error.code||""))return NextResponse.json({error:error.message,outcome:"not_applied",databaseRejected:true},{status:409});throw error;}
 return NextResponse.json({saved:true,result:data},{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(error:any){return NextResponse.json({error:error.message||"Stock adjustment failed",outcome:attempted?"uncertain":"not_applied"},{status:attempted?503:409});}}
