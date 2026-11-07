import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const raw = await readFile(new URL('../lib/invoice-draft.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { invoiceDraftKey, loadInvoiceDraft, saveInvoiceDraft, clearInvoiceDraft } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }; };
const blank = () => ({ formParty:'', partySearch:'', newPartyName:'', place:'', phone:'', taxNo:'', transactionDate:'2026-11-08', dueDate:'', particulars:'', billCategory:'vat', taxPercent:13, discountPercent:0, supplierBillNo:'', saleLines:[{productId:'',name:'',quantity:1,rate:''}] });

test('unfinished invoice survives navigation and stays scoped to company, staff and fiscal year', () => {
  const browser = storage(); const key = invoiceDraftKey('company-a','staff-one','fy-a');
  const draft = { ...blank(), partySearch:'AP Trad', particulars:'Sales subject', saleLines:[{productId:'',name:'Oil',quantity:2,rate:100}] };
  saveInvoiceDraft(key,draft,browser);
  assert.deepEqual(loadInvoiceDraft(key,browser),draft);
  assert.equal(loadInvoiceDraft(invoiceDraftKey('company-b','staff-one','fy-a'),browser),null);
  assert.equal(loadInvoiceDraft(invoiceDraftKey('company-a','staff-two','fy-a'),browser),null);
  assert.equal(loadInvoiceDraft(invoiceDraftKey('company-a','staff-one','fy-b'),browser),null);
  clearInvoiceDraft(key,browser);
  assert.equal(loadInvoiceDraft(key,browser),null);
});

test('empty, malformed and expired drafts are not reopened', () => {
  const browser = storage(); const key=invoiceDraftKey('company-a','staff-one','fy-a');
  saveInvoiceDraft(key,blank(),browser);
  assert.equal(loadInvoiceDraft(key,browser),null);
  browser.setItem(key,JSON.stringify({savedAt:Date.now()-8*24*60*60*1000,draft:{...blank(),particulars:'old'}}));
  assert.equal(loadInvoiceDraft(key,browser),null);
  browser.setItem(key,'not-json');
  assert.equal(loadInvoiceDraft(key,browser),null);
});

test('a rejected save preserves the draft, while confirmed success clears it', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url),'utf8');
  const save = page.slice(page.indexOf('    const draftKey = modal === "sale"'),page.indexOf('    clearReportCache();',page.indexOf('    const draftKey = modal === "sale"')));
  assert.match(save,/saveInvoiceDraft\(draftKey, currentInvoiceDraft\(\)\)/);
  assert.match(save,/response\.status === 401 && modal === "sale"/);
  assert.match(save,/setSessionExpired\(true\)/);
  assert.match(save,/if \(draftKey\) clearInvoiceDraft\(draftKey\)/);
  assert.match(page,/resumeInvoice=1/);
});
