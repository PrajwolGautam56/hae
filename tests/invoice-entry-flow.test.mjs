import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const compile = code => import(`data:text/javascript;base64,${Buffer.from(transpile(code)).toString('base64')}`);
const { continueSalesEntry, nextInvoicePreview } = await compile(await source('lib/invoice-entry-flow.ts'));
const { accountingMutationResponse } = await compile(await source('lib/mutation-response.ts'));

test('only a new sale continues into another invoice', () => {
  assert.equal(continueSalesEntry('sale', ''), true);
  assert.equal(continueSalesEntry('sale', 'existing-id'), false);
  for (const type of ['purchase', 'payment', 'expense', 'party', 'product', null]) {
    assert.equal(continueSalesEntry(type, ''), false);
  }
});

test('next invoice preview advances the committed sequence, not a stale client number', () => {
  assert.equal(nextInvoicePreview(3), 4);
  assert.equal(nextInvoicePreview('12'), 13);
  for (const value of [undefined, null, '', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(nextInvoicePreview(value), null);
  }
});

test('save acknowledgement returns the committed invoice without loading the register', async () => {
  const savedRecord = { id: 'invoice-3', number: 'INV-2083/84-0003', sequence: 3 };
  const result = await accountingMutationResponse('return=minimal', 'fy', () => { throw new Error('Must not load snapshot'); }, savedRecord);
  assert.deepEqual(result.savedRecord, savedRecord);
  assert.equal(result.saved, true);
});

// Exercise the actual page's response-handling code with state setters and network
// effects replaced by a harness; no production database or browser credentials.
const page = await source('app/page.tsx');
const responseHandler = page.slice(page.indexOf('    const data = await response.json();', page.indexOf('const response = await fetch("/api/accounting",')),
  page.indexOf('\n  function openSale()'));
const handlerBody = responseHandler.slice(0, responseHandler.lastIndexOf('\n  }'));
async function runSaveResponse({ type = 'sale', editing = '', ok = true, cancelled = false } = {}) {
  const state = { modal: type, formParty: 'Old party', saleLines: [{ name: 'Old item' }], discountPercent: 10, nextNumbers: { sale: 3, receipt: 7 } };
  const effects = [];
  const context = {
    modal: type, editingVoucherId: editing, kind: 'Invoice', isCancelledSale: cancelled,
    response: { ok, json: async () => ok ? { saved: true, refreshRequired: true, fiscalYearId: 'fy', savedRecord: { sequence: 3, number: '3' } } : { error: 'Stock unavailable' } },
    continueSalesEntry, nextInvoicePreview,
    emptySaleLine: () => ({ name: '', quantity: 1, rate: 0 }),
    clearReportCache() {}, invalidateClientCache() {},
    draftKey: null, clearInvoiceDraft() {},
    refreshSavedAccounting: async () => effects.push('refresh'),
    refreshChequeCounts: async () => {}, applySnapshot() {},
    requestAnimationFrame: callback => callback(),
    invoiceScroll: { current: { scrollTo: () => effects.push('scroll') } },
    salesPartyInput: { current: { focus: () => effects.push('focus') } },
  };
  for (const [, setter] of handlerBody.matchAll(/\b(set[A-Z]\w*)\(/g)) {
    const key = setter[3].toLowerCase() + setter.slice(4);
    context[setter] = value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(context), transpile(handlerBody))(...Object.values(context));
  return { state, effects };
}

test('saved sale keeps the editor open, clears the old draft, focuses party and previews bill 4', async () => {
  const { state, effects } = await runSaveResponse();
  assert.equal(state.modal, 'sale');
  assert.equal(state.formParty, '');
  assert.equal(state.discountPercent, 0);
  assert.deepEqual(state.saleLines, [{ name: '', quantity: 1, rate: 0 }]);
  assert.deepEqual(state.nextNumbers, { sale: 4, receipt: 7 });
  assert.equal(state.lastSavedSale, '3');
  assert.equal(state.dueDate, '');
  assert.equal(state.particulars, '');
  assert.equal(state.phone, '');
  assert.equal('transactionDate' in state, false);
  assert.equal('taxPercent' in state, false);
  assert.equal('billCategory' in state, false);
  assert.deepEqual(effects, ['refresh', 'scroll', 'focus']);
});

test('reserving a cancelled number resets to a normal next bill and preserves the sequence', async () => {
  const {state} = await runSaveResponse({cancelled:true});
  assert.equal(state.modal,'sale');
  assert.equal(state.cancelledSale,false);
  assert.equal(state.nextNumbers.sale,4);
  assert.equal(state.lastSavedSale,null);
  assert.match(state.notice,/Bill #3 cancelled/);
});

test('editing a sale and saving other voucher types still closes the editor', async () => {
  for (const options of [{ editing: 'invoice-3' }, { type: 'payment' }, { type: 'purchase' }]) {
    const { state, effects } = await runSaveResponse(options);
    assert.equal(state.modal, null);
    assert.equal(effects.includes('focus'), false);
  }
});

test('rejected save preserves the draft and number without refreshing or closing', async () => {
  const { state, effects } = await runSaveResponse({ ok: false });
  assert.equal(state.modal, 'sale');
  assert.equal(state.formParty, 'Old party');
  assert.deepEqual(state.saleLines, [{ name: 'Old item' }]);
  assert.equal(state.nextNumbers.sale, 3);
  assert.equal(state.notice, 'Stock unavailable');
  assert.deepEqual(effects, []);
});

test('repeated invoice saves restart a dismissible confirmation while refresh failures stay visible', () => {
  assert.match(page, /setNoticeVersion\(version => version \+ 1\)/);
  assert.match(page, /setNotice\(current => current === notice \? "" : current\)/);
  assert.match(page, /\[notice, noticeVersion\]/);
  assert.match(page, /lastSavedSale === null \|\| snapshotSync !== "idle"/);
  assert.match(page, /setLastSavedSale\(null\)/);
  assert.match(page, /aria-label="Dismiss notification"/);
});
