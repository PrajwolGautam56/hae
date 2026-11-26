import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile=async file=>ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const modelUrl=url(await compile('lib/product-name-import.ts'));
const {previewProductNames,newProductNameRows}=await import(modelUrl);
const fileSource=(await compile('lib/product-import-file.ts')).replace('"./product-name-import"',JSON.stringify(modelUrl)).replace('"read-excel-file/node"',JSON.stringify(new URL('../node_modules/read-excel-file/node/index.js',import.meta.url).href));
const {readProductWorkbook,validateProductWorkbookZip}=await import(url(fileSource));
test('one-column product names preserve pack/grade and skip file/existing duplicates including inactive names',()=>{
 const preview=previewProductNames([['Product Name'],[' Gear Oil - 20 Ltr '],['gear oil - 20 ltr'],[],['Paper - 70 GSM'],['तेल १ लिटर']], [{name:'paper - 70 gsm'}]);
 assert.deepEqual({total:preview.total,newCount:preview.newCount,existing:preview.existingCount,duplicate:preview.duplicateCount,invalid:preview.invalidCount},{total:4,newCount:2,existing:1,duplicate:1,invalid:0});
 assert.equal(preview.rows[0].row,2);assert.equal(preview.rows[0].name,'Gear Oil - 20 Ltr');
 const rows=newProductNameRows('company-a','resale_good',preview.rows);assert.equal(rows.length,2);
 for(const row of rows){assert.equal(row.company_id,'company-a');assert.equal(row.stock_qty,0);assert.equal(row.sale_price,0);assert.equal(row.purchase_price,0);assert.equal(row.mrp,0);assert.equal(row.unit,'pcs');assert.equal(row.item_type,'resale_good');}
 assert.throws(()=>newProductNameRows('a','unsupported',preview.rows),/type/);
});
test('blank sheets, oversized batches, numeric cells, extra columns and formulas cannot silently import',()=>{
 assert.throws(()=>previewProductNames([['Product Name']],[]),/Add product names/);
 assert.throws(()=>previewProductNames(Array.from({length:1001},(_,i)=>['Item '+i]),[]),/1000/);
 assert.throws(()=>previewProductNames([['Product Name','Price'],['Oil',25]],[]),/one Product Name/);
 const preview=previewProductNames([['Name'],[25],['Oil',10],['='.repeat(5)],['x'.repeat(251)],['\u0000bad']],[]);
 assert.equal(preview.invalidCount,5);assert.throws(()=>newProductNameRows('a','resale_good',preview.rows),/Fix invalid/);
 assert.equal(previewProductNames([['Oil'],['Grease']],[]).newCount,2);
});
test('real XLSX reader handles the supplied template and fixture, rejecting non-XLSX, damaged or oversized archives',async()=>{
 const fixture=await readFile('tests/fixtures/product-name-import.xlsx');
 const rows=await readProductWorkbook(new File([fixture],'products.xlsx'));
 const preview=previewProductNames(rows,[{name:'Paper - 70 GSM'}]);assert.equal(preview.newCount,2);assert.equal(preview.existingCount,1);assert.equal(preview.duplicateCount,1);
 const template=await readProductWorkbook(new File([await readFile('public/templates/product-names.xlsx')],'template.xlsx'));
 assert.deepEqual(template,[['Product Name']]);
 await assert.rejects(readProductWorkbook(new File([fixture],'old.xls')),/xlsx/);
 await assert.rejects(readProductWorkbook(new File(['not an archive'],'fake.xlsx')),/valid/);
 assert.throws(()=>validateProductWorkbookZip(Buffer.alloc(2*1024*1024+1)),/2 MB/);
 const expanded=Buffer.from(fixture);const entry=expanded.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert(entry>0);expanded.writeUInt32LE(17*1024*1024,entry+24);assert.throws(()=>validateProductWorkbookZip(expanded),/Expanded workbook/);
});

