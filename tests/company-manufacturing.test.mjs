import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const encode=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const js=async path=>ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const model=encode(await js('lib/company-manufacturing.ts'));
const {companyManufacturingPolicy:policy,changedManufacturingLimits:change,manufacturingOverride:override}=await import(model);
const companyA='20000000-0000-4000-8000-000000000001',companyB='20000000-0000-4000-8000-000000000002';

test('company manufacturing inherits the existing plan, never bypasses it and isolates sibling companies',()=>{
 const rows=[{tenant_id:'tenant-a',feature_key:'manufacturing',enabled:true,limits:{company_overrides:{[companyA]:false,[companyB]:true}}}];
 assert.deepEqual(policy(rows,'tenant-a','hamro',companyA),{clientEnabled:true,override:false,enabled:false});
 assert.equal(policy(rows,'tenant-a','hamro',companyB).enabled,true);
 assert.equal(policy([{...rows[0],enabled:false}],'tenant-a','hamro',companyB).enabled,false);
 assert.equal(policy(rows,'other-tenant','other',companyB).enabled,false);
 assert.equal(policy([],'tenant-a','hamro',companyA).enabled,true);
 assert.equal(policy([],'other-tenant','abc',companyA).enabled,false);
 assert.equal(policy([{feature_key:'accounting',enabled:true}],'tenant-a','hamro',companyA).enabled,false);
});
test('overrides preserve unrelated limits and siblings; malformed access data fails closed',()=>{
 const before={max_batches:50,company_overrides:{[companyA]:false,[companyB]:true}};
 const after=change(before,companyA,true);
 assert.equal(before.company_overrides[companyA],false);
 assert.equal(after.max_batches,50);assert.equal(after.company_overrides[companyB],true);
 const inherited=change(after,companyA,null);
 assert.equal(override(inherited,companyA),null);assert.equal(override(inherited,companyB),true);
 for(const limits of [[],false,{company_overrides:[]},{company_overrides:{[companyA]:'true'}}])assert.equal(override(limits,companyA),false);
 assert.throws(()=>change({company_overrides:[]},companyA,true),/review/);
});

const accessAdapter=encode(`
 export const state={slug:'a',fresh:[],registry:{entitlements:{manufacturing:true,accounting:true},companies:[{slug:'a',status:'active',loginEnabled:true,manufacturingEnabled:false},{slug:'b',status:'active',loginEnabled:true,manufacturingEnabled:true}],subscription:{status:'active',expiresOn:null}}};
 export const headers=async()=>({get:()=> 'hamro.kritechglobal.com'});
 export const cookies=async()=>({get:()=>({value:state.slug})});
 export const COMPANY_COOKIE='hae_company';
 export const companiesForHost=async(host,fresh)=>{state.fresh.push(fresh);return state.registry};
 export const NextResponse={json:(body,options)=>new Response(JSON.stringify(body),options)};
`);
const adaptedAccess=(await js('lib/feature-access.ts')).replace(/from "[^"]+"/g,`from ${JSON.stringify(accessAdapter)}`);
const {requireFeature}=await import(encode(adaptedAccess)),{state:access}=await import(accessAdapter);
test('server manufacturing permission reads a fresh registry and denies disabled/missing companies',async()=>{
 await assert.rejects(requireFeature('manufacturing'),/disabled for this company/);
 access.slug='b';await requireFeature('manufacturing');assert.equal(access.fresh.at(-1),true);
 access.slug='unknown';await assert.rejects(requireFeature('manufacturing'),/active company/);
 access.slug='b';access.registry.companies[1].manufacturingEnabled=undefined;await assert.rejects(requireFeature('manufacturing'),/disabled/);
 access.registry.companies[1].manufacturingEnabled=true;access.registry.entitlements.manufacturing=false;await assert.rejects(requireFeature('manufacturing'),/subscription/);
 access.registry.entitlements.manufacturing=true;access.registry.subscription.expiresOn='2000-01-01';await assert.rejects(requireFeature('manufacturing'),/expired/);
 access.registry.subscription.expiresOn=null;await requireFeature('accounting');assert.equal(access.fresh.at(-1),false);
});
const publicSource=(await js('app/api/platform/companies/route.ts')).replace(/from "[^"]+"/g,`from ${JSON.stringify(accessAdapter)}`);
const {GET:capabilities}=await import(encode(publicSource));
test('public capabilities reflect only selected company, never expose private policy',async()=>{
 access.slug='a';let response=await capabilities(new Request('https://hamro.kritechglobal.com/api/platform/companies'));
 let body=await response.json();assert.equal(body.entitlements.manufacturing,false);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal('manufacturingEnabled' in body.companies[0],false);
 access.slug='b';body=await (await capabilities(new Request('https://hamro.kritechglobal.com/api/platform/companies'))).json();assert.equal(body.entitlements.manufacturing,true);
});

