import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202611080001_cancelled_sales_invoices.sql', import.meta.url), 'utf8');
const api = await readFile(new URL('../app/api/accounting/route.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const suite = await readFile(new URL('../app/api/accounting-suite/route.ts', import.meta.url), 'utf8');

test('a new cancelled bill reserves a normal fiscal-year sale number with no financial posting', () => {
  assert.match(migration, /insert into public\.voucher_sequences\(fiscal_year_id,voucher_type,last_number\)/);
  assert.match(migration, /values\(p_fiscal_year_id,'sale',1\)/);
  assert.match(migration, /'sale',n::text,n,p_date,[\s\S]*?'cancelled','non_vat',0,0,0,0,0,0/);
  assert.match(migration, /if new\.document_status='cancelled' then[\s\S]*?delete from public\.journal_entries/);
});

test('cancelling an existing bill is audited, restores stock, and removes both ledgers atomically', () => {
  assert.match(migration, /where id=p_voucher_id and company_id=p_company_id[\s\S]*?for update/);
  assert.match(migration, /if exists\(select 1 from public\.vouchers where source_voucher_id=v\.id\)/);
  assert.match(migration, /insert into public\.voucher_audit_logs\(voucher_id,action,before_data\)/);
  assert.match(migration, /stock_qty=stock_qty-movement\.quantity/);
  assert.match(migration, /delete from public\.stock_movements/);
  assert.match(migration, /delete from public\.ledger_entries/);
  assert.match(migration, /document_status='cancelled'[\s\S]*?total=0/);
  assert.match(migration, /grant execute on function public\.record_cancelled_sales_invoice[\s\S]*?to service_role/);
});

test('the editor and register expose cancelled bills without letting them be reposted', () => {
  assert.match(api, /body\.cancelledSale === true/);
  assert.match(api, /record_cancelled_sales_invoice/);
  assert.match(api, /A cancelled bill cannot be edited or posted again/);
  assert.match(api, /voucher_type,document_status,voucher_no/);
  assert.match(page, /Cancelled bill \/ reserve this invoice number/);
  assert.match(page, /Confirm cancellation/);
  assert.match(page, /document_status === "cancelled" \? "Cancelled" : "Posted"/);
  assert.match(suite, /\.eq\("document_status", "posted"\)\.lte\("voucher_date"/);
});
