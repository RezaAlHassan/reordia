import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './dist/server/index.js';
import { encrypt, decrypt } from './meta.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const env = {REORDIA_ADMIN_PASSWORD:'test-only-password', META_APP_ID:'123', META_APP_SECRET:'test-only-secret'};
function storage() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_page_connections.sql','utf8'));
  const wrap = (sql, args = []) => ({
    bind(...values) { return wrap(sql,values); },
    async first() { return db.prepare(sql).get(...args) || null; },
    async run() { return db.prepare(sql).run(...args); }
  });
  return {...env, PAGE_TOKEN_ENCRYPTION_KEY:btoa('01234567890123456789012345678901'), DB:{prepare:wrap,async batch(statements) { return Promise.all(statements.map(s=>s.run())); }}, raw:db};
}
const headers = {Authorization:`Basic ${btoa('admin:test-only-password')}`};
const request = (path, extra = {}) => new Request(`https://reordia.example${path}`, {headers, ...extra});

test('workspace stays closed until configured and rejects a spoofed old identity header', async () => {
  assert.equal((await worker.fetch(request('/'), {})).status, 503);
  assert.equal((await worker.fetch(request('/', {headers:{'oai-authenticated-user-id':'fake'}}), env)).status, 401);
  assert.equal((await worker.fetch(request('/', {headers:{Authorization:`Basic ${btoa('admin:wrong')}`}}), env)).status, 401);
});
test('serves dashboard and safe server status', async () => {
  assert.equal((await worker.fetch(request('/'), env)).status, 200);
  const response = await worker.fetch(request('/api/meta/status'), env);
  const status = await response.json();
  assert.equal(status.configured, true);
  assert.equal(status.callback, 'https://reordia.example/api/meta/callback');
  assert.ok(!JSON.stringify(status).includes(env.META_APP_SECRET));
});
test('OAuth creates state and rejects callback state mismatches and malformed cookies', async () => {
  const setup = storage();
  const response = await worker.fetch(request('/api/meta/connect'), setup);
  assert.equal(response.status, 302);
  const auth = new URL(response.headers.get('location'));
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://reordia.example/api/meta/callback');
  assert.ok(auth.searchParams.get('state'));
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const rejected = await worker.fetch(request('/api/meta/callback?state=wrong&code=test', {headers:{...headers, Cookie:'refill_meta_state=%invalid'}}), setup);
  assert.equal(rejected.status, 400);
});
test('unknown routes and unsupported methods are rejected', async () => {
  assert.equal((await worker.fetch(request('/missing'), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/meta/connect', {method:'POST'}), env)).status, 403);
});

test('encryption uses fresh IVs and rejects tampering and a different Page context', async () => {
  const setup = storage();
  const a = await encrypt(setup,'secret-page-token','jayga:page:123');
  const b = await encrypt(setup,'secret-page-token','jayga:page:123');
  assert.notEqual(a,b);
  assert.ok(!a.includes('secret-page-token'));
  assert.equal(await decrypt(setup,a,'jayga:page:123'),'secret-page-token');
  await assert.rejects(decrypt(setup,a,'other:page:123'));
  const broken = JSON.parse(a); broken.data = btoa('broken');
  await assert.rejects(decrypt(setup,JSON.stringify(broken),'jayga:page:123'));
});

test('OAuth saves only the selected Page encrypted, supports checking, and disconnects', async () => {
  const setup = storage();
  const original = globalThis.fetch;
  const replies = [
    {access_token:'short-user-token'}, {access_token:'long-user-token'},
    {data:[{id:'123',name:'Jayga',access_token:'page-secret-one',tasks:['MESSAGING']},{id:'456',name:'Other business',access_token:'page-secret-two'}]},
    {id:'123',name:'Jayga'},
    {error:{code:190,message:'do not expose token page-secret-one'}}
  ];
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({url:String(url),init});
    return Response.json(replies.shift());
  };
  try {
    const connect = await worker.fetch(request('/api/meta/connect'),setup);
    const state = new URL(connect.headers.get('location')).searchParams.get('state');
    const callbackRequest = request(`/api/meta/callback?state=${state}&code=authorized`,{headers:{...headers,Cookie:`refill_meta_state=${state}`}});
    const callback = await worker.fetch(callbackRequest,setup);
    const output = await callback.text();
    assert.equal(callback.status,200);
    assert.ok(output.includes('Jayga'));
    assert.ok(!output.includes('page-secret'));
    assert.equal(setup.raw.prepare('SELECT count(*) AS count FROM page_connections').get().count,0);
    assert.ok(!JSON.stringify(setup.raw.prepare('SELECT * FROM meta_sessions').all()).includes('page-secret'));
    assert.equal((await worker.fetch(callbackRequest,setup)).status,400);
    const selectedState = callback.headers.get('set-cookie').split(';')[0].split('=')[1];
    const post = (path, body) => request(path,{method:'POST',headers:{...headers,Origin:'https://reordia.example',Cookie:`refill_meta_state=${selectedState}`},body:new URLSearchParams(body)});
    const select = await worker.fetch(post('/api/meta/select',{state:selectedState,page_id:'123'}),setup);
    assert.equal(select.status,200);
    const saved = setup.raw.prepare('SELECT * FROM page_connections').get();
    assert.equal(saved.page_name,'Jayga');
    assert.equal(await decrypt(setup,saved.encrypted_token,'jayga:page:123'),'page-secret-one');
    assert.ok(!JSON.stringify(saved).includes('page-secret'));
    assert.equal((await worker.fetch(post('/api/meta/select',{state:selectedState,page_id:'123'}),setup)).status,400);
    const status = await (await worker.fetch(request('/api/meta/status'),setup)).text();
    assert.ok(status.includes('Jayga'));
    assert.ok(!status.includes('encrypted_token'));
    assert.ok(!status.includes('page-secret'));
    assert.equal((await worker.fetch(post('/api/meta/check',{}),setup)).status,200);
    assert.equal(calls[3].init.headers.Authorization,'Bearer page-secret-one');
    assert.ok(!calls[3].url.includes('page-secret-one'));
    const expired = await worker.fetch(post('/api/meta/check',{}),setup);
    assert.equal(expired.status,409);
    assert.ok(!(await expired.text()).includes('page-secret'));
    assert.equal(setup.raw.prepare('SELECT status FROM page_connections').get().status,'reconnect_required');
    assert.equal((await worker.fetch(post('/api/meta/disconnect',{}),setup)).status,200);
    assert.equal(setup.raw.prepare('SELECT count(*) AS count FROM page_connections').get().count,0);
  } finally { globalThis.fetch = original; }
});

test('expired authorization and cross-origin changes are rejected', async () => {
  const setup = storage();
  const response = await worker.fetch(request('/api/meta/connect'),setup);
  const state = new URL(response.headers.get('location')).searchParams.get('state');
  setup.raw.exec('UPDATE meta_sessions SET expires_at = 0');
  const callback = await worker.fetch(request(`/api/meta/callback?state=${state}&code=unused`,{headers:{...headers,Cookie:`refill_meta_state=${state}`}}),setup);
  assert.equal(callback.status,400);
  for (const path of ['/api/meta/select','/api/meta/check','/api/meta/disconnect']) {
    assert.equal((await worker.fetch(request(path,{method:'POST',headers:{...headers,Origin:'https://attacker.example'}}),setup)).status,403);
  }
});

test('private routes reject anonymous access and Page metadata is scoped to the workspace', async () => {
  const setup = storage();
  setup.raw.prepare("INSERT INTO page_connections VALUES (?,?,?,?,?,?,?,?)").run('another-business','999','Private other Page','encrypted','[]','2026-11-03',null,'saved');
  const response = await worker.fetch(request('/api/meta/status'),setup);
  assert.equal((await response.json()).connection,null);
  for (const path of ['/api/meta/status','/api/meta/connection','/api/meta/select','/api/meta/disconnect']) {
    const denied = await worker.fetch(request(path,{headers:{}}),setup);
    assert.equal(denied.status,401);
    assert.ok(!(await denied.text()).includes('Private other Page'));
  }
});