const adminAdapter=encode(`
 export const state={role:'operator',authenticated:true,rows:[],writes:[],audits:[],casFailure:false,cacheClears:0};
 const company={id:${JSON.stringify(companyA)},tenant_id:'tenant-a',name:'Trading company'};
 export const NextResponse={json:(body,options)=>new Response(JSON.stringify(body),options)};
 function query(table){let operation='select',record,filters=[];const q={
 select(){return q},eq(key,value){filters.push([key,value]);return q},single(){return q},maybeSingle(){return q},
 update(value){operation='update';record=value;return q},insert(value){operation='insert';record=value;return q},
 then(resolve,reject){try{
 if(operation==='select')return Promise.resolve({data:table==='platform_companies'?company:table==='platform_tenants'?{slug:'hamro'}:structuredClone(state.rows),error:null}).then(resolve,reject);
 state.writes.push({table,operation,record,filters});
 if(state.casFailure)return Promise.resolve({data:null,error:null}).then(resolve,reject);
 const current=state.rows.find(row=>row.feature_key==='manufacturing');
 if(operation==='update')Object.assign(current,record);else state.rows.push(record);
 return Promise.resolve({data:{tenant_id:'tenant-a'},error:null}).then(resolve,reject);
 }catch(error){return Promise.reject(error).then(resolve,reject)}}};return q;}
 export const authorizePlatformAdmin=async()=>({db:{from:query},admin:state.authenticated?{id:'verified-admin',role:state.role}:null});
 export const canManage=admin=>['super_admin','operator'].includes(admin.role);
 export const canManageAdmins=admin=>admin.role==='super_admin';
 export const writePlatformAudit=async(db,admin,request,input)=>state.audits.push(input);
 export const clearRegistryCache=()=>{state.cacheClears++};
 export const sendTeamEmail=()=>{};export const getUnifiedAdmin=()=>{};export const createTemporaryPassword=()=>{};
`);
const adminSource=(await js('app/api/platform/admin/route.ts')).replace(/from "([^"]+)"/g,(match,name)=>`from ${JSON.stringify(name.endsWith('/company-manufacturing')?model:adminAdapter)}`);
const {POST}=await import(encode(adminSource)),{state:admin}=await import(adminAdapter);
const request=(body={},origin='https://admin.kritechglobal.com')=>new Request('https://admin.kritechglobal.com/api/platform/admin',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({action:'setCompanyManufacturing',companyId:companyA,enabled:false,expectedOverride:null,...body})});
function reset(){Object.assign(admin,{role:'operator',authenticated:true,rows:[{tenant_id:'tenant-a',feature_key:'manufacturing',enabled:true,updated_at:'prior',limits:{max_batches:50,company_overrides:{[companyB]:true}}}],writes:[],audits:[],casFailure:false,cacheClears:0});}
test('actual platform action requires admin authority and same origin, validates inputs and parent plan',async()=>{
 reset();admin.authenticated=false;assert.equal((await POST(request())).status,401);
 admin.authenticated=true;admin.role='viewer';assert.equal((await POST(request())).status,403);
 admin.role='operator';assert.equal((await POST(request({},'https://foreign.example'))).status,403);
 assert.equal((await POST(request({enabled:'true'}))).status,400);
 assert.equal((await POST(request({companyId:'invalid'}))).status,400);
 admin.rows[0].enabled=false;assert.equal((await POST(request({enabled:true}))).status,409);
 assert.equal(admin.writes.length,0);
});
test('actual platform action scopes by database company tenant, audits and preserves sibling policy',async()=>{
 reset();let response=await POST(request({tenantId:'attacker-tenant'}));assert.equal(response.status,200);
 assert.equal(admin.rows[0].limits.company_overrides[companyA],false);assert.equal(admin.rows[0].limits.company_overrides[companyB],true);assert.equal(admin.rows[0].limits.max_batches,50);
 assert(admin.writes[0].filters.some(([key,value])=>key==='tenant_id'&&value==='tenant-a'));
 assert(admin.writes[0].filters.some(([key,value])=>key==='updated_at'&&value==='prior'));
 assert.deepEqual(admin.audits.map(row=>row.action),['company_manufacturing_requested','company_manufacturing']);assert.equal(admin.cacheClears,1);
 response=await POST(request());assert.equal(response.status,200);assert.equal(admin.writes.length,1);
 response=await POST(request({enabled:null,expectedOverride:false}));assert.equal(response.status,200);assert.equal(override(admin.rows[0].limits,companyA),null);assert.equal(override(admin.rows[0].limits,companyB),true);
});
test('stale and concurrent writes cannot silently overwrite company permissions',async()=>{
 reset();assert.equal((await POST(request({expectedOverride:true}))).status,409);assert.equal(admin.writes.length,0);
 admin.casFailure=true;assert.equal((await POST(request())).status,409);assert.equal(override(admin.rows[0].limits,companyA),null);assert.equal(admin.cacheClears,0);
 reset();admin.rows=[];assert.equal((await POST(request())).status,200);assert.equal(admin.rows[0].enabled,true);assert.equal(override(admin.rows[0].limits,companyA),false);
});

