import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
async function compile(code){return import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`)}
const {accountingMutationResponse}=await compile(await source('lib/mutation-response.ts'));
test('confirmed save acknowledgement never loads the dashboard or depends on its availability',async()=>{
  let reads=0;
  const result=await accountingMutationResponse('return=minimal','company-fy',()=>{reads++;throw new Error('Dashboard unavailable')});
  assert.deepEqual(result,{saved:true,fiscalYearId:'company-fy',refreshRequired:true});assert.equal(reads,0);
});
test('older clients continue receiving a complete snapshot',async()=>{
  let reads=0;const snapshot={parties:[],transactions:[]};
  assert.equal(await accountingMutationResponse(null,'fy',async()=>{reads++;return snapshot}),snapshot);assert.equal(reads,1);
  await assert.rejects(accountingMutationResponse(null,'fy',async()=>{throw new Error('read failed')}),/read failed/);
});
test('a pre-save read cannot repopulate an invalidated cache or remove a newer inflight read',async()=>{
  const cache=await compile(await source('lib/client-data-cache.ts'));
  const oldFetch=globalThis.fetch;let completeOld,completeNew;let calls=0;
  globalThis.fetch=()=>new Promise(resolve=>{calls++;if(calls===1)completeOld=resolve;else completeNew=resolve;});
  try{
    const old=cache.getCachedJson('reports:qa','/report');
    cache.invalidateClientCache('reports:');
    const fresh=cache.getCachedJson('reports:qa','/report');
    completeOld({ok:true,json:async()=>({amount:1})});await old;
    assert.equal(cache.peekClientCache('reports:qa'),null);
    const shared=cache.getCachedJson('reports:qa','/report');assert.equal(calls,2);
    completeNew({ok:true,json:async()=>({amount:2})});await Promise.all([fresh,shared]);
    assert.deepEqual(cache.peekClientCache('reports:qa'),{amount:2});
  }finally{globalThis.fetch=oldFetch;cache.invalidateClientCache();}
});
test('login resolves company and verifies password concurrently, then still checks membership',async()=>{
  let finishAuth,finishCompany;const calls=[];const cookies=[];
  const memberQuery={select(){return this},eq(){return this},async maybeSingle(){calls.push('membership');return{data:{name:'Test staff',role:'staff',active:true}}}};
  globalThis.__loginPerf={NextResponse:{json(body,options){return{body,status:options?.status||200,cookies:{set:(...args)=>cookies.push(args)}}}},createClient:(_url,key)=>key==='public'?{auth:{signInWithPassword(){calls.push('auth');return new Promise(resolve=>{finishAuth=resolve})}}}:{from:()=>memberQuery},businessAuthConfig:()=>({url:'https://test.invalid',publishableKey:'public',secretKey:'secret'}),COMPANY_COOKIE:'company',loginCompany:async()=>({company:{slug:'test',name:'Test',loginEnabled:true,status:'active'},subscription:{status:'active'}}),resolvePlatformBusinessCompany:()=>{calls.push('company');return new Promise(resolve=>{finishCompany=resolve})}};
  // Inject dependencies without using real credentials or network requests.
  const raw=(await source('app/api/auth/login/route.ts')).replace(/^import .*;\n/gm,'');
  const route=await compile('const {NextResponse,createClient,businessAuthConfig,COMPANY_COOKIE,loginCompany,resolvePlatformBusinessCompany}=globalThis.__loginPerf;\n'+raw);
  const running=route.POST(new Request('https://test.invalid/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'test@example.invalid',password:'test-only',companySlug:'test'})}));
  for(let i=0;i<20&&!finishCompany;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['auth','company']);assert.equal(cookies.length,0);
  finishAuth({data:{session:{access_token:'fake',refresh_token:'fake',expires_in:3600},user:{id:'test',email:'test@example.invalid'}},error:null});
  finishCompany({id:'company-a',name:'Company A'});
  const result=await running;assert.equal(result.status,200);assert.deepEqual(calls,['auth','company','membership']);assert.equal(cookies.length,3);
  delete globalThis.__loginPerf;
});
test('invoice metadata is still in the transactional RPC rather than a duplicate journal-triggering UPDATE',async()=>{
  const sql=await source('supabase/migrations/202609140001_connected_accounting.sql');
  const api=await source('app/api/accounting/route.ts');
  assert.match(sql,/due_date=p_due_date,generated_by=coalesce\(generated_by,p_member_id\),handled_by=coalesce\(handled_by,p_member_id\)/);
  assert.doesNotMatch(api,/const \{ error: attributionError \} = await supabase.from\("vouchers"\).update\(\{ generated_by/);
  assert.match(api,/accountingMutationResponse\(request.headers.get\("prefer"\)/);
});
test('parallel login still denies bad passwords, unlinked companies and inactive memberships',async()=>{
  const raw=(await source('app/api/auth/login/route.ts')).replace(/^import .*;\n/gm,'');
  for(const scenario of ['password','company','membership']){
    const cookies=[];
    globalThis.__loginRejected={NextResponse:{json(body,options){return{body,status:options?.status||200,cookies:{set:(...args)=>cookies.push(args)}}}},createClient:(_url,key)=>key==='public'?{auth:{signInWithPassword:async()=>scenario==='password'?{data:{session:null},error:{message:'Invalid login'}}:{data:{session:{access_token:'fake'},user:{id:'staff'}},error:null}}}:{from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{active:false}})})},businessAuthConfig:()=>({url:'https://test.invalid',publishableKey:'public',secretKey:'secret'}),COMPANY_COOKIE:'company',loginCompany:async()=>({company:{loginEnabled:true,status:'active'},subscription:{status:'active'}}),resolvePlatformBusinessCompany:async()=>scenario==='company'?null:{id:'allowed-company'}};
    const route=await compile(`// ${scenario}\nconst {NextResponse,createClient,businessAuthConfig,COMPANY_COOKIE,loginCompany,resolvePlatformBusinessCompany}=globalThis.__loginRejected;\n`+raw);
    const result=await route.POST(new Request('https://test.invalid/api/auth/login',{method:'POST',body:JSON.stringify({email:'test@example.invalid',password:'test-only',companySlug:'selected'})}));
    assert.equal(result.status,{password:401,company:409,membership:403}[scenario]);assert.equal(cookies.length,0);
  }
  delete globalThis.__loginRejected;
});
