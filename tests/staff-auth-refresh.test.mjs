import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (await readFile(new URL('../proxy.ts', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const code = ts.transpileModule('const NextResponse = globalThis.__staffProxyResponse;\n' + source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const cookies = values => {
  const jar = new Map(Object.entries(values));
  return { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), toString: () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ') };
};
const response = (kind, body, status = 200, request) => {
  const setCookies = [];
  return { kind, body, status, request, setCookies, cookies: { set: (...args) => setCookies.push(args) } };
};
globalThis.__staffProxyResponse = {
  next: options => response('next', null, 200, options?.request),
  json: (body, options) => response('json', body, options?.status),
  redirect: location => response('redirect', String(location), 307),
};
const { proxy } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const oldEnv = Object.fromEntries(['UNIFIED_SUPABASE_URL','UNIFIED_SUPABASE_PUBLISHABLE_KEY','UNIFIED_SUPABASE_SECRET_KEY','PLATFORM_CONTROL_ONLY'].map(key => [key, process.env[key]]));
Object.assign(process.env, { UNIFIED_SUPABASE_URL:'https://example.supabase.invalid', UNIFIED_SUPABASE_PUBLISHABLE_KEY:'public-test', UNIFIED_SUPABASE_SECRET_KEY:'secret-test', PLATFORM_CONTROL_ONLY:'false' });
const oldFetch = globalThis.fetch;
function request(cookieValues = {}) {
  const url = 'https://hamro.kritechglobal.com/api/accounting';
  return { url, nextUrl: { pathname:'/api/accounting', search:'' }, headers: new Headers({host:'hamro.kritechglobal.com'}), cookies: cookies({hae_company:'hamro-afno', ...cookieValues}) };
}
function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
function mockNetwork({ authStatus = 200, refreshStatus = 200, member = true, outage = '' } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    if (outage && url.includes(outage)) throw new Error('Temporary network failure');
    if (url.includes('/auth/v1/token')) return refreshStatus === 200 ? json(200,{access_token:'fresh-access',refresh_token:'fresh-refresh',expires_in:3600}) : json(refreshStatus,{error:'expired'});
    if (url.includes('/auth/v1/user')) return options?.headers?.Authorization === 'Bearer fresh-access' || authStatus === 200 ? json(200,{id:'staff-one'}) : json(authStatus,{error:'JWT expired'});
    if (url.includes('/platform_tenants?')) return json(200,[{id:'tenant-one'}]);
    if (url.includes('/companies?')) return json(200,[{id:'company-one'}]);
    if (url.includes('/team_members?')) return json(200,member ? [{id:'member-one'}] : []);
    throw new Error(`Unexpected endpoint ${url}`);
  };
  return calls;
}

test('staff refreshes an expired access token, validates company membership and forwards both cookies', async () => {
  const calls = mockNetwork({authStatus:401});
  const result = await proxy(request({hae_access_token:'expired-access',hae_refresh_token:'old-refresh'}));
  assert.equal(result.kind,'next');
  assert.equal(result.status,200);
  assert.equal(calls.some(call => call.url.includes('/auth/v1/token')),true);
  assert.equal(calls.some(call => call.url.includes('/team_members?') && call.url.includes('company_id=eq.company-one')),true);
  assert.match(result.request.headers.get('cookie'),/hae_access_token=fresh-access/);
  assert.deepEqual(result.setCookies.map(([name]) => name),['hae_access_token','hae_refresh_token','hae_company']);
  assert.equal(result.setCookies[2][2].maxAge,60*60*24*30);
});

test('transient auth outage returns retryable error without deleting the staff session', async () => {
  for (const config of [{authStatus:503},{authStatus:401,refreshStatus:503},{outage:'/auth/v1/user'}]) {
    mockNetwork(config);
    const result = await proxy(request({hae_access_token:'old-access',hae_refresh_token:'old-refresh'}));
    assert.equal(result.status,503);
    assert.equal(result.setCookies.length,0);
  }
});

test('a rotated refresh token is retained when company verification is temporarily unavailable', async () => {
  mockNetwork({authStatus:401,outage:'/companies?'});
  const result = await proxy(request({hae_access_token:'expired-access',hae_refresh_token:'old-refresh'}));
  assert.equal(result.status,503);
  assert.deepEqual(result.setCookies.map(([name]) => name),['hae_access_token','hae_refresh_token','hae_company']);
  assert.equal(result.setCookies[1][1],'fresh-refresh');
});

test('invalid refresh and wrong-company membership fail closed without racing a concurrent successful cookie rotation', async () => {
  for (const config of [{authStatus:401,refreshStatus:400},{authStatus:401,member:false}]) {
    mockNetwork(config);
    const result = await proxy(request({hae_access_token:'expired-access',hae_refresh_token:'old-refresh'}));
    assert.equal(result.status,401);
    assert.equal(result.setCookies.length,0);
  }
});

test.after(() => {
  globalThis.fetch = oldFetch;
  for (const [key, value] of Object.entries(oldEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  delete globalThis.__staffProxyResponse;
});
