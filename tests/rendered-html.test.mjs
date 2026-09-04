import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("ships the branded authenticated accounting application", async () => {
  const [layout, page, proxy] = await Promise.all([
    read("app/layout.tsx"),
    read("app/page.tsx"),
    read("proxy.ts"),
  ]);

  assert.match(layout, /Hamro Afno Enterprises/);
  assert.match(page, /AccountingOperationsWorkspace/);
  assert.match(page, /mode="accounting"/);
  assert.match(page, /mode="manufacturing"/);
  assert.match(proxy, /\/login/);
  assert.doesNotMatch(page, /Tashi Delek Traders|Himalayan Link Trading/);
});

test("keeps long accounting workflows scrollable and mobile responsive", async () => {
  const [workspace, css] = await Promise.all([
    read("app/accounting-operations-workspace.tsx"),
    read("app/accounting-operations.css"),
  ]);

  for (const workflow of [
    "Purchase Order",
    "Sales Return",
    "Purchase Return",
    "Journal Voucher",
    "Contra Voucher",
    "Stock Journal",
    "Payroll Voucher",
    "BOM Master",
    "Production Order",
  ]) assert.match(workspace, new RegExp(workflow));

  assert.match(css, /max-height:calc\(100dvh - 24px\)/);
  assert.match(css, /overflow-y:auto/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /width:100%/);
});
