import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const helper = await read('lib/invoice-line-entry.ts');
const { invoiceDraftNumber, invalidInvoiceLine } = await import(`data:text/javascript;base64,${Buffer.from(compile(helper)).toString('base64')}`);
const line = patch => ({ productId: '', name: 'Oil', quantity: 1, rate: 100, ...patch });

test('quantity and rate may be cleared and retyped without forcing zero', () => {
  for (const [input, expected] of [['', ''], ['0', 0], ['0.5', 0.5], ['12.25', 12.25]]) {
    assert.equal(invoiceDraftNumber(input), expected);
  }
  let value = invoiceDraftNumber('100');
  value = invoiceDraftNumber('');
  assert.equal(value, '');
  value = invoiceDraftNumber('25');
  assert.equal(value, 25);
});

test('unfinished lines cannot silently become free items or disappear from a bill', () => {
  assert.equal(invalidInvoiceLine([line({ rate: '' })]), 0);
  assert.equal(invalidInvoiceLine([line({ quantity: '' })]), 0);
  assert.equal(invalidInvoiceLine([line({}), line({ quantity: 0 })]), 1);
  assert.equal(invalidInvoiceLine([line({ name: '' })]), 0);
  for (const patch of [{ rate: -1 }, { quantity: -1 }, { rate: Infinity }, { quantity: NaN }]) {
    assert.equal(invalidInvoiceLine([line(patch)]), 0);
  }
  assert.equal(invalidInvoiceLine([line({ rate: 0 }), line({ quantity: 0.001 }), line({ name: '', rate: '' })]), -1);
});

test('adding a row queues focus until the new name input is mounted', async () => {
  const page = await read('app/page.tsx');
  const addBody = page.match(/function addSaleLine\(\) \{([\s\S]*?)\n  \}/)[1];
  const effectBody = page.match(/useEffect\(\(\) => \{\n    const index = pendingLineFocus.current;([\s\S]*?)\n  \}, \[saleLines\]\)/)[1];
  let rows = [line({})];
  let focused = null;
  const pendingLineFocus = { current: null };
  const lineNameInputs = { current: [{ focus: () => { focused = 0; } }] };
  new Function('pendingLineFocus', 'saleLines', 'setSaleLines', 'emptySaleLine', compile(addBody))(
    pendingLineFocus, rows, updater => { rows = updater(rows); }, () => line({ name: '', rate: '' }),
  );
  assert.equal(rows.length, 2);
  assert.equal(pendingLineFocus.current, 1);
  assert.equal(focused, null);
  lineNameInputs.current.push({ focus: () => { focused = 1; } });
  const runEffect = new Function('pendingLineFocus', 'lineNameInputs', compile('const index = pendingLineFocus.current;' + effectBody));
  runEffect(pendingLineFocus, lineNameInputs);
  assert.equal(focused, 1);
  assert.equal(pendingLineFocus.current, null);
  focused = null;
  runEffect(pendingLineFocus, lineNameInputs);
  assert.equal(focused, null, 'typing later must not steal focus');
  assert.match(page, /className="invoice-item-number">Item \{index \+ 1\}/);
  assert.match(page, /className="add-line"\s+onClick=\{addSaleLine\}/);
  assert.match(page, /lineNameInputs.current\[index\] = element/);
});
