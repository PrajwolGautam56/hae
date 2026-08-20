import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getCurrentMember } from "../../../lib/current-member";
import { sendTeamEmail } from "../../../lib/resend-email";

export const dynamic="force-dynamic";

async function requireAdmin(){const db=getSupabaseAdmin();if(!db)throw new Error("Database configuration is missing");const member=await getCurrentMember(db);return{db,member,allowed:member?.role==="admin"}}
async function setupLink(db:NonNullable<ReturnType<typeof getSupabaseAdmin>>,email:string){const base=(process.env.CLIENT_PORTAL_URL||process.env.NEXT_PUBLIC_APP_URL||"http://localhost:3010").replace(/\/$/,"");const redirectTo=`${base}/client-reset-password`;const {data,error}=await db.auth.admin.generateLink({type:"recovery",email,options:{redirectTo}});if(error)throw error;const url=new URL(redirectTo);url.searchParams.set("token_hash",data.properties.hashed_token);url.searchParams.set("type","recovery");return url.toString()}

export async function GET(){try{const {db,member,allowed}=await requireAdmin();if(!allowed)return NextResponse.json({error:"Administrator access required"},{status:401});const {data,error}=await db.from("parties").select("id,name,place,phone,portal_email,portal_active,auth_user_id").eq("company_id",member!.company_id).order("name");if(error)throw error;return NextResponse.json({parties:data||[]})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Client access could not load"},{status:500})}}

export async function POST(request:Request){
  try{const {db,member,allowed}=await requireAdmin();if(!allowed)return NextResponse.json({error:"Administrator access required"},{status:401});const body=await request.json();const action=String(body.action||"create");const {data:party,error:partyError}=await db.from("parties").select("id,name,auth_user_id,portal_email").eq("id",body.partyId).eq("company_id",member!.company_id).single();if(partyError)throw partyError;
    if(action==="create"){
      const email=String(body.email||"").trim().toLowerCase();const password=String(body.password||"");if(!email)return NextResponse.json({error:"Customer email is required"},{status:400});if(password&&password.length<8)return NextResponse.json({error:"Initial password must be at least 8 characters"},{status:400});if(party.auth_user_id)return NextResponse.json({error:"This party already has a portal login"},{status:400});
      const temporaryPassword=password||`${crypto.randomUUID()}Aa1!${crypto.randomUUID()}`;const {data:auth,error:authError}=await db.auth.admin.createUser({email,password:temporaryPassword,email_confirm:true,user_metadata:{name:party.name,account_type:"customer"}});if(authError)throw authError;
      const {error:updateError}=await db.from("parties").update({auth_user_id:auth.user.id,portal_email:email,portal_active:true}).eq("id",party.id);if(updateError){await db.auth.admin.deleteUser(auth.user.id);throw updateError}
      if(body.sendEmail!==false){const link=await setupLink(db,email);await sendTeamEmail({to:email,subject:"Your Hamro Afno customer portal",heading:"Your customer portal is ready",message:`Hi ${party.name}, use the secure link below to set your password and view your ledger or place an order.`,actionLabel:"Set password",actionUrl:link})}
    }else if(action==="status"){const {error}=await db.from("parties").update({portal_active:Boolean(body.active)}).eq("id",party.id);if(error)throw error}
    else if(action==="reset"){if(!party.portal_email)return NextResponse.json({error:"Customer email is missing"},{status:400});const link=await setupLink(db,party.portal_email);await sendTeamEmail({to:party.portal_email,subject:"Reset your Hamro Afno customer password",heading:"Password reset",message:"Use this secure link to choose a new customer portal password.",actionLabel:"Reset password",actionUrl:link})}
    else return NextResponse.json({error:"Unsupported action"},{status:400});return NextResponse.json({success:true});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Client access update failed"},{status:500})}
}
