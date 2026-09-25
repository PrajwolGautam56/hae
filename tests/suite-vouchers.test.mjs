import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/suite-vouchers.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { loadSuiteVouchers } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function database(results) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, filters: [] }; calls.push(call);
    const result = results[calls.length - 1];
    const q = {
      select(fields) { call.fields = fields; return q; },
      eq(key, value) { call.filters.push([key, value]); return q; },
      in(key, value) { call.filters.push([key, value]); return q; },
      order() { return q; }, limit(value) { call.limit = value; return q; },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    return q;
  } };
}

test("voucher sources load in one company-scoped batch, including previous-year invoices", async () => {
  const db = database([
    { data: [{ id: "return-1", source_voucher_id: "old-invoice" }, { id: "return-2", source_voucher_id: "old-invoice" }, { id: "journal", source_voucher_id: null }], error: null },
    { data: [{ id: "old-invoice", company_id: "company-a", voucher_no: "001", voucher_type: "sale" }], error: null },
  ]);
  const result = await loadSuiteVouchers(db, "company-a", "fy-current");
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[0].filters.slice(0, 2), [["company_id", "company-a"], ["fiscal_year_id", "fy-current"]]);
  assert.equal(db.calls[0].limit, 100);
  assert.deepEqual(db.calls[1].filters, [["company_id", "company-a"], ["id", ["old-invoice"]]]);
  assert.deepEqual(result[0].source, { voucher_no: "001", voucher_type: "sale" });
  assert.deepEqual(result[1].source, result[0].source);
  assert.equal(result[2].source, null);
  assert.doesNotMatch(db.calls[0].fields, /source:vouchers/);
});

test("missing or foreign-company source invoices never disclose another company's data", async () => {
  const db = database([
    { data: [{ id: "r1", source_voucher_id: "foreign" }, { id: "r2", source_voucher_id: "missing" }], error: null },
    { data: [{ id: "foreign", company_id: "company-b", voucher_no: "private", voucher_type: "sale" }], error: null },
  ]);
  const result = await loadSuiteVouchers(db, "company-a", "fy");
  assert.deepEqual(result.map(row => row.source), [null, null]);
});

test("empty/new companies and standalone journals need no source lookup", async () => {
  for (const rows of [[], [{ id: "journal", source_voucher_id: null }]]) {
    const db = database([{ data: rows, error: null }]);
    const result = await loadSuiteVouchers(db, "company-a", "fy");
    assert.equal(result.length, rows.length);
    assert.equal(db.calls.length, 1);
  }
});

test("database failures propagate instead of showing incomplete records as success", async () => {
  const failure = new Error("Database unavailable");
  await assert.rejects(loadSuiteVouchers(database([{ data: null, error: failure }]), "a", "fy"), failure);
  await assert.rejects(loadSuiteVouchers(database([
    { data: [{ id: "r", source_voucher_id: "invoice" }], error: null },
    { data: null, error: failure },
  ]), "a", "fy"), failure);
});
