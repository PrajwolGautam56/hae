import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { getBusinessContext } from "../../../lib/company-context";
import { requireFeature } from "../../../lib/feature-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFeature("reports");
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Supabase server configuration is missing");
    const q = new URL(request.url).searchParams;
    const partyId = q.get("partyId");
    const fiscalYearId = q.get("fiscalYearId");
    const reportType = q.get("type") || "daybook";
    const accountId = q.get("accountId");
    const from = q.get("from");
    const to = q.get("to");

    const { company } = await getBusinessContext(db);
    let fyQuery = db.from("fiscal_years").select("*").eq("company_id", company.id);
    if (fiscalYearId) fyQuery = fyQuery.eq("id", fiscalYearId);
    const { data: years, error: fyError } = await fyQuery.order("start_ad", { ascending: false }).limit(1);
    if (fyError || !years?.[0]) throw fyError || new Error("Fiscal year not found");
    const fy = years[0];
    const dateFrom = from || fy.start_ad;
    const dateTo = to || fy.end_ad;
    if (dateFrom > dateTo) return NextResponse.json({ error: "From date must be before To date" }, { status: 400 });

    if (["balance_sheet", "profit_loss", "group_summary"].includes(reportType)) {
      const { data: accounts, error: accountsError } = await db.from("accounts")
        .select("id,code,name,account_type,normal_side,system_key").eq("company_id", company.id).eq("active", true).order("code");
      if (accountsError) throw accountsError;
      let lineQuery = db.from("journal_lines")
        .select("account_id,debit,credit,journal_entries!journal_line_company_entry_fkey!inner(entry_date,fiscal_year_id)")
        .eq("company_id", company.id).eq("journal_entries.fiscal_year_id", fy.id)
        .lte("journal_entries.entry_date", dateTo);
      if (reportType !== "balance_sheet") lineQuery = lineQuery.gte("journal_entries.entry_date", dateFrom);
      else lineQuery = lineQuery.gte("journal_entries.entry_date", fy.start_ad);
      const { data: lines, error: linesError } = await lineQuery;
      if (linesError) throw linesError;
      const movement = new Map<string, { debit: number; credit: number }>();
      for (const line of lines || []) {
        const value = movement.get(line.account_id) || { debit: 0, credit: 0 };
        value.debit += Number(line.debit); value.credit += Number(line.credit); movement.set(line.account_id, value);
      }
      if (reportType === "balance_sheet") {
        const { data: openingRows, error: openingError } = await db.from("party_opening_balances")
          .select("amount").eq("fiscal_year_id", fy.id);
        if (openingError) throw openingError;
        const receivable = (openingRows || []).reduce((sum, row) => sum + Math.max(0, Number(row.amount)), 0);
        const payable = (openingRows || []).reduce((sum, row) => sum + Math.max(0, -Number(row.amount)), 0);
        const applyOpening = (key: string, debit: number, credit: number) => {
          const account = accounts?.find((row) => row.system_key === key); if (!account) return;
          const value = movement.get(account.id) || { debit: 0, credit: 0 };
          value.debit += debit; value.credit += credit; movement.set(account.id, value);
        };
        applyOpening("accounts_receivable", receivable, 0);
        applyOpening("accounts_payable", 0, payable);
        applyOpening("opening_equity", payable, receivable);
      }
      const allRows = (accounts || []).map((account) => {
        const value = movement.get(account.id) || { debit: 0, credit: 0 };
        const balance = account.normal_side === "debit" ? value.debit - value.credit : value.credit - value.debit;
        return { ...account, debit: value.debit, credit: value.credit, balance };
      }).filter((row) => Math.abs(row.balance) > 0.004 || row.debit || row.credit);
      if (reportType === "profit_loss") {
        const rows = allRows.filter((row) => ["income", "expense"].includes(row.account_type));
        const income = rows.filter((row) => row.account_type === "income").reduce((sum, row) => sum + row.balance, 0);
        const expenses = rows.filter((row) => row.account_type === "expense").reduce((sum, row) => sum + row.balance, 0);
        return NextResponse.json({ company, fiscalYear: fy, from: dateFrom, to: dateTo, reportType, rows, totals: { income, expenses, netProfit: income - expenses } });
      }
      if (reportType === "balance_sheet") {
        const rows = allRows.filter((row) => ["asset", "liability", "equity"].includes(row.account_type));
        const assets = rows.filter((row) => row.account_type === "asset").reduce((sum, row) => sum + row.balance, 0);
        const liabilities = rows.filter((row) => row.account_type === "liability").reduce((sum, row) => sum + row.balance, 0);
        const equity = rows.filter((row) => row.account_type === "equity").reduce((sum, row) => sum + row.balance, 0);
        const retainedEarnings = allRows.filter((row) => ["income", "expense"].includes(row.account_type))
          .reduce((sum, row) => sum + (row.account_type === "income" ? row.balance : -row.balance), 0);
        return NextResponse.json({ company, fiscalYear: fy, from: fy.start_ad, to: dateTo, reportType, rows, totals: { assets, liabilities, equity, retainedEarnings, liabilitiesAndEquity: liabilities + equity + retainedEarnings } });
      }
      const groups = ["asset", "liability", "equity", "income", "expense"].map((type) => ({
        type, rows: allRows.filter((row) => row.account_type === type),
        total: allRows.filter((row) => row.account_type === type).reduce((sum, row) => sum + row.balance, 0),
      }));
      return NextResponse.json({ company, fiscalYear: fy, from: dateFrom, to: dateTo, reportType, rows: allRows, groups });
    }

    if (reportType === "aging_receivable" || reportType === "aging_payable") {
      const [partyResult, openingResult, voucherResult] = await Promise.all([
        db.from("parties").select("id,name,place,phone,party_type,opening_balance").eq("company_id", company.id).order("name"),
        db.from("party_opening_balances").select("party_id,amount").eq("fiscal_year_id", fy.id),
        db.from("vouchers").select("id,party_id,voucher_type,voucher_date,due_date,total,payment_mode,cheque_status")
          .eq("company_id", company.id).eq("fiscal_year_id", fy.id).lte("voucher_date", dateTo)
          .order("voucher_date").order("created_at"),
      ]);
      if (partyResult.error || openingResult.error || voucherResult.error) throw partyResult.error || openingResult.error || voucherResult.error;
      const openingByParty = new Map((openingResult.data || []).map((row) => [row.party_id, Number(row.amount)]));
      const endTime = Date.parse(`${dateTo}T12:00:00Z`);
      const rows = (partyResult.data || []).map((party) => {
        const payable = reportType === "aging_payable";
        const opening = openingByParty.get(party.id) ?? Number(party.opening_balance);
        const obligations: { date: string; reference: string; remaining: number }[] = [];
        let settlements = 0;
        if ((!payable && opening > 0) || (payable && opening < 0)) obligations.push({ date: fy.start_ad, reference: "Opening", remaining: Math.abs(opening) });
        if ((!payable && opening < 0) || (payable && opening > 0)) settlements += Math.abs(opening);
        for (const voucher of (voucherResult.data || []).filter((item) => item.party_id === party.id)) {
          if (voucher.voucher_type === (payable ? "purchase" : "sale")) obligations.push({ date: voucher.due_date || voucher.voucher_date, reference: voucher.id, remaining: Number(voucher.total) });
          if (voucher.voucher_type === (payable ? "purchase_return" : "sale_return")) settlements += Number(voucher.total);
          if (!payable && voucher.voucher_type === "receipt" && !(voucher.payment_mode === "Cheque" && voucher.cheque_status === "cancelled")) settlements += Number(voucher.total);
          if (payable && voucher.voucher_type === "payment") settlements += Number(voucher.total);
        }
        for (const obligation of obligations) {
          const applied = Math.min(obligation.remaining, settlements); obligation.remaining -= applied; settlements -= applied;
        }
        const buckets = { current: 0, days31to60: 0, days61to90: 0, above90: 0 };
        for (const obligation of obligations.filter((item) => item.remaining > 0.004)) {
          const age = Math.max(0, Math.floor((endTime - Date.parse(`${obligation.date}T12:00:00Z`)) / 86400000));
          if (age <= 30) buckets.current += obligation.remaining;
          else if (age <= 60) buckets.days31to60 += obligation.remaining;
          else if (age <= 90) buckets.days61to90 += obligation.remaining;
          else buckets.above90 += obligation.remaining;
        }
        return { id: party.id, party: party.name, place: party.place, phone: party.phone, ...buckets,
          total: buckets.current + buckets.days31to60 + buckets.days61to90 + buckets.above90 };
      }).filter((row) => row.total > 0.004).sort((a, b) => b.total - a.total);
      const totals = rows.reduce((sum, row) => ({ current: sum.current + row.current, days31to60: sum.days31to60 + row.days31to60,
        days61to90: sum.days61to90 + row.days61to90, above90: sum.above90 + row.above90, total: sum.total + row.total }),
      { current: 0, days31to60: 0, days61to90: 0, above90: 0, total: 0 });
      return NextResponse.json({ company, fiscalYear: fy, from: fy.start_ad, to: dateTo, reportType, rows, totals, allocation: "FIFO" });
    }

    if (reportType === "stock_statement" || reportType === "stock_movement") {
      const [productsResult, periodResult, futureResult] = await Promise.all([
        db.from("products").select("id,sku,name,unit,item_type,stock_qty,purchase_price,sale_price").eq("company_id", company.id).eq("active", true).order("name"),
        db.from("stock_movements").select("id,product_id,movement_date,quantity,movement_type,unit_cost,notes,vouchers!stock_company_voucher_fkey(voucher_no,voucher_type)")
          .eq("company_id", company.id).gte("movement_date", dateFrom).lte("movement_date", dateTo).order("movement_date").order("created_at"),
        db.from("stock_movements").select("product_id,quantity").eq("company_id", company.id).gt("movement_date", dateTo),
      ]);
      if (productsResult.error || periodResult.error || futureResult.error) throw productsResult.error || periodResult.error || futureResult.error;
      const future = new Map<string, number>();
      for (const move of futureResult.data || []) future.set(move.product_id, (future.get(move.product_id) || 0) + Number(move.quantity));
      const period = new Map<string, { inward: number; outward: number; net: number }>();
      for (const move of periodResult.data || []) {
        const quantity = Number(move.quantity); const value = period.get(move.product_id) || { inward: 0, outward: 0, net: 0 };
        if (quantity >= 0) value.inward += quantity; else value.outward += Math.abs(quantity); value.net += quantity; period.set(move.product_id, value);
      }
      if (reportType === "stock_movement") {
        const productMap = new Map((productsResult.data || []).map((product) => [product.id, product]));
        const rows = (periodResult.data || []).map((move) => ({ ...move, product: productMap.get(move.product_id), quantity: Number(move.quantity), unitCost: Number(move.unit_cost || 0), reference: (move.vouchers as any)?.voucher_no || "—", voucherType: (move.vouchers as any)?.voucher_type || move.movement_type }));
        return NextResponse.json({ company, fiscalYear: fy, from: dateFrom, to: dateTo, reportType, rows });
      }
      const rows = (productsResult.data || []).map((product) => {
        const activity = period.get(product.id) || { inward: 0, outward: 0, net: 0 };
        const closing = Number(product.stock_qty) - (future.get(product.id) || 0);
        const opening = closing - activity.net;
        return { ...product, opening, inward: activity.inward, outward: activity.outward, closing, stockValue: closing * Number(product.purchase_price) };
      });
      const totals = rows.reduce((sum, row) => ({ opening: sum.opening + row.opening, inward: sum.inward + row.inward,
        outward: sum.outward + row.outward, closing: sum.closing + row.closing, stockValue: sum.stockValue + row.stockValue }),
      { opening: 0, inward: 0, outward: 0, closing: 0, stockValue: 0 });
      return NextResponse.json({ company, fiscalYear: fy, from: dateFrom, to: dateTo, reportType, rows, totals });
    }

    if (reportType === "tax_summary") {
      const { data: vouchers, error } = await db.from("vouchers")
        .select("voucher_type,subtotal,discount_amount,tax_amount,total").eq("company_id", company.id)
        .eq("fiscal_year_id", fy.id).gte("voucher_date", dateFrom).lte("voucher_date", dateTo)
        .in("voucher_type", ["sale", "sale_return", "purchase", "purchase_return"]);
      if (error) throw error;
      const totalFor = (types: string[]) => (vouchers || []).filter((voucher) => types.includes(voucher.voucher_type)).reduce((sum, voucher) => ({
        taxable: sum.taxable + Number(voucher.subtotal) - Number(voucher.discount_amount), tax: sum.tax + Number(voucher.tax_amount), total: sum.total + Number(voucher.total),
      }), { taxable: 0, tax: 0, total: 0 });
      const sales = totalFor(["sale"]); const salesReturns = totalFor(["sale_return"]);
      const purchases = totalFor(["purchase"]); const purchaseReturns = totalFor(["purchase_return"]);
      return NextResponse.json({ company, fiscalYear: fy, from: dateFrom, to: dateTo, reportType,
        rows: [
          { label: "Sales", ...sales }, { label: "Less: Sales returns", ...salesReturns },
          { label: "Purchases", ...purchases }, { label: "Less: Purchase returns", ...purchaseReturns },
        ], totals: { outputTax: sales.tax - salesReturns.tax, inputTax: purchases.tax - purchaseReturns.tax,
          netTaxPayable: sales.tax - salesReturns.tax - (purchases.tax - purchaseReturns.tax) } });
    }

    if (reportType === "trial_balance" || reportType === "general_ledger") {
      const { data: accounts, error: accountsError } = await db.from("accounts").select("id,code,name,account_type,normal_side,system_key").eq("company_id", company.id).eq("active", true).order("code");
      if (accountsError) throw accountsError;
      let linesQuery = db.from("journal_lines").select("id,account_id,party_id,description,debit,credit,accounts!journal_line_company_account_fkey(code,name,account_type),journal_entries!journal_line_company_entry_fkey!inner(id,entry_date,reference,description,fiscal_year_id)").eq("company_id", company.id).eq("journal_entries.fiscal_year_id", fy.id).gte("journal_entries.entry_date", dateFrom).lte("journal_entries.entry_date", dateTo);
      if (accountId) linesQuery = linesQuery.eq("account_id", accountId);
      const { data: periodLines, error: linesError } = await linesQuery;
      if (linesError) throw linesError;
      const { data: earlier, error: earlierError } = await db.from("journal_lines").select("account_id,debit,credit,journal_entries!journal_line_company_entry_fkey!inner(entry_date,fiscal_year_id)").eq("company_id", company.id).eq("journal_entries.fiscal_year_id", fy.id).gte("journal_entries.entry_date", fy.start_ad).lt("journal_entries.entry_date", dateFrom);
      if (earlierError) throw earlierError;
      const opening = new Map<string,number>();
      for (const x of earlier || []) opening.set(x.account_id, (opening.get(x.account_id) || 0) + Number(x.debit) - Number(x.credit));
      const { data: partyOpenings, error: partyOpeningError } = await db.from("party_opening_balances")
        .select("amount").eq("fiscal_year_id", fy.id);
      if (partyOpeningError) throw partyOpeningError;
      const openingReceivable = (partyOpenings || []).reduce((sum, row) => sum + Math.max(0, Number(row.amount)), 0);
      const openingPayable = (partyOpenings || []).reduce((sum, row) => sum + Math.max(0, -Number(row.amount)), 0);
      const addOpening = (key: string, signedDebitBalance: number) => {
        const account = accounts?.find((row) => row.system_key === key); if (account) opening.set(account.id, (opening.get(account.id) || 0) + signedDebitBalance);
      };
      addOpening("accounts_receivable", openingReceivable);
      addOpening("accounts_payable", -openingPayable);
      addOpening("opening_equity", openingPayable - openingReceivable);

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

    const voucherFields="id,voucher_no,voucher_type,voucher_date,narration,payment_mode,cheque_status,subtotal,discount_amount,tax_amount,total,party_id,parties!vouchers_company_party_fkey(name)";
    let voucherQuery = partyId
      ? db.from("vouchers").select(`${voucherFields},ledger_entries!ledger_company_voucher_fkey!inner(id,entry_date,debit,credit,account_name,created_at)`).eq("company_id",company.id).eq("fiscal_year_id",fy.id).eq("party_id",partyId).gte("ledger_entries.entry_date",dateFrom).lte("ledger_entries.entry_date",dateTo).order("voucher_date").order("created_at")
      : db.from("vouchers").select(`${voucherFields},ledger_entries!ledger_company_voucher_fkey(id,entry_date,debit,credit,account_name,created_at)`).eq("company_id",company.id).eq("fiscal_year_id",fy.id).gte("voucher_date",dateFrom).lte("voucher_date",dateTo).order("voucher_date").order("created_at");
    const voucherReportTypes:Record<string,string>={sales:"sale",purchases:"purchase",payments:"receipt",expenses:"expense",sales_returns:"sale_return",purchase_returns:"purchase_return",journals:"journal",contra:"contra",stock_adjustments:"stock_adjustment",payroll:"payroll"};
    if (voucherReportTypes[reportType]) voucherQuery = voucherQuery.eq("voucher_type", voucherReportTypes[reportType]);
    const { data: vouchers, error: voucherError } = await voucherQuery;
    if (voucherError) throw voucherError;

    let opening = 0;
    let party = null;
    if (partyId) {
      const [{ data: partyRow, error: partyError }, { data: openingRow, error: openingError }, { data: earlier, error: earlierError }] = await Promise.all([
        db.from("parties").select("id,name,place,phone,tax_no,opening_balance").eq("id", partyId).eq("company_id", company.id).single(),
        db.from("party_opening_balances").select("amount").eq("fiscal_year_id", fy.id).eq("party_id", partyId).maybeSingle(),
        db.from("ledger_entries").select("debit,credit,vouchers!ledger_company_voucher_fkey!inner(fiscal_year_id)").eq("company_id", company.id).eq("party_id", partyId).eq("vouchers.fiscal_year_id", fy.id).gte("entry_date", fy.start_ad).lt("entry_date", dateFrom),
      ]);
      if (partyError || openingError || earlierError) throw partyError || openingError || earlierError;
      party = partyRow;
      opening = Number(openingRow?.amount ?? partyRow.opening_balance) + (earlier || []).reduce((s, x) => s + Number(x.debit) - Number(x.credit), 0);
    }

    let running = opening;
    const partyRows = partyId ? (vouchers || []).flatMap((v: any) => (v.ledger_entries || []).map((entry:any,index:number) => {
      const adjustment=entry.account_name==="Cancelled Cheque Receipt Adjustment";
      return { id:entry.id,voucherId:v.id,ref:v.voucher_no,type:adjustment?"cheque_adjustment":v.voucher_type,date:entry.entry_date||v.voucher_date,createdAt:entry.created_at,party:v.parties?.name||"Cash / Office",particulars:adjustment?"Cancelled cheque · received payment adjusted":v.narration||"—",paymentMode:v.payment_mode,subtotal:Number(v.subtotal),discount:Number(v.discount_amount),tax:Number(v.tax_amount),amount:index===0?Number(v.total):0,debit:Number(entry.debit),credit:Number(entry.credit) };
    })).sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date))||String(a.createdAt).localeCompare(String(b.createdAt))) : [];
    const rows = partyId
      ? partyRows.map((row:any)=>{running+=row.debit-row.credit;return{...row,balance:running}})
      : (vouchers || []).map((v: any) => {
          const debit=(v.ledger_entries||[]).reduce((sum:number,entry:any)=>sum+Number(entry.debit),0);
          const credit=(v.ledger_entries||[]).reduce((sum:number,entry:any)=>sum+Number(entry.credit),0);
          const cancelledCheque=v.voucher_type==="receipt"&&v.payment_mode==="Cheque"&&v.cheque_status==="cancelled";
          return { id:v.id, ref:v.voucher_no, type:cancelledCheque?"cheque_adjustment":v.voucher_type, date:v.voucher_date, party:v.parties?.name||"Cash / Office", particulars:cancelledCheque?"Cancelled cheque · received payment adjusted":v.narration||"—", paymentMode:v.payment_mode, subtotal:Number(v.subtotal), discount:Number(v.discount_amount), tax:Number(v.tax_amount), amount:cancelledCheque?0:Number(v.total), debit, credit, balance:null };
        });
    const totals = rows.reduce((s, x) => ({ debit: s.debit + x.debit, credit: s.credit + x.credit, sales: s.sales + (x.type === "sale" ? x.amount : 0), purchases: s.purchases + (x.type === "purchase" ? x.amount : 0), receipts: s.receipts + (x.type === "receipt" ? x.amount : 0), expenses: s.expenses + (x.type === "expense" ? x.amount : 0) }), { debit: 0, credit: 0, sales: 0, purchases: 0, receipts: 0, expenses: 0 });
    return NextResponse.json({ company, fiscalYear: fy, party, from: dateFrom, to: dateTo, reportType, opening, closing: partyId ? running : null, totals, rows });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Report database error" }, { status: 500 });
  }
}
