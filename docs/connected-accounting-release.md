# Connected accounting release — 2026-09-14

## Implemented locally

- Explicit sales VAT/non-VAT and purchase VAT/PAN/non-VAT classification. Tax-bearing invoices cannot be relabelled as non-VAT. Legacy zero-tax bills remain unclassified until reviewed; class changes preserve amounts and add an audit record.
- BS monthly summaries and source-bill CSV: document counts, discounted base, taxable/non-VAT base, VAT and gross amounts, with returns separately identified and netted in totals.
- Party trading summary and dated ledger, including manual receivable/payable journals and cheque cancellation adjustments.
- Ageing uses net-party FIFO with due-date fallback to document date, 0–30, 31–60, 61–90, over-90, not-yet-due and unknown-age opening buckets. Cancelled cheques restore the original debt's age.
- General ledger/trial balance/balance sheet carry prior balance-sheet balances and close prior income/expenses to retained earnings. P&L uses the requested period only.
- Deferred automatic posting sees completed invoice lines and stock movements. Sale COGS and purchase raw/resale allocation are included. New purchase inventory cost excludes trade discounts.
- Returns reference original invoice lines, preserve the original rate, enforce remaining return quantities and support custom items/cross-year returns. Negative-stock updates are rejected atomically.
- Reports paginate beyond the default Data API row cap. Stock reports include inactive products with historical movements.
- Company logo upload and per-client domain checklist in Control; workspace/invoice branding follows the selected company. No per-company tables or deployments.

## Verification

Run `node --test tests/*.test.mjs`, `npx tsc --noEmit` and `npm run build -- --webpack`.

`node scripts/check-connected-accounting.mjs` loads migration
`202609140001_connected_accounting.sql` inside a transaction against the configured
HAE database, creates isolated QA records, verifies posting and totals, and always
rolls back. It briefly takes schema locks; use a quiet period. It does not apply
the migration permanently. The script never prints connection credentials.

Local browser smoke test confirmed company selection and the company-specific
login form. Authenticated report/form/export QA still requires a signed-in session
and the migration on the test database. AG was still shown as setup pending.

## Production release order

1. Confirm HAE/shared-business project `qwxbacfnmumibihffdoj`, not Control. Take and verify a backup of business records, audit logs, schema and Control registry.
2. Use a maintenance window; do not allow concurrent financial edits during journal reconstruction.
3. Apply `202609140001_connected_accounting.sql` transactionally, record its version in migration history, and verify journal debit/credit equality, party closing/opening reconciliation and unchanged source-document totals/counts. Abort/rollback on mismatch. Do not apply this migration to Control.
4. Deploy this application version to the existing Vercel project only after the database migration succeeds. Deploying the new API first will fail because the new columns/RPCs do not yet exist.
5. Verify authenticated company isolation, sale/purchase forms, returns, BS monthly filters, CSV/print output, cash/cheques and Control company setup. Do not use live customer books for disposable QA transactions.

No production migration, git push, DNS change or Vercel deployment is performed
by the rollback test script. Domain DNS targets must come from the actual Vercel
project; adding a Cloudflare CNAME alone does not register the host in Vercel.

## Accounting boundaries requiring review before launch

This release is not an assertion of complete Odoo parity or tax certification.
Have the accountant verify opening balances and chart-of-account mappings against
source records before this becomes the sole book of record.

- FIFO is a **net party** calculation, not explicit invoice-by-invoice payment allocation. Historical opening balances without due dates cannot be assigned a reliable ageing bucket.
- Cash openings currently have no effective-date field; financial reports use the recorded baseline. Existing opening inventory values require accountant reconciliation.
- The stock statement's value uses the current recorded cost and is labelled an estimate, not an audited historical valuation. Historical weighted-average cost replay, lot valuation and backdated cost restatement need a separate valuation design.
- Existing invoice edits/receipt attribution and period reopening workflows predate this release; the new invoice wrapper is atomic, but a full system-wide transaction/idempotency audit is still required.
- Large operational pickers/recent lists still have limits; report exports are paginated. A searchable/paginated return-source picker is a follow-up for large datasets.
- A tested off-site backup schedule and restore drill remain necessary. A shared-database full restore can affect all tenants; first restore into a separate recovery project.

## Reference structure

The report grouping follows the distinction between journal entries, general
ledger, trial balance and aged balances in
[Odoo accounting reports](https://www.odoo.com/documentation/17.0/applications/finance/accounting/reporting.html),
and financial-year carry-forward in
[Odoo year-end guidance](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/year_end.html).
Document classes organize all recorded transactions; they do not hide sales or
decide whether a transaction is legally exempt. Review statutory filing with
the accountant using [Nepal IRD guidance](https://ird.gov.np/faq/).
