import { createClient } from '@supabase/supabase-js';

export function getUnifiedAdmin() {
  const url = process.env.UNIFIED_SUPABASE_URL;
  const secret = process.env.UNIFIED_SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function getSupabaseAdmin() {
  const url=process.env.UNIFIED_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.UNIFIED_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret) return null;
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
}
