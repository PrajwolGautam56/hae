import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureHtml, loadTs } from './support/voucher-print-fixture.mjs';
const {amountInWords}=await loadTs('lib/amount-in-words.ts');
test('amount words use lakh/crore and exact displayed paisa',()=>{
  assert.equal(amountInWords(187392.42),'Rupees One Lakh Eighty-Seven Thousand Three Hundred Ninety-Two and Forty-Two Paisa Only');
  assert.equal(amountInWords(0),'Rupees Zero Only');
  assert.equal(amountInWords(.05),'Rupees Zero and Five Paisa Only');
  assert.equal(amountInWords(99999.999),'Rupees One Lakh Only');
  assert.equal(amountInWords(10000000),'Rupees One Crore Only');
  assert.equal(amountInWords(1.005),'Rupees One and One Paisa Only');
  assert.equal(amountInWords(-25.5),'Minus Rupees Twenty-Five and Fifty Paisa Only');
  assert.equal(amountInWords(NaN),'');
});
test('actual invoice JSX prints totals and words independently of the app shell',()=>{
  for(const count of [3,50]){
    const html=fixtureHtml(count);
    assert.match(html,/size:A4 portrait;margin:12mm/);
    assert.match(html,/thead\{display:table-header-group\}/);
    assert.match(html,/voucher-settlement\{break-inside:avoid/);
    assert.match(html,/Rs\. 1,87,392\.42/);
    assert.match(html,/Forty-Two Paisa Only/);
    assert.match(html,new RegExp(`Item ${count} -`));
    assert.doesNotMatch(html,/kritechglobal|modal-backdrop|app-shell|position:fixed/);
  }
});
