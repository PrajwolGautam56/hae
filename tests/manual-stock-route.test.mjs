import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import ts from'typescript';
const encode=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const js=async path=>ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const model=encode(await js('lib/manual-stock.ts'));
const adapter=encode(`export const state={role:'admin',calls:[],error:null};export const NextResponse={json:(body,options)=>new Response(JSON.stringify(body),options)};export const requireFeature=async()=>{};export const getBusinessContext=async()=>({company:{id:'company-a'},member:{id:'verified-actor',role:state.role}});export const getSupabaseAdmin=()=>({rpc:async(name,args)=>{state.calls.push({name,args});return{data:state.error?null:{id:'voucher',stockAfter:15},error:state.error};}});`);
const source=(await js('app/api/products/stock/route.ts')).replace(/from "([^"]+)"/g,(match,name)=>`from ${JSON.stringify(name.endsWith('/manual-stock')?model:adapter)}`);
const{POST}=await import(encode(source)),{state}=await import(adapter);
const input={companyId:'company-a',productId:'40000000-0000-4000-8000-000000000001',fiscalYearId:'20000000-0000-4000-8000-000000000001',requestId:'60000000-0000-4000-8000-000000000001',mode:'add',quantity:5,expectedStock:10,expectedCost:100,reason:'Found during physical count',date:'2026-11-26',actorId:'attacker'};
const request=(body=input,origin='https://app.example')=>new Request('https://app.example/api/products/stock',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('manual-stock route rejects role/company/origin violations and derives actor from verified context',async()=>{
 assert.equal((await POST(request(input,'https://foreign.example'))).status,403);state.role='staff';assert.equal((await POST(request())).status,403);state.role='admin';assert.equal((await POST(request({...input,companyId:'other'}))).status,409);assert.equal((await POST(request({...input,quantity:-1}))).status,409);assert.equal(state.calls.length,0);
 assert.equal((await POST(request())).status,201);assert.equal(state.calls[0].name,'record_manual_stock_adjustment');assert.equal(state.calls[0].args.p_company_id,'company-a');assert.equal(state.calls[0].args.p_actor_id,'verified-actor');assert.equal(state.calls[0].args.p_request_id,input.requestId);assert(!('p_unit_cost'in state.calls[0].args));
});
test('definite SQL rollback is distinct from an unknown connection outcome, so clients cannot blindly double-adjust',async()=>{
 state.error={code:'P0001',message:'Stock changed; review again'};let response=await POST(request());assert.equal(response.status,409);assert.equal((await response.json()).outcome,'not_applied');
 state.error={message:'fetch failed'};response=await POST(request());assert.equal(response.status,503);assert.equal((await response.json()).outcome,'uncertain');
 state.error={message:'Could not find record_manual_stock_adjustment in the schema cache'};response=await POST(request());assert.equal(response.status,503);assert.equal((await response.json()).outcome,'not_applied');state.error=null;
});
