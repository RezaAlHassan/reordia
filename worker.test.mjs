import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './dist/server/index.js';

const env = {REORDIA_ADMIN_PASSWORD:'test-only-password', META_APP_ID:'123', META_APP_SECRET:'test-only-secret'};
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
  const response = await worker.fetch(request('/api/meta/connect'), env);
  assert.equal(response.status, 302);
  const auth = new URL(response.headers.get('location'));
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://reordia.example/api/meta/callback');
  assert.ok(auth.searchParams.get('state'));
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const rejected = await worker.fetch(request('/api/meta/callback?state=wrong&code=test', {headers:{...headers, Cookie:'refill_meta_state=%invalid'}}), env);
  assert.equal(rejected.status, 400);
});
test('unknown routes and unsupported methods are rejected', async () => {
  assert.equal((await worker.fetch(request('/missing'), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/meta/connect', {method:'POST'}), env)).status, 405);
});
