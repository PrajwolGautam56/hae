import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function moduleUrl(file) {
  let source = ts.transpileModule(await fs.readFile(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const match of [...source.matchAll(/from ["'](\.[^"']+)["']/g)]) {
    source = source.replace(
      match[0],
      `from "${await moduleUrl(path.resolve(path.dirname(file), match[1] + ".ts"))}"`,
    );
  }
  return (
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
}
const { monthlyAccounting, ageParty } = await import(
  await moduleUrl(path.resolve("lib/accounting-report-model.ts"))
);
const { financialReport } = await import(
  await moduleUrl(path.resolve("lib/financial-reports.ts"))
);
const { allReportRows } = await import(
  await moduleUrl(path.resolve("lib/report-query.ts"))
);

test("monthly bills separate VAT, PAN, non-VAT, unknown and returns without changing source amounts", () => {
  const invoice = (type, category, base, tax, total) => ({
    voucher_type: type,
    bill_category: category,
    subtotal: base + 10,
    discount_amount: 10,
    tax_amount: tax,
    total,
  });
  const report = monthlyAccounting([
    invoice("sale", "vat", 100, 13, 113),
    invoice("sale", "non_vat", 50, 0, 50),
    invoice("purchase", "pan", 20, 0, 20),
    invoice("purchase", "vat", 30, 3.9, 33.9),
    invoice("sale_return", "vat", 10, 1.3, 11.3),
    invoice("purchase", null, 5, 0, 5),
  ]);
  assert.equal(report.totals.sales, 151.7);
  assert.equal(report.totals.purchases, 58.9);
  assert.equal(report.totals.salesCount, 2);
  assert.equal(report.totals.purchaseCount, 3);
  assert.equal(report.totals.outputTax, 11.7);
  assert.equal(report.totals.inputTax, 3.9);
  assert.equal(report.totals.unclassifiedCount, 1);
  assert.equal(report.rows.find((r) => r.category === "pan").taxable, 0);
  assert.equal(report.rows.find((r) => r.category === "pan").nonTaxable, 20);
  assert.equal(report.rows.find((r) => r.isReturn).count, 1);
});

const entry = (id, date, debit, credit, due) => ({
  id,
  entry_date: date,
  created_at: date,
  debit,
  credit,
  due_date: due,
});
test("ageing retains old invoice ages, unknown opening dates, and exact boundaries", () => {
  const rows = [
    entry("1", "2026-01-01", 100, 0),
    entry("2", "2026-05-02", 100, 0),
    entry("3", "2026-06-01", 100, 0),
    entry("4", "2026-07-01", 100, 0),
    entry("5", "2026-07-02", 100, 0),
    entry("6", "2026-08-01", 100, 0),
    entry("7", "2026-08-02", 999, 0),
  ];
  const a = ageParty(50, rows, "2026-08-01");
  assert.equal(a.unknown, 50);
  assert.equal(a.above90, 200);
  assert.equal(a.days61to90, 100);
  assert.equal(a.days31to60, 100);
  assert.equal(a.current, 200);
  assert.equal(a.total, 650);
  const b = ageParty(
    0,
    [entry("1", "2026-01-01", 500, 0), entry("2", "2026-06-01", 0, 200)],
    "2026-08-01",
  );
  assert.equal(b.above90, 300);
  const c = ageParty(
    0,
    [entry("1", "2026-07-01", 0, 100, "2026-09-01")],
    "2026-08-01",
    true,
  );
  assert.equal(c.notDue, 100);
});

test("report pagination includes rows beyond the Data API cap and propagates failures", async () => {
  const all = Array.from({ length: 1201 }, (_, id) => ({ id }));
  assert.equal(
    (
      await allReportRows({
        range: async (a, b) => ({ data: all.slice(a, b + 1), error: null }),
      })
    ).length,
    1201,
  );
  await assert.rejects(
    () =>
      allReportRows({
        range: async () => ({ error: { message: "Access denied" } }),
      }),
    /Access denied/,
  );
});

test("cancelled cheque restores original overdue age only after the cancellation date", () => {
  const rows = [
    entry("invoice", "2026-01-01", 500, 0),
    { ...entry("receipt", "2026-06-01", 0, 200), voucher_id: "cheque" },
    {
      ...entry("cancel", "2026-08-01", 200, 0),
      voucher_id: "cheque",
      account_name: "Cancelled Cheque Receipt Adjustment",
    },
  ];
  assert.equal(ageParty(0, rows, "2026-07-31").above90, 300);
  const cancelled = ageParty(0, rows, "2026-08-01");
  assert.equal(cancelled.above90, 500);
  assert.equal(cancelled.current, 0);
});

function database(tables) {
  return {
    from(table) {
      let rows = tables[table] || [];
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          if (!k.includes(".")) rows = rows.filter((r) => r[k] === v);
          return q;
        },
        lte(k, v) {
          rows = rows.filter((r) => r[k] <= v);
          return q;
        },
        order() {
          return q;
        },
        range(a, b) {
          return Promise.resolve({ data: rows.slice(a, b + 1), error: null });
        },
      };
      return q;
    },
  };
}
test("financial years carry assets and liabilities but close old income to retained earnings", async () => {
  const company = { id: "c" },
    fy = { id: "fy2", start_ad: "2026-07-17" };
  const account = (id, key, type, normal) => ({
    id,
    company_id: "c",
    code: id,
    name: key,
    system_key: key,
    account_type: type,
    normal_side: normal,
  });
  const accounts = [
    account("cash", "cash_bank", "asset", "debit"),
    account("ar", "accounts_receivable", "asset", "debit"),
    account("ap", "accounts_payable", "liability", "credit"),
    account("equity", "opening_equity", "equity", "credit"),
    account("sales", "sales_revenue", "income", "credit"),
  ];
  const line = (id, acct, date, debit, credit) => ({
    id,
    company_id: "c",
    account_id: acct,
    effective_date: date,
    debit,
    credit,
    journal_entries: { entry_date: date, created_at: date, reference: id },
  });
  const db = database({
    accounts,
    journal_lines: [
      line("1", "cash", "2026-06-01", 100, 0),
      line("2", "sales", "2026-06-01", 0, 100),
      line("3", "ar", "2026-08-01", 50, 0),
      line("4", "sales", "2026-08-01", 0, 50),
    ],
    parties: [],
    party_opening_balances: [],
    money_accounts: [],
    fiscal_years: [{ id: "fy1", company_id: "c", start_ad: "2025-07-17" }, fy],
  });
  const trial = await financialReport(
    db,
    company,
    fy,
    "trial_balance",
    "2026-07-17",
    "2026-08-31",
    null,
  );
  assert.equal(trial.balanced, true);
  assert.equal(
    trial.rows.find((r) => r.id === "retained-earnings").openingCredit,
    100,
  );
  assert.equal(trial.rows.find((r) => r.id === "sales").openingCredit, 0);
  const bs = await financialReport(
    db,
    company,
    fy,
    "balance_sheet",
    "2026-08-01",
    "2026-08-31",
    null,
  );
  assert.equal(bs.totals.assets, 150);
  assert.equal(bs.totals.liabilitiesAndEquity, 150);
  const pl = await financialReport(
    db,
    company,
    fy,
    "profit_loss",
    "2026-07-17",
    "2026-08-31",
    null,
  );
  assert.equal(pl.totals.netProfit, 50);
});
