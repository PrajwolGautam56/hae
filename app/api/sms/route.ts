import {NextResponse} from "next/server";
import {getSupabaseAdmin} from "../../../lib/supabase-server";
import {getBusinessContext} from "../../../lib/company-context";
import {requireFeature} from "../../../lib/feature-access";
import {allReportRows} from "../../../lib/report-query";
import {manualMessage,clientWallet,clientAvailability,clientDelivery,clientMessageError} from "../../../lib/client-messaging";
import {reminderPreview,deliverOverdueReminder} from "../../../lib/overdue-reminder-service";
import {reminderProviderReady} from "../../../lib/overdue-reminder-provider";
import {smsPhone} from "../../../lib/overdue-reminder-model";
import {loadMessagingRuntime} from "../../../lib/messaging-runtime";
const validId=(value:unknown)=>typeof value==="string"&&/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
export const dynamic="force-dynamic";
async function context(){
  await requireFeature("accounting");const db=getSupabaseAdmin();if(!db)throw new Error("Database configuration missing");
  const {company,member}=await getBusinessContext(db);if(!["admin","manager","accountant"].includes(member.role))throw new Error("Only an administrator, manager or accountant can send messages");
  await loadMessagingRuntime();
  const result=await db.from("sms_credit_wallets").select("balance,held,spent,enabled,credits_per_segment").eq("tenant_id",company.organization_id).maybeSingle();if(result.error)throw result.error;
  return {db,company,member,wallet:result.data||{balance:0,held:0,spent:0,enabled:false,credits_per_segment:null}};
}
export async function GET(){try{const {db,company,wallet}=await context();const parties=await allReportRows(db.from("parties").select("id,name,phone").eq("company_id",company.id).order("name").order("id"));return NextResponse.json({company:{name:company.name},parties,wallet:clientWallet(wallet),service:clientAvailability(reminderProviderReady("sms"))},{headers:{"Cache-Control":"private, no-store"}});}catch(error){return NextResponse.json({error:clientMessageError(error)},{status:400});}}
export async function POST(request:Request){try{
  const origin=request.headers.get("origin");if(origin&&new URL(origin).origin!==new URL(request.url).origin)return NextResponse.json({error:"Cross-origin message request denied"},{status:403});
  const {db,company,member,wallet}=await context();const body=await request.json();
  if(!validId(body.partyId)||!["preview","send"].includes(body.action))throw new Error("Select a party and write a message");
  if(body.action==="send"){
    if(!validId(body.requestId)||!/^[a-f0-9]{64}$/.test(body.previewHash||""))throw new Error("Review a current message preview before sending");
    const prior=await db.from("overdue_reminder_deliveries").select("id,party_id,channel,status,credits,purpose").eq("company_id",company.id).eq("request_id",body.requestId).maybeSingle();if(prior.error)throw prior.error;
    if(prior.data){if(prior.data.party_id!==body.partyId||prior.data.purpose!=="manual")throw new Error("Request ID belongs to another message");return NextResponse.json({delivery:clientDelivery(prior.data),duplicate:true});}
  }
  const party=await db.from("parties").select("id,name,phone,email").eq("company_id",company.id).eq("id",body.partyId).maybeSingle();if(party.error)throw party.error;if(!party.data)throw new Error("Party does not belong to this company");
  smsPhone(party.data.phone||"");
  const row=manualMessage(company,party.data,body.message),preview=reminderPreview(row,wallet);
  if(body.action==="preview")return NextResponse.json({message:row.message,credits:preview.estimate.credits,previewHash:preview.previewHash},{headers:{"Cache-Control":"private, no-store"}});
  const delivery=await deliverOverdueReminder(db,company,row,wallet,{channel:"sms",requestId:body.requestId,actorId:member.id,automatic:false,previewHash:body.previewHash,expectedCredits:body.expectedCredits});
  return NextResponse.json({delivery:clientDelivery(delivery)});
}catch(error){return NextResponse.json({error:clientMessageError(error)},{status:409});}}
