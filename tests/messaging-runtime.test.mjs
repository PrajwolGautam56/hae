import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import ts from'typescript';
const js=ts.transpileModule(await readFile('lib/messaging-runtime.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
test('private runtime fallback is service-authenticated, allowlisted, cached and never overwrites explicit environment settings',async()=>{
 const module=await import(`data:text/javascript;base64,${Buffer.from(js+'\n//runtime-cache-test').toString('base64')}`);const oldFetch=globalThis.fetch;const names=['UNIFIED_SUPABASE_URL','UNIFIED_SUPABASE_SECRET_KEY','SMSPASAL_API_KEY','OVERDUE_REMINDERS_ENABLED'];const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{Object.assign(process.env,{UNIFIED_SUPABASE_URL:'https://example.invalid',UNIFIED_SUPABASE_SECRET_KEY:'server-only',OVERDUE_REMINDERS_ENABLED:'false'});delete process.env.SMSPASAL_API_KEY;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.match(url,/rpc\/get_messaging_runtime_config$/);assert.equal(options.headers.apikey,'server-only');return Response.json({SMSPASAL_API_KEY:'vault-test-key',OVERDUE_REMINDERS_ENABLED:'true',otherSecret:'must-not-load'});};
 await Promise.all([module.loadMessagingRuntime(),module.loadMessagingRuntime()]);assert.equal(calls,1);assert.equal(module.messagingValue('SMSPASAL_API_KEY'),'vault-test-key');assert.equal(module.messagingValue('OVERDUE_REMINDERS_ENABLED'),'false');assert.equal(module.messagingValue('otherSecret'),undefined);await module.loadMessagingRuntime();assert.equal(calls,1);
 }finally{globalThis.fetch=oldFetch;for(const key of names){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
test('runtime SQL reads only the messaging allowlist and revokes browser execution',async()=>{
 const sql=await readFile('supabase/migrations/202611170002_private_messaging_runtime.sql','utf8');assert.match(sql,/where name in/);assert.match(sql,/from public,anon,authenticated/);assert.match(sql,/to service_role/);assert.doesNotMatch(sql,/insert into|update public\.parties|alter.*role/i);
});
