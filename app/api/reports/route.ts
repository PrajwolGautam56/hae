import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Supabase server configuration is missing");
    const q = new URL(request.url).searchParams;
    const partyId = q.get("partyId");
    const fiscalYearId = q.get("fiscalYearId");
    const reportType = q.get("type") || "daybook";
    const accountId = q.get("accountId");
    const from = q.get("from");
    const to = q.get("to");

    const { data: companies, error: companyError } = await db.from("companies").select("id,name").order("created_at").limit(1);
    if (companyError || !companies?.[0]) throw companyError || new Error("Company not found");
    const company = companies[0];
    let fyQuery = db.from("fiscal_years").select("*").eq("company_id", company.id);
    if (fiscalYearId) fyQuery = fyQuery.eq("id", fiscalYearId);
    const { data: years, error: fyError } = await fyQuery.order("start_ad", { ascending: false }).limit(1);
    if (fyError || !years?.[0]) throw fyError || new Error("Fiscal year not found");
    const fy = years[0];
    const dateFrom = from || fy.start_ad;
    const dateTo = to || fy.end_ad;
    if (dateFrom > dateTo) return NextResponse.json({ error: "From date must be before To date" }, { status: 400 });

    if (reportType === "trial_balance" || reportType === "general_ledger") {
      const { data: accounts, error: accountsError } = await db.from("accounts").select("id,code,name,account_type,normal_side").eq("company_id", company.id).eq("active", true).order("code");
      if (accountsError) throw accountsError;
      let linesQuery = db.from("journal_lines").select("id,account_id,party_id,description,debit,credit,accounts(code,name,account_type),journal_entries!inner(id,entry_date,reference,description,fiscal_year_id)").eq("company_id", company.id).eq("journal_entries.fiscal_year_id", fy.id).gte("journal_entries.entry_date", dateFrom).lte("journal_entries.entry_date", dateTo);
      if (accountId) linesQuery = linesQuery.eq("account_id", accountId);
      const { data: periodLines, error: linesError } = await linesQuery;
      if (linesError) throw linesError;
      const { data: earlier, error: earlierError } = await db.from("journal_lines").select("account_id,debit,credit,journal_entries!inner(entry_date,fiscal_year_id)").eq("company_id", company.id).eq("journal_entries.fiscal_year_id", fy.id).gte("journal_entries.entry_date", fy.start_ad).lt("journal_entries.entry_date", dateFrom);
      if (earlierError) throw earlierError;
      const opening = new Map<string,number>();
      for (const x of earlier || []) opening.set(x.account_id, (opening.get(x.account_id) || 0) + Number(x.debit) - Number(x.credit));

      if (reportType === "trial_balance") {
        const period = new Map<string,{debit:number;credit:number}>();
        for (const x of periodLines || []) { const p=period.get(x.account_id)||{debit:0,credit:0};p.debit+=Number(x.debit);p.credit+=Number(x.credit);period.set(x.account_id,p); }
        const rows=(accounts || []).map((a:any)=>{const op=opening.get(a.id)||0;const p=period.get(a.id)||{debit:0,credit:0};const close=op+p.debit-p.credit;return {id:a.id,code:a.code,name:a.name,accountType:a.account_type,openingDebit:Math.max(op,0),openingCredit:Math.max(-op,0),debit:p.debit,credit:p.credit,closingDebit:Math.max(close,0),closingCredit:Math.max(-close,0)}}).filter((x:any)=>x.openingDebit||x.openingCredit||x.debit||x.credit);
        const totals=rows.reduce((s:any,x:any)=>({openingDebit:s.openingDebit+x.openingDebit,openingCredit:s.openingCredit+x.openingCredit,debit:s.debit+x.debit,credit:s.credit+x.credit,closingDebit:s.closingDebit+x.closingDebit,closingCredit:s.closingCredit+x.closingCredit}),{openingDebit:0,openingCredit:0,debit:0,credit:0,closingDebit:0,closingCredit:0});
        return NextResponse.json({company,fiscalYear:fy,from:dateFrom,to:dateTo,reportType,accounts,totals,rows,balanced:Math.abs(totals.closingDebit-totals.closingCredit)<0.01});
      }

      let running=accountId ? (opening.get(accountId)||0) : 0;
      const rows=(periodLines || []).sort((a:any,b:any)=>String(a.journal_entries.entry_date).localeCompare(String(b.journal_entries.entry_date))).map((x:any)=>{running+=Number(x.debit)-Number(x.credit);return {id:x.id,date:x.journal_entries.entry_date,ref:x.journal_entries.reference,accountId:x.account_id,accountCode:x.accounts?.code,accountName:x.accounts?.name,particulars:x.description||x.journal_entries.description||"—",debit:Number(x.debit),credit:Number(x.credit),balance:accountId?running:null}});
      const totals=rows.reduce((s:any,x:any)=>({debit:s.debit+x.debit,credit:s.credit+x.credit}),{debit:0,credit:0});
      return NextResponse.json({company,fiscalYear:fy,from:dateFrom,to:dateTo,reportType,accounts,opening:accountId?(opening.get(accountId)||0):null,closing:accountId?running:null,totals,rows});
    }

    let voucherQuery = db.from("vouchers").select("id,voucher_no,voucher_type,voucher_date,narration,payment_mode,subtotal,discount_amount,tax_amount,total,party_id,parties(name),ledger_entries(debit,credit,account_name)").eq("company_id", company.id).eq("fiscal_year_id", fy.id).gte("voucher_date", dateFrom).lte("voucher_date", dateTo).order("voucher_date").order("created_at");
    if (partyId) voucherQuery = voucherQuery.eq("party_id", partyId);
    const voucherReportTypes:Record<string,string>={sales:"sale",purchases:"purchase",payments:"receipt",expenses:"expense"};
    if (voucherReportTypes[reportType]) voucherQuery = voucherQuery.eq("voucher_type", voucherReportTypes[reportType]);
    const { data: vouchers, error: voucherError } = await voucherQuery;
    if (voucherError) throw voucherError;

    let opening = 0;
    let party = null;
    if (partyId) {
      const [{ data: partyRow, error: partyError }, { data: openingRow, error: openingError }, { data: earlier, error: earlierError }] = await Promise.all([
        db.from("parties").select("id,name,place,phone,tax_no,opening_balance").eq("id", partyId).single(),
        db.from("party_opening_balances").select("amount").eq("fiscal_year_id", fy.id).eq("party_id", partyId).maybeSingle(),
        db.from("ledger_entries").select("debit,credit,vouchers!inner(fiscal_year_id)").eq("party_id", partyId).eq("vouchers.fiscal_year_id", fy.id).gte("entry_date", fy.start_ad).lt("entry_date", dateFrom),
      ]);
      if (partyError || openingError || earlierError) throw partyError || openingError || earlierError;
      party = partyRow;
      opening = Number(openingRow?.amount ?? partyRow.opening_balance) + (earlier || []).reduce((s, x) => s + Number(x.debit) - Number(x.credit), 0);
    }

    let running = opening;
    const rows = (vouchers || []).map((v: any) => {
      const debit = (v.ledger_entries || []).reduce((s: number, x: any) => s + Number(x.debit), 0);
      const credit = (v.ledger_entries || []).reduce((s: number, x: any) => s + Number(x.credit), 0);
      if (partyId) running += debit - credit;
      return { id: v.id, ref: v.voucher_no, type: v.voucher_type, date: v.voucher_date, party: v.parties?.name || "Cash / Office", particulars: v.narration || "—", paymentMode: v.payment_mode, subtotal: Number(v.subtotal), discount: Number(v.discount_amount), tax: Number(v.tax_amount), amount: Number(v.total), debit, credit, balance: partyId ? running : null };
    });
    const totals = rows.reduce((s, x) => ({ debit: s.debit + x.debit, credit: s.credit + x.credit, sales: s.sales + (x.type === "sale" ? x.amount : 0), purchases: s.purchases + (x.type === "purchase" ? x.amount : 0), receipts: s.receipts + (x.type === "receipt" ? x.amount : 0), expenses: s.expenses + (x.type === "expense" ? x.amount : 0) }), { debit: 0, credit: 0, sales: 0, purchases: 0, receipts: 0, expenses: 0 });
    return NextResponse.json({ company, fiscalYear: fy, party, from: dateFrom, to: dateTo, reportType, opening, closing: partyId ? running : null, totals, rows });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Report database error" }, { status: 500 });
  }
}
