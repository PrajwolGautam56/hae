import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
async function load(name) { const code = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText; return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`); }
const { documentTotals, commercialInput } = await load('commercial-documents');
const { taskInput, taskLocalDateTime } = await load('task-workflow');
const { commercialPrintHtml } = await load('commercial-print');
const input = { documentType: 'quotation', recipientName: 'ABC Trading', date: '2026-09-26', taxMode: 'exclusive', taxPercent: 13, discountPercent: 10, lines: [{ description: 'Gear oil', quantity: 2, rate: 100, unit: 'litre' }] };
test('quotation VAT inclusive, exclusive and none with discount reconcile', () => {
  assert.deepEqual(documentTotals(input.lines, 10, 13, 'exclusive'), { subtotal: 200, discount: 20, taxable: 180, tax: 23.4, total: 203.4 });
  assert.deepEqual(documentTotals([{ ...input.lines[0], quantity: 1, rate: 113 }], 0, 13, 'inclusive'), { subtotal: 113, discount: 0, taxable: 100, tax: 13, total: 113 });
  assert.equal(documentTotals(input.lines, 0, 13, 'none').total, 200);
});
test('document inputs reject invalid dates, quantities, VAT and missing recipient', () => {
  assert.equal(commercialInput(input).recipientName, 'ABC Trading');
  for (const patch of [{recipientName:''},{date:'2026-02-31'},{taxPercent:Infinity},{discountPercent:101},{taxMode:'hidden'},{lines:[]},{lines:[{description:'Oil',quantity:-1,rate:5}]}]) assert.throws(() => commercialInput({...input,...patch}));
});
test('task inputs accept reopening and optional dates but reject invalid assignments and status', () => {
  assert.equal(taskInput({title:'Call',dueAt:'2026-09-26T09:00'}).dueAt,'2026-09-26T03:15:00.000Z');
  assert.equal(taskLocalDateTime('2026-09-25T23:30:00Z'),'2026-09-26T05:15');
  assert.equal(taskInput({ title:' Call ', status:'in_progress' }).title,'Call');
  assert.equal(taskInput({ title:'Reopen', status:'todo' }).status,'todo');
  for(const patch of [{title:''},{status:'fake'},{dueAt:'bad'},{leadId:'a',partyId:'b'},{priority:'random'}]) assert.throws(()=>taskInput({title:'Valid',...patch}));
});
test('print template preserves company-specific details, blank PAN and escapes markup', () => {
  const html = commercialPrintHtml({ document_type:'quotation',sequence_no:1,payload:{...input,...documentTotals(input.lines,10,13,'exclusive'),issuer:{name:'ABC <script>bad</script>',logo_url:'javascript:alert(1)'},lines:[{...input.lines[0],description:'<img onerror=alert(1)>',amount:200}],terms:'Delivery <script>bad</script>',bankName:'Bank A',bankAccount:'00123'}},'BS date');
  assert.ok(html.includes('ABC &lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(html.includes('00123'));
  assert.ok(html.includes('PAN / VAT: '));
  assert.ok(html.includes('Not a tax invoice'));
  assert.doesNotMatch(html, /<script>|javascript:|<img onerror/);
});
test('document persistence is company scoped, idempotent and does not post ledger or inventory', async () => {
  const sql=await readFile(new URL('../supabase/migrations/202609260001_tasks_and_commercial_documents.sql',import.meta.url),'utf8');
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/unique\(company_id,request_id\)/);
  assert.match(sql,/references public.fiscal_years\(company_id,id\)/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.doesNotMatch(sql,/insert into (vouchers|stock_movements|journal_entries)/i);
});