const adapter=url(`export const state={role:'admin',company:'a',input:[['Product Name'],['Existing'],['Gear Oil - 20 Ltr']],writes:0,stock:[{id:'old-a',company_id:'a',name:'Existing',stock_qty:77,sale_price:900,item_type:'finished_good'},{id:'old-b',company_id:'b',name:'Gear Oil - 20 Ltr',stock_qty:42,sale_price:400}]};export const NextResponse={json:(body,options)=>new Response(JSON.stringify(body),options)};export const requireFeature=async feature=>{if(feature!=='inventory')throw Error('Wrong entitlement');};export const getBusinessContext=async()=>({company:{id:state.company,name:'Company '+state.company},member:{role:state.role}});export const readProductWorkbook=async()=>state.input;export const allReportRows=async query=>state.stock.filter(row=>row.company_id===query.company);export const getSupabaseAdmin=()=>({from:table=>{if(table!=='products')throw Error('Financial table touched');const query={select:()=>query,eq:(column,value)=>{if(column!=='company_id')throw Error('Wrong scope');query.company=value;return query;},order:()=>query,upsert:(rows,options)=>{if(options.onConflict!=='company_id,name'||options.ignoreDuplicates!==true)throw Error('Unsafe upsert');return{select:async()=>{state.writes++;const inserted=[];for(const row of rows)if(!state.stock.some(old=>old.company_id===row.company_id&&old.name===row.name)){state.stock.push({...row,id:'new-'+state.stock.length});inserted.push({id:state.stock.at(-1).id});}return{data:inserted,error:null};}};}};return query;}});`);
const routeSource=(await compile('app/api/products/import/route.ts')).replace(/from "([^"]+)"/g,(match,name)=>name==='node:crypto'?match:`from ${JSON.stringify(name.endsWith('/product-name-import')?modelUrl:adapter)}`);
const {POST}=await import(url(routeSource)),{state}=await import(adapter);
function request(action,hash,options={}){const form=new FormData();form.set('action',action);form.set('file',new File(['fixture'],'names.xlsx'));form.set('productType','resale_good');form.set('companyId',options.companyId||state.company);if(hash)form.set('previewHash',hash);return new Request('https://company.example/api/products/import',{method:'POST',headers:{Origin:options.origin||'https://company.example'},body:form});}
test('actual import route previews without writes, commits only zero-stock names and safely replays without overwriting',async()=>{
 const old=JSON.stringify(state.stock);const response=await POST(request('preview'));assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.newCount,1);assert.equal(preview.existingCount,1);assert.equal(state.writes,0);assert.equal(JSON.stringify(state.stock),old);
 const saved=await POST(request('import',preview.previewHash));assert.equal(saved.status,201);assert.deepEqual(await saved.json(),{created:1,skipped:1,total:2,companyId:'a',stockChanged:false});
 assert.equal(state.stock[0].stock_qty,77);assert.equal(state.stock[0].sale_price,900);assert.equal(state.stock[0].item_type,'finished_good');assert.equal(state.stock[1].stock_qty,42);assert.equal(state.stock.at(-1).stock_qty,0);
 const replay=await POST(request('import',preview.previewHash));assert.equal((await replay.json()).created,0);assert.equal(state.stock.length,3);
});
test('actual import route rejects foreign origins, staff writers, company switches, changed previews and invalid rows before writing',async()=>{
 const before=state.writes;
 assert.equal((await POST(request('preview',null,{origin:'https://attacker.example'}))).status,403);
 state.role='staff';assert.equal((await POST(request('preview'))).status,403);state.role='admin';
 assert.equal((await POST(request('preview',null,{companyId:'other'}))).status,409);
 assert.equal((await POST(request('import','forged'))).status,409);
 const original=state.input;const valid=await(await POST(request('preview'))).json();state.input=[['Product Name'],['Changed']];assert.equal((await POST(request('import',valid.previewHash))).status,409);
 state.input=[['Product Name'],['Invalid',50]];const invalid=await(await POST(request('preview'))).json();assert.equal(invalid.invalidCount,1);assert.equal((await POST(request('import',invalid.previewHash))).status,400);
 state.input=original;assert.equal(state.writes,before);
});
test('stock register loads all product pages and exposes generic import in the correct company',async()=>{
 const source=await readFile('app/api/accounting/route.ts','utf8');assert.match(source,/allReportRows\(supabase\s*\.from\("products"\)/);
 const ui=await readFile('app/product-import-panel.tsx','utf8');assert.match(ui,/zero opening stock/);assert.match(ui,/Preview product names/);assert.match(ui,/companyId/);assert.doesNotMatch(ui,/Hydra|Ruchira|Crayon|Loaded/);
});
