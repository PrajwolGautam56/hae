import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{createRequire}from'node:module';import React from'react';import{renderToStaticMarkup}from'react-dom/server';import ts from'typescript';
const require=createRequire(import.meta.url);
async function render(preview){const source=(await readFile('app/product-import-panel.tsx','utf8')).replace(/^import .*\n/gm,'');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const values=[true,{name:'names.xlsx'},'resale_good',preview,false,'','',''];let i=0;const mod={exports:{}};new Function('require','module','exports','useState','useRef',js)(require,mod,mod.exports,()=>[values[i++],()=>{}],React.useRef);return renderToStaticMarkup(React.createElement(mod.exports.default,{companyId:'a',companyName:'Hamro Afno Enterprises',defaultType:'resale_good',onImported:()=>{}}));}
test('actual import JSX keeps the destination, zero-stock warning, preview and confirm control visible',async()=>{
 const html=await render({company:{id:'a',name:'Hamro Afno Enterprises'},newCount:1,existingCount:1,duplicateCount:0,invalidCount:0,rows:[{row:2,name:'Gear Oil - 20 Ltr',status:'new'},{row:3,name:'Existing product',status:'existing',reason:'Already exists; unchanged'}]});
 assert.match(html,/Import into <strong>Hamro Afno Enterprises/);assert.match(html,/zero opening stock/);assert.match(html,/Product Name/);assert.match(html,/Download blank Excel template/);assert.match(html,/Gear Oil - 20 Ltr/);assert.match(html,/Already exists/);assert.match(html,/<button[^>]*class="primary">Import 1 product name<\/button>/);
 const css=await readFile('app/product-import-panel.css','utf8');assert.match(css,/max-height:380px;overflow:auto/);assert.match(css,/@media\(max-width:650px\)/);assert.match(css,/grid-template-columns:1fr/);
});
test('invalid rows disable confirmation; duplicate-only files do not promise another import',async()=>{
 const data={company:{name:'Hamro Afno Enterprises'},newCount:1,existingCount:0,duplicateCount:0,invalidCount:1,rows:[{row:2,name:'Bad row',status:'invalid',reason:'Fix this row'}]};
 const invalid=await render(data);assert.match(invalid,/Nothing has been imported/);assert.match(invalid,/<button[^>]*disabled=""[^>]*>Import 1 product name<\/button>/);
 const duplicate=await render({...data,newCount:0,invalidCount:0,existingCount:1});assert.match(duplicate,/<button[^>]*disabled=""[^>]*>Import 0 product names<\/button>/);
});
