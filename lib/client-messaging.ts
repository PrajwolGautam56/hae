/** Client responses must never disclose wholesale pricing, provider names, IDs or configuration. */
export function clientWallet(wallet: any) {
  return { balance: Number(wallet?.balance || 0), held: Number(wallet?.held || 0), spent: Number(wallet?.spent || 0), enabled: Boolean(wallet?.enabled) };
}
export function clientDelivery(delivery: any) {
  const details: Record<string,string> = { accepted: "Message accepted for sending; delivery is not yet confirmed.", failed: "Message was not accepted. Reserved SMS credits have been returned.", reserved: "Send confirmation is pending. Do not send again; contact your administrator.", unknown: "Send outcome needs review. Do not resend until your administrator checks it." };
  return { id: delivery.id, party_id: delivery.party_id, channel: delivery.channel, status: delivery.status, recipient: delivery.recipient, message: delivery.message, credits: delivery.credits, automatic: delivery.automatic, created_at: delivery.created_at, completed_at: delivery.completed_at, purpose: delivery.purpose || "overdue", detail: delivery.status==="failed"&&delivery.channel==="email"?"Email was not accepted. No SMS credits were used.":details[delivery.status] || "Contact your administrator for the message status." };
}
export function clientAvailability(state: {ready:boolean}) {
  return { ready: state.ready, reason: state.ready ? "" : "Messaging is not active yet. Contact your administrator." };
}
export function clientMessageError(error: any) {
  const message=String(error?.message || "");
  if(/provider|sms\s*pasal|resend|api key|route id|sender id|configuration|database|supabase|schema cache|does not exist|billing/i.test(message))return "Messaging is not ready. Contact your administrator.";
  return message || "Message could not be sent. Contact your administrator.";
}
export function manualMessage(company:any,party:any,value:unknown) {
  if(typeof value!=="string" || !value.trim())throw new Error("Write your message first");
  const body=value.trim();
  if(body.length>720)throw new Error("Keep the full message within 720 characters");
  const message=`${body}\nFrom ${String(company.name).replace(/[\r\n\t]+/g," ").trim()}`;
  if(message.length>720)throw new Error("Message plus company name must fit within 720 characters");
  return {companyId:company.id,partyId:party.id,phone:party.phone||"",email:party.email||"",message,purpose:"manual",asOf:new Date().toISOString().slice(0,10)};
}
