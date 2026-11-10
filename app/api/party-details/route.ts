import {NextResponse} from "next/server";
import {getSupabaseAdmin} from "../../../lib/supabase-server";
import {getBusinessContext} from "../../../lib/company-context";
import {requireFeature} from "../../../lib/feature-access";
import {partyDetailsInput} from "../../../lib/party-details";

export const dynamic="force-dynamic";
const editable=(role:string)=>["admin","manager","accountant"].includes(role);
const validId=(id:unknown)=>typeof id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function GET(request:Request) {
  try {
    await requireFeature("accounting");
    const db=getSupabaseAdmin();if(!db)throw new Error("Database configuration is missing");
    const {company,member}=await getBusinessContext(db);
    const id=new URL(request.url).searchParams.get("partyId");
    if(!validId(id))return NextResponse.json({error:"Select a party"},{status:400});
    const {data,error}=await db.from("parties").select("id,name,place,address,phone,tax_no,profile_revision").eq("id",id).eq("company_id",company.id).maybeSingle();
    if(error)throw error;if(!data)return NextResponse.json({error:"Party not found"},{status:404});
    return NextResponse.json({party:data,canEdit:editable(member.role)},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error:any){return NextResponse.json({error:error?.message||"Could not load party details"},{status:500});}
}

export async function PUT(request:Request) {
  try {
    await requireFeature("accounting");
    const db=getSupabaseAdmin();if(!db)throw new Error("Database configuration is missing");
    const {company,member}=await getBusinessContext(db);
    if(!editable(member.role))return NextResponse.json({error:"Only an administrator, manager or accountant can edit party details"},{status:403});
    const body=await request.json();if(!validId(body.partyId))return NextResponse.json({error:"Select a party"},{status:400});
    let input;try{input=partyDetailsInput(body);}catch(error:any){return NextResponse.json({error:error.message},{status:400});}
    const {data,error}=await db.rpc("update_party_details",{p_company_id:company.id,p_party_id:body.partyId,p_member_id:member.id,
      p_name:input.name,p_address:input.address,p_phone:input.phone,p_tax_no:input.taxNo,p_expected_revision:input.revision});
    if(error)return NextResponse.json({error:error.code==="23505"?"Another party already uses this name":error.message},{status:error.code==="23505"||/Another user changed/.test(error.message)?409:400});
    return NextResponse.json({saved:true,party:data});
  } catch(error:any){return NextResponse.json({error:error?.message||"Could not save party details"},{status:500});}
}
