import { createClient } from "@supabase/supabase-js";

const url = process.env.UNIFIED_SUPABASE_URL;
const secret = process.env.UNIFIED_SUPABASE_SECRET_KEY;
const companyId = process.argv[2];
if (!url || !secret || !companyId) {
  console.error("Usage: UNIFIED_SUPABASE_URL=... UNIFIED_SUPABASE_SECRET_KEY=... node scripts/reconcile-company.mjs <company-id>");
  process.exit(2);
}
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.rpc("company_reconciliation", { p_company_id: companyId });
if (error) throw error;
console.log(JSON.stringify(data, null, 2));
if (Number(data.journal_debit) !== Number(data.journal_credit)) {
  console.error("Journal debit and credit totals do not match.");
  process.exit(1);
}
