import {
  ageParty,
  cents,
  rupees,
  monthlyAccounting,
} from "./accounting-report-model";
import { allReportRows } from "./report-query";

export async function connectedReport(
  db: any,
  company: any,
  fy: any,
  type: string,
  from: string,
  to: string,
  partyId: string | null,
) {
  const envelope = { company, fiscalYear: fy, from, to, reportType: type };
  if (type === "monthly_accounting") {
    let query = db
      .from("vouchers")
      .select(
        "id,voucher_no,voucher_type,voucher_date,bill_category,supplier_bill_no,subtotal,discount_amount,tax_amount,total,party_id,parties!vouchers_company_party_fkey(name,tax_no)",
      )
      .eq("company_id", company.id)
      .gte("voucher_date", from)
      .lte("voucher_date", to)
      .eq("document_status", "posted")
      .in("voucher_type", [
        "sale",
        "purchase",
        "sale_return",
        "purchase_return",
      ]);
    if (partyId) query = query.eq("party_id", partyId);
    return {
      ...envelope,
      ...monthlyAccounting(
        await allReportRows(query.order("voucher_date").order("id")),
      ),
    };
  }
  const [parties, entries, openings] = await Promise.all([
    allReportRows(
      db
        .from("parties")
        .select("id,name,place,phone,tax_no,opening_balance")
        .eq("company_id", company.id)
        .order("id"),
    ),
    allReportRows(
      db
        .from("ledger_entries")
        .select(
          "id,party_id,voucher_id,entry_date,debit,credit,account_name,created_at,vouchers!ledger_company_voucher_fkey(id,voucher_type,voucher_no,voucher_date,due_date,narration,total,subtotal,discount_amount,tax_amount,bill_category,supplier_bill_no,payment_mode)",
        )
        .eq("company_id", company.id)
        .lte("entry_date", to)
        .order("entry_date")
        .order("id"),
    ),
    allReportRows(
      db
        .from("party_opening_balances")
        .select(
          "party_id,amount,fiscal_year_id,fiscal_years!inner(company_id,start_ad)",
        )
        .eq("fiscal_years.company_id", company.id)
        .order("party_id")
        .order("fiscal_year_id"),
    ),
  ]);
  const selected = parties.find((p) => p.id === partyId);
  if (partyId && !selected)
    throw new Error("Party does not belong to the selected company");
  if (type === "daybook" && !partyId) {
    const journal = await allReportRows(
      db
        .from("journal_lines")
        .select(
          "id,effective_date,party_id,description,debit,credit,accounts!journal_line_company_account_fkey(name),journal_entries!journal_line_company_entry_fkey!inner(reference,voucher_id,source_type,description)",
        )
        .eq("company_id", company.id)
        .gte("effective_date", from)
        .lte("effective_date", to)
        .order("effective_date")
        .order("id"),
    );
    const rows = journal.map((l) => ({
      id: l.id,
      voucherId: l.journal_entries.voucher_id,
      date: l.effective_date,
      ref: l.journal_entries.reference,
      type: "journal",
      party:
        parties.find((p) => p.id === l.party_id)?.name ||
        l.accounts?.name ||
        "General account",
      particulars: [
        l.accounts?.name,
        l.description || l.journal_entries.description,
      ]
        .filter(Boolean)
        .join(" · "),
      debit: Number(l.debit),
      credit: Number(l.credit),
      balance: null,
    }));
    return {
      ...envelope,
      rows,
      totals: {
        debit: rupees(rows.reduce((s, r) => s + cents(r.debit), 0)),
        credit: rupees(rows.reduce((s, r) => s + cents(r.credit), 0)),
      },
      basis:
        "Every posted journal line, including manual journals, contra and dated cheque adjustments.",
    };
  }
  const scoped = partyId ? [selected] : parties;
  const byParty = new Map<string, any[]>();
  for (const e of entries) {
    const list = byParty.get(e.party_id) || [];
    list.push(e);
    byParty.set(e.party_id, list);
  }
  const openingFor = (p: any) =>
    Number(
      openings.find((o) => o.party_id === p.id && o.fiscal_year_id === fy.id)
        ?.amount ?? p.opening_balance,
    );
  if (type.startsWith("aging_")) {
    const rows = scoped
      .map((p) => {
        const all = byParty.get(p.id) || [];
        const prior = all.filter((e) => e.entry_date < fy.start_ad);
        // Anchor history to this year's opening, preserving historical invoice ages.
        const base =
          openingFor(p) -
          rupees(
            prior.reduce((s, e) => s + cents(e.debit) - cents(e.credit), 0),
          );
        return {
          id: p.id,
          party: p.name,
          place: p.place,
          phone: p.phone,
          ...ageParty(
            base,
            all.map((e) => ({
              ...e,
              due_date: e.vouchers?.due_date,
              voucher_no: e.vouchers?.voucher_no,
            })),
            to,
            type === "aging_payable",
          ),
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    const keys = [
      "notDue",
      "current",
      "days31to60",
      "days61to90",
      "above90",
      "unknown",
      "total",
    ];
    const totals = Object.fromEntries(
      keys.map((k) => [
        k,
        rupees(rows.reduce((s, r) => s + cents((r as any)[k]), 0)),
      ]),
    );
    return {
      ...envelope,
      rows,
      totals,
      allocation: "Net party FIFO",
      dateBasis:
        "Due date; invoice date when no due date exists. Opening balances without original dates are shown separately.",
    };
  }
  const balances = scoped.map((p) => {
    const all = byParty.get(p.id) || [];
    const before = all.filter(
      (e) => e.entry_date >= fy.start_ad && e.entry_date < from,
    );
    const period = all.filter((e) => e.entry_date >= from);
    const opening =
      cents(openingFor(p)) +
      before.reduce((s, e) => s + cents(e.debit) - cents(e.credit), 0);
    const debit = period.reduce((s, e) => s + cents(e.debit), 0),
      credit = period.reduce((s, e) => s + cents(e.credit), 0);
    const docs = [
      ...new Map(
        period
          .filter((e) => e.vouchers && e.vouchers.voucher_date >= from)
          .map((e) => [e.voucher_id, e.vouchers]),
      ).values(),
    ] as any[];
    const total = (kind: string) =>
      rupees(
        docs
          .filter((v) => v.voucher_type === kind)
          .reduce((s, v) => s + cents(v.total), 0),
      );
    return {
      id: p.id,
      party: p.name,
      place: p.place,
      tax_no: p.tax_no,
      opening: rupees(opening),
      debit: rupees(debit),
      credit: rupees(credit),
      closing: rupees(opening + debit - credit),
      sales: total("sale"),
      salesReturns: total("sale_return"),
      purchases: total("purchase"),
      purchaseReturns: total("purchase_return"),
      receipts: rupees(
        period
          .filter((e) => e.vouchers?.voucher_type === "receipt")
          .reduce((s, e) => s + cents(e.credit) - cents(e.debit), 0),
      ),
      payments: total("payment"),
      transactionCount: period.length,
    };
  });
  if (type === "party_summary") {
    const keys = [
      "opening",
      "debit",
      "credit",
      "closing",
      "sales",
      "salesReturns",
      "purchases",
      "purchaseReturns",
      "receipts",
      "payments",
    ];
    return {
      ...envelope,
      rows: balances,
      totals: Object.fromEntries(
        keys.map((k) => [
          k,
          rupees(balances.reduce((s, r) => s + cents((r as any)[k]), 0)),
        ]),
      ),
    };
  }
  // Party ledgers use dated subledger entries, including manual journals and later cheque reversals.
  if (partyId && type === "daybook") {
    let running = cents(balances[0].opening);
    const rows = (byParty.get(partyId) || [])
      .filter((e) => e.entry_date >= from)
      .map((e) => {
        running += cents(e.debit) - cents(e.credit);
        const v = e.vouchers || {};
        return {
          id: e.id,
          voucherId: e.voucher_id,
          date: e.entry_date,
          ref: v.voucher_no,
          type: v.voucher_type,
          party: selected.name,
          particulars:
            e.account_name === "Cancelled Cheque Receipt Adjustment"
              ? "Cancelled cheque · payment adjusted"
              : e.account_name || v.narration,
          debit: Number(e.debit),
          credit: Number(e.credit),
          balance: rupees(running),
          paymentMode: v.payment_mode,
        };
      });
    return {
      ...envelope,
      party: selected,
      opening: balances[0].opening,
      closing: rupees(running),
      rows,
      totals: balances[0],
    };
  }
  return null;
}
