const keys=["SMSPASAL_API_KEY","SMSPASAL_SENDER_ID","SMSPASAL_ROUTE_ID","SMSPASAL_CAMPAIGN_ID","CRON_SECRET","OVERDUE_REMINDERS_ENABLED"] as const;
let stored:Record<string,string>={},expires=0,inflight:Promise<void>|null=null;
export function messagingValue(key:string){return process.env[key] ?? stored[key];}
/** Server-only fallback to encrypted Vault. Never return this object through a client API. */
export async function loadMessagingRuntime(){
  if(expires>Date.now())return;
  if(inflight)return inflight;
  stored={}; // Do not keep stale enabled/credential values after cache expiry on a failed refresh.
  expires=Date.now()+10000;
  inflight=(async()=>{
    const url=process.env.UNIFIED_SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret=process.env.UNIFIED_SUPABASE_SECRET_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!url||!secret)return;
    try{
      const response=await fetch(`${url}/rest/v1/rpc/get_messaging_runtime_config`,{method:"POST",cache:"no-store",signal:AbortSignal.timeout(8000),headers:{apikey:secret,Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:"{}"});
      if(!response.ok)return;
      const result=await response.json();const next:Record<string,string>={};
      for(const key of keys)if(typeof result?.[key]==="string")next[key]=result[key];
      stored=next;expires=Date.now()+300000;
    }catch{/* Missing/unavailable configuration leaves sending disabled. */}
  })();
  try{await inflight;}finally{inflight=null;}
}