const require=createRequire(import.meta.url);
async function controlHtml(props){
 const source=(await readFile('app/company-manufacturing-control.tsx','utf8')).replace(/^import.*\n/gm,'');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const mod={exports:{}};new Function('require','module','exports','useState','useRef','useEffect',compiled)(require,mod,mod.exports,React.useState,React.useRef,()=>{});
 return renderToStaticMarkup(React.createElement(mod.exports.default,{companyId:companyA,companyName:'Trading Company',clientEnabled:true,override:null,canManage:true,onSaved:()=>{},...props}));
}
test('real control renders explicit company-only enable/disable and cannot submit outer company form',async()=>{
 const html=await controlHtml();assert.match(html,/Manufacturing · Trading Company/);assert.match(html,/Enable manufacturing/);assert.match(html,/Disable manufacturing · trading only/);assert.match(html,/Existing bills, products, stock and production history are retained/);assert.match(html,/<button type="button">Save manufacturing access/);
 const blocked=await controlHtml({clientEnabled:false});assert.match(blocked,/<option value="true" disabled=""/);assert.match(blocked,/Client → Subscription/);
 assert.match(await controlHtml({canManage:false}),/<button type="button" disabled=""/);
 const page=await readFile('app/platform-admin/page.tsx','utf8');assert.match(page,/<th>Manufacturing<\/th>/);assert.match(page,/<CompanyManufacturingControl companyId=\{company.id\}/);
 const manufacturing=await readFile('app/api/manufacturing/route.ts','utf8');assert.equal((manufacturing.match(/requireFeature\("manufacturing"\)/g)||[]).length,2);
 const accounting=await readFile('app/api/accounting-suite/route.ts','utf8');assert.match(accounting,/\["save_bom", "bom_production"\].*requireFeature\("manufacturing"\)/);
});
