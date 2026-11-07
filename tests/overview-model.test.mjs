import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(
  new URL("../lib/overview-model.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { buildOverviewMonths, overviewTotals } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const months = [
  { key: "2083-4", year: 2083, month: 4, label: "श्रावण" },
  { key: "2083-5", year: 2083, month: 5, label: "भाद्र" },
];
const record = (type, total, extra = {}) => ({
  voucher_type: type,
  total,
  voucher_date: "2083-4",
  document_status: "posted",
  ...extra,
});
test("overview nets returns and excludes drafts and cancelled cheque receipts", () => {
  const rows = [
    record("sale", 113),
    record("sale_return", 13),
    record("purchase", 80),
    record("purchase_return", 20),
    record("expense", 10),
    record("receipt", 30, { payment_mode: "Cash" }),
    record("receipt", 40, { payment_mode: "Cheque", cheque_status: "pending" }),
    record("receipt", 200, {
      payment_mode: "Cheque",
      cheque_status: "cancelled",
    }),
    record("sale", 500, { document_status: "draft" }),
    record("payment", 75),
  ];
  const result = buildOverviewMonths(rows, months, (date) => date);
  assert.deepEqual(overviewTotals(result), {
    sales: 100,
    purchases: 60,
    expenses: 10,
    collections: 70,
    count: 7,
  });
  assert.deepEqual(result[0].receipts, { Cash: 30, Cheque: 40 });
  assert.equal(result[1].count, 0);
});
test("period and month summaries are independent and signed net values are preserved", () => {
  const result = buildOverviewMonths(
    [
      record("sale", 10),
      record("sale_return", 25),
      record("expense", 9, { voucher_date: "2083-5" }),
      record("sale", 999, { voucher_date: "outside-fy" }),
    ],
    months,
    (date) => date,
  );
  assert.equal(overviewTotals([result[0]]).sales, -15);
  assert.equal(overviewTotals([result[0]]).expenses, 0);
  assert.equal(overviewTotals(result).expenses, 9);
});
test("empty data is honestly zero and repeated aggregation does not mutate input", () => {
  const first = buildOverviewMonths([], months, (date) => date);
  assert.equal(overviewTotals(first).count, 0);
  buildOverviewMonths([record("sale", 5)], months, (date) => date);
  assert.equal(overviewTotals(first).sales, 0);
  assert.equal(months[0].sales, undefined);
});
test("overview data fetch is company scoped and paginated beyond the API cap", async () => {
  const route = await readFile(
    new URL("../app/api/accounting/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    route,
    /allReportRows\(supabase[\s\S]*?\.eq\("company_id", company.id\)[\s\S]*?\.order\("id"\)/,
  );
  const records = Array.from({ length: 1501 }, () => record("sale", 1));
  assert.equal(
    overviewTotals(buildOverviewMonths(records, months, (date) => date)).sales,
    1501,
  );
});
