import pg from "pg";
import fs from "node:fs/promises";
import env from "@next/env";
import assert from "node:assert/strict";
env.loadEnvConfig(process.cwd());
const ref = new URL(
  process.env.UNIFIED_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
).hostname.split(".")[0];
const client = new pg.Client({
  host: `db.${ref}.supabase.co`,
  database: "postgres",
  user: "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await client.connect();
try {
  await client.query("begin");
  await client.query("set local lock_timeout='5s'");
  await client.query(
    await fs.readFile(
      "supabase/migrations/202609140001_connected_accounting.sql",
      "utf8",
    ),
  );
  const company = (
    await client.query(
      "insert into companies(name,currency,fiscal_year) values ('Rollback-only accounting QA','NPR','BS') returning id",
    )
  ).rows[0].id;
  const template = (
    await client.query(
      "select company_id from accounts group by company_id order by count(*) desc limit 1",
    )
  ).rows[0].company_id;
  await client.query(
    "insert into accounts(company_id,code,name,account_type,normal_side,system_key) select $1,code,name,account_type,normal_side,system_key from accounts where company_id=$2",
    [company, template],
  );
  const fy = (
    await client.query(
      "insert into fiscal_years(company_id,label_bs,start_ad,end_ad,status) values ($1,'2083/84','2026-07-17','2027-07-16','open') returning id",
      [company],
    )
  ).rows[0].id;
  const nextFy = (
    await client.query(
      "insert into fiscal_years(company_id,label_bs,start_ad,end_ad,status) values ($1,'2084/85','2027-07-17','2028-07-16','open') returning id",
      [company],
    )
  ).rows[0].id;
  const party = (
    await client.query(
      "insert into parties(company_id,name,party_type) values ($1,'Rollback-only test party','both') returning id",
      [company],
    )
  ).rows[0].id;
  const member = (
    await client.query(
      "insert into team_members(company_id,name,email,role,active) values ($1,'Rollback-only QA','qa-rollback@example.invalid','admin',true) returning id",
      [company],
    )
  ).rows[0].id;
  const call = async (type, category, tax, lines) =>
    (
      await client.query(
        "select record_classified_invoice($1,$2,$3,'2026-08-01',$4,$5,$6,0,$7,'QA','2026-08-31','SUP-QA',$8) as result",
        [
          company,
          fy,
          party,
          JSON.stringify(lines),
          type,
          category,
          tax,
          member,
        ],
      )
    ).rows[0].result;
  const purchase = await call("purchase", "pan", 0, [
    {
      name: "Raw QA",
      quantity: 20,
      rate: 10,
      item_type: "raw_material",
      unit: "l",
    },
    {
      name: "Resale QA",
      quantity: 10,
      rate: 50,
      item_type: "resale_good",
      unit: "pcs",
    },
  ]);
  const resale = (
    await client.query(
      "select id from products where company_id=$1 and name='Resale QA'",
      [company],
    )
  ).rows[0].id;
  const sale = await call("sale", "vat", 13, [
    { product_id: resale, name: "Resale QA", quantity: 2, rate: 100 },
    { name: "Custom service", quantity: 1, rate: 50 },
  ]);
  await client.query("set constraints all immediate");
  const journal = (
    await client.query(
      "select a.system_key,sum(l.debit)::numeric debit,sum(l.credit)::numeric credit from journal_lines l join journal_entries j on j.id=l.journal_entry_id join accounts a on a.id=l.account_id where j.voucher_id=$1 group by a.system_key",
      [sale.id],
    )
  ).rows;
  assert.equal(
    Number(journal.find((r) => r.system_key === "cost_of_goods").debit),
    100,
    "Sale journal includes stock cost",
  );
  assert.equal(
    Number(journal.find((r) => r.system_key === "tax_output").credit),
    32.5,
  );
  const purchaseJournal = (
    await client.query(
      "select a.system_key,l.debit from journal_lines l join journal_entries j on j.id=l.journal_entry_id join accounts a on a.id=l.account_id where j.voucher_id=$1",
      [purchase.id],
    )
  ).rows;
  assert.equal(
    Number(purchaseJournal.find((r) => r.system_key === "raw_inventory").debit),
    200,
  );
  assert.equal(
    Number(
      purchaseJournal.find((r) => r.system_key === "finished_inventory").debit,
    ),
    500,
  );
  await client.query("set constraints all deferred");
  const custom = (
    await client.query(
      "select id from voucher_lines where voucher_id=$1 and product_id is null",
      [sale.id],
    )
  ).rows[0].id;
  const returned = (
    await client.query(
      "select record_goods_return($1,$2,$3,'sale_return','2027-07-18',$4,'Custom return',$5) as result",
      [
        company,
        nextFy,
        sale.id,
        JSON.stringify([{ source_line_id: custom, quantity: 1, rate: 999999 }]),
        member,
      ],
    )
  ).rows[0].result;
  assert.equal(
    Number(returned.total),
    56.5,
    "Return uses original rate, including across FY",
  );
  const accts = (
    await client.query(
      "select id,system_key from accounts where company_id=$1",
      [company],
    )
  ).rows;
  const id = (k) => accts.find((a) => a.system_key === k).id;
  const manual = (
    await client.query(
      "select record_manual_journal($1,$2,'2026-08-02',$3,'Party adjustment',$4) as result",
      [
        company,
        fy,
        JSON.stringify([
          {
            account_id: id("accounts_receivable"),
            party_id: party,
            debit: 25,
            credit: 0,
          },
          { account_id: id("sales_revenue"), debit: 0, credit: 25 },
        ]),
        member,
      ],
    )
  ).rows[0].result;
  await client.query("set constraints all immediate");
  const subledger = (
    await client.query(
      "select sum(debit-credit) balance from ledger_entries where voucher_id=$1",
      [manual.id],
    )
  ).rows[0];
  assert.equal(
    Number(subledger.balance),
    25,
    "Manual journal updates party subledger",
  );
  const balance = (
    await client.query(
      "select amount from party_opening_balances where fiscal_year_id=$1 and party_id=$2",
      [nextFy, party],
    )
  ).rows[0];
  assert.equal(
    Number(balance.amount),
    -392.5,
    "Next FY opening follows prior closing",
  );
  await client.query("set constraints all deferred");
  const discounted = (
    await client.query(
      "select record_classified_invoice($1,$2,$3,'2026-08-03',$4,'purchase','non_vat',10,0,'Discounted purchase',null,'DISCOUNT-QA',$5) result",
      [
        company,
        fy,
        party,
        JSON.stringify([
          {
            name: "Discount QA",
            quantity: 10,
            rate: 100,
            item_type: "resale_good",
            unit: "pcs",
          },
        ]),
        member,
      ],
    )
  ).rows[0].result;
  const discountedCost = (
    await client.query(
      "select unit_cost from stock_movements where voucher_id=$1",
      [discounted.id],
    )
  ).rows[0];
  assert.equal(
    Number(discountedCost.unit_cost),
    90,
    "Purchase stock cost excludes trade discount",
  );
  await client.query("select classify_voucher_bill($1,$2,'pan',$3)", [
    company,
    discounted.id,
    member,
  ]);
  assert.equal(
    (
      await client.query("select bill_category from vouchers where id=$1", [
        discounted.id,
      ])
    ).rows[0].bill_category,
    "pan",
  );
  await client.query("savepoint invalid_class");
  await assert.rejects(
    () =>
      client.query("select classify_voucher_bill($1,$2,'non_vat',$3)", [
        company,
        sale.id,
        member,
      ]),
    /contains VAT/,
  );
  await client.query("rollback to savepoint invalid_class");
  await client.query("savepoint negative_stock");
  await assert.rejects(
    () =>
      client.query("update products set stock_qty=-1 where id=$1", [resale]),
    /Insufficient stock/,
  );
  await client.query("rollback to savepoint negative_stock");
  const cheque = (
    await client.query(
      "insert into vouchers(company_id,party_id,fiscal_year_id,voucher_type,voucher_no,voucher_date,total,payment_mode,cheque_status,cheque_no,cheque_bank,cheque_exchange_date) values ($1,$2,$3,'receipt','CHEQUE-QA','2026-08-01',100,'Cheque','cancelled','QA1','QA Bank','2026-08-15') returning id",
      [company, party, fy],
    )
  ).rows[0].id;
  await client.query(
    "insert into ledger_entries(company_id,party_id,voucher_id,entry_date,account_name,debit,credit) values ($1,$2,$3,'2026-08-01','Cheque receipt',0,100),($1,$2,$3,'2026-09-01','Cancelled Cheque Receipt Adjustment',100,0)",
    [company, party, cheque],
  );
  await client.query("set constraints all immediate");
  const chequeRows = (
    await client.query(
      "select effective_date::text,l.debit,l.credit,a.system_key from journal_lines l join accounts a on a.id=l.account_id join journal_entries j on j.id=l.journal_entry_id where j.voucher_id=$1",
      [cheque],
    )
  ).rows;
  assert.equal(
    chequeRows.filter((r) => r.effective_date === "2026-09-01").length,
    2,
    "Cancellation posts at cancellation date",
  );
  assert.equal(
    chequeRows
      .filter(
        (r) =>
          r.effective_date === "2026-08-01" &&
          r.system_key === "accounts_receivable",
      )
      .reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0),
    -100,
    "Original receipt period is preserved",
  );
  const raw=(await client.query("select id from products where company_id=$1 and name='Raw QA'",[company])).rows[0].id;
  const output=(await client.query("insert into products(company_id,name,unit,item_type,stock_qty) values ($1,'BOM output QA','pcs','finished_good',0) returning id",[company])).rows[0].id;
  const bom=(await client.query("select save_bill_of_materials($1,$2,'QA recipe','1',1,$3,'QA',$4) result",[company,output,JSON.stringify([{product_id:raw,quantity:2,wastage_percent:0}]),member])).rows[0].result;
  const batch=(await client.query("select record_bom_production($1,$2,$3,'2026-08-04',3,'QA production') result",[company,fy,bom.id])).rows[0].result;
  assert.equal(Number(batch.production_cost),60,'BOM production costs consumed raw stock');
  assert.equal(Number((await client.query("select stock_qty from products where id=$1",[raw])).rows[0].stock_qty),14,'BOM consumes raw inventory');
  assert.equal(Number((await client.query("select stock_qty from products where id=$1",[output])).rows[0].stock_qty),3,'BOM creates saleable stock');
  const productionJournal=(await client.query("select sum(l.debit) debit from journal_lines l join journal_entries j on j.id=l.journal_entry_id where j.company_id=$1 and j.source_type='production'",[company])).rows[0];
  assert.equal(Number(productionJournal.debit),60,'Production is included in the general ledger');
  const imbalance = (
    await client.query(
      "select j.id from journal_entries j join journal_lines l on l.journal_entry_id=j.id where j.company_id=$1 group by j.id having abs(sum(l.debit-l.credit))>0.009",
      [company],
    )
  ).rows;
  assert.equal(imbalance.length, 0, "All synthetic journals balance");
  console.log(
    JSON.stringify({
      project: ref,
      tests: "PASS",
      checks: [
        "VAT invoice",
        "PAN purchase",
        "raw/resale journal allocation",
        "cost of sales",
        "custom return at original rate",
        "cross-year return",
        "manual party journal",
        "FY rollover",
        "purchase discount cost",
        "audited classification",
        "invalid relabelling blocked",
        "negative stock blocked",
        "dated cheque cancellation",
        "BOM raw consumption and finished stock",
        "production general ledger",
        "balanced journals",
      ],
      persistedRecords: 0,
    }),
  );
} finally {
  await client.query("rollback");
  await client.end();
}
