import { allReportRows } from "./report-query";
import { cents, rupees } from "./accounting-report-model";

export async function financialReport(
  db: any,
  company: any,
  fy: any,
  type: string,
  from: string,
  to: string,
  accountId: string | null,
) {
  const [accounts, lines, partyOpenings, parties, years, moneyAccounts] =
    await Promise.all([
      allReportRows(
        db
          .from("accounts")
          .select("id,code,name,account_type,normal_side,system_key")
          .eq("company_id", company.id)
          .order("code")
          .order("id"),
      ),
      allReportRows(
        db
          .from("journal_lines")
          .select(
            "id,effective_date,account_id,party_id,description,debit,credit,journal_entries!journal_line_company_entry_fkey!inner(id,entry_date,reference,description,fiscal_year_id,created_at)",
          )
          .eq("company_id", company.id)
          .lte("effective_date", to)
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
      allReportRows(
        db
          .from("parties")
          .select("id,opening_balance")
          .eq("company_id", company.id)
          .order("id"),
      ),
      allReportRows(
        db
          .from("fiscal_years")
          .select("id,start_ad")
          .eq("company_id", company.id)
          .order("start_ad")
          .order("id"),
      ),
      allReportRows(
        db
          .from("money_accounts")
          .select("id,opening_balance")
          .eq("company_id", company.id)
          .order("id"),
      ),
    ]);
  const opening = new Map<string, number>();
  const movements = new Map<string, { debit: number; credit: number }>();
  const add = (key: string, value: number) => {
    const account = accounts.find((a) => a.system_key === key);
    if (account)
      opening.set(account.id, (opening.get(account.id) || 0) + value);
  };
  for (const p of parties) {
    const value = cents(
      partyOpenings.find(
        (o) => o.party_id === p.id && o.fiscal_year_id === years[0]?.id,
      )?.amount ?? p.opening_balance,
    );
    add(value >= 0 ? "accounts_receivable" : "accounts_payable", value);
    add("opening_equity", -value);
  }
  const cashOpening = moneyAccounts.reduce(
    (s, a) => s + cents(a.opening_balance),
    0,
  );
  add("cash_bank", cashOpening);
  add("opening_equity", -cashOpening);
  const start = type === "balance_sheet" ? fy.start_ad : from;
  const retained = {
    id: "retained-earnings",
    code: "3100*",
    name: "Prior years retained earnings",
    account_type: "equity",
    normal_side: "credit",
    system_key: "retained_earnings",
  };
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let retainedBalance = 0;
  for (const line of lines) {
    const date = line.effective_date;
    const amount = cents(line.debit) - cents(line.credit);
    const account: any = byId.get(line.account_id);
    if (
      date < fy.start_ad &&
      ["income", "expense"].includes(account?.account_type)
    ) {
      retainedBalance += amount;
      continue;
    }
    if (date < start)
      opening.set(
        line.account_id,
        (opening.get(line.account_id) || 0) + amount,
      );
    else {
      const m = movements.get(line.account_id) || { debit: 0, credit: 0 };
      m.debit += cents(line.debit);
      m.credit += cents(line.credit);
      movements.set(line.account_id, m);
    }
  }
  if (retainedBalance) {
    accounts.push(retained);
    opening.set(retained.id, retainedBalance);
  }
  const rows = accounts
    .map((a) => {
      const op = opening.get(a.id) || 0;
      const m = movements.get(a.id) || { debit: 0, credit: 0 };
      const cl = op + m.debit - m.credit;
      return {
        ...a,
        accountType: a.account_type,
        openingDebit: rupees(Math.max(op, 0)),
        openingCredit: rupees(Math.max(-op, 0)),
        debit: rupees(m.debit),
        credit: rupees(m.credit),
        closingDebit: rupees(Math.max(cl, 0)),
        closingCredit: rupees(Math.max(-cl, 0)),
        balance: rupees((a.normal_side === "debit" ? 1 : -1) * cl),
      };
    })
    .filter((r) => r.openingDebit || r.openingCredit || r.debit || r.credit);
  const envelope = {
    company,
    fiscalYear: fy,
    from: start,
    to,
    reportType: type,
    accounts,
    basis:
      "Posted journals with prior balance-sheet accounts carried forward and prior income/expense closed to retained earnings. Opening cash uses the recorded account opening balance.",
  };
  if (type === "trial_balance") {
    const keys = [
      "openingDebit",
      "openingCredit",
      "debit",
      "credit",
      "closingDebit",
      "closingCredit",
    ];
    const totals: any = Object.fromEntries(
      keys.map((k) => [k, rupees(rows.reduce((s, r) => s + cents(r[k]), 0))]),
    );
    return {
      ...envelope,
      rows,
      totals,
      balanced: Math.abs(totals.closingDebit - totals.closingCredit) < 0.01,
    };
  }
  if (type === "general_ledger") {
    if (accountId && !accounts.some((a) => a.id === accountId))
      throw new Error("Account does not belong to this company");
    let running = accountId ? opening.get(accountId) || 0 : 0;
    const ledgerRows = lines
      .filter(
        (l) =>
          l.effective_date >= from &&
          (!accountId || l.account_id === accountId),
      )
      .sort(
        (a, b) =>
          a.effective_date.localeCompare(b.effective_date) ||
          a.journal_entries.created_at.localeCompare(
            b.journal_entries.created_at,
          ) ||
          a.id.localeCompare(b.id),
      )
      .map((l) => {
        running += cents(l.debit) - cents(l.credit);
        const a: any = byId.get(l.account_id);
        return {
          id: l.id,
          date: l.effective_date,
          ref: l.journal_entries.reference,
          accountId: l.account_id,
          accountCode: a?.code,
          accountName: a?.name,
          particulars: l.description || l.journal_entries.description,
          debit: Number(l.debit),
          credit: Number(l.credit),
          balance: accountId ? rupees(running) : null,
        };
      });
    return {
      ...envelope,
      rows: ledgerRows,
      opening: accountId ? rupees(opening.get(accountId) || 0) : null,
      closing: accountId ? rupees(running) : null,
      totals: {
        debit: rupees(ledgerRows.reduce((s, r) => s + cents(r.debit), 0)),
        credit: rupees(ledgerRows.reduce((s, r) => s + cents(r.credit), 0)),
      },
    };
  }
  if (type === "profit_loss") {
    const result = rows
      .filter((r) => ["income", "expense"].includes(r.account_type))
      .map((r) => ({
        ...r,
        balance:
          r.normal_side === "debit" ? r.debit - r.credit : r.credit - r.debit,
      }));
    const income = result
      .filter((r) => r.account_type === "income")
      .reduce((s, r) => s + r.balance, 0);
    const expenses = result
      .filter((r) => r.account_type === "expense")
      .reduce((s, r) => s + r.balance, 0);
    return {
      ...envelope,
      rows: result,
      totals: { income, expenses, netProfit: income - expenses },
    };
  }
  if (type === "balance_sheet") {
    const result = rows.filter((r) =>
      ["asset", "liability", "equity"].includes(r.account_type),
    );
    const total = (kind: string) =>
      result
        .filter((r) => r.account_type === kind)
        .reduce((s, r) => s + r.balance, 0);
    const retainedEarnings = rows
      .filter((r) => ["income", "expense"].includes(r.account_type))
      .reduce(
        (s, r) => s + (r.account_type === "income" ? r.balance : -r.balance),
        0,
      );
    const totals = {
      assets: total("asset"),
      liabilities: total("liability"),
      equity: total("equity"),
      retainedEarnings,
      liabilitiesAndEquity:
        total("liability") + total("equity") + retainedEarnings,
    };
    return {
      ...envelope,
      rows: [
        ...result,
        {
          id: "current-earnings",
          code: "FY",
          name: "Current year profit / loss",
          account_type: "equity",
          debit: Math.max(-retainedEarnings, 0),
          credit: Math.max(retainedEarnings, 0),
          balance: retainedEarnings,
        },
      ],
      totals,
    };
  }
  return { ...envelope, rows };
}
