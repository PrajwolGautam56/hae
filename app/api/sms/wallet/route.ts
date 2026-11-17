import {NextResponse} from "next/server";
import {getSupabaseAdmin} from "../../../../lib/supabase-server";
import {getBusinessContext} from "../../../../lib/company-context";
import {requireFeature} from "../../../../lib/feature-access";
import {loadMessagingRuntime} from "../../../../lib/messaging-runtime";
import {readSmsWallet, publicSmsCreditState} from "../../../../lib/sms-credit-state";
import {clientMessageError} from "../../../../lib/client-messaging";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireFeature("accounting");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Database configuration missing");
    const {company} = await getBusinessContext(db);
    const [wallet] = await Promise.all([readSmsWallet(db, company.organization_id), loadMessagingRuntime()]);
    return NextResponse.json(publicSmsCreditState(company.id, wallet), {headers: {"Cache-Control": "private, no-store"}});
  } catch (error) {
    return NextResponse.json({error: clientMessageError(error)}, {status: 400, headers: {"Cache-Control": "private, no-store"}});
  }
}
