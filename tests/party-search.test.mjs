import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/party-search.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { matchingParties } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const parties = ['AP Traders', 'Apex Oil', 'Butwal AP Traders', 'Alpha Supply', 'Himalaya Trading'].map((name, id) => ({ id, name }));

test('party lookup finds existing names from their first letters, ignoring case and whitespace', () => {
  assert.deepEqual(matchingParties(parties, ' ap ').map(p => p.name), ['AP Traders', 'Apex Oil', 'Butwal AP Traders']);
  assert.deepEqual(matchingParties(parties, 'BUT').map(p => p.name), ['Butwal AP Traders']);
  assert.deepEqual(matchingParties(parties, 'oil').map(p => p.name), ['Apex Oil']);
  assert.deepEqual(matchingParties(parties, 'zz'), []);
});

test('short search results are capped, retain full party objects and do not alter the source list', () => {
  const before = [...parties];
  assert.deepEqual(matchingParties(parties, '', 2), parties.slice(0, 2));
  assert.deepEqual(matchingParties(parties, 'a', 2), parties.slice(0, 2));
  assert.deepEqual(parties, before);
});

test('invoice picker requires an explicit existing-party selection and supports keyboard plus instant creation', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /role="combobox"/);
  assert.match(page, /aria-autocomplete="list"/);
  assert.match(page, /setPartySearch\(event.target.value\); setFormParty\(""\)/);
  assert.match(page, /event.key === "ArrowDown"/);
  assert.match(page, /event.key === "Enter" && partyPickerOpen/);
  assert.match(page, /chooseExistingParty\(partyMatches\[option\].name\)/);
  assert.match(page, /onClick=\{chooseNewParty\}/);
  assert.match(page, /setPartySearch\(detail.parties\?\.name\|\|""\)/);
  assert.match(page, /setPartySearch\(""\)/);
});
