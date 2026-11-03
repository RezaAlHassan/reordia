import { handleMeta } from './meta.mjs';
const PAGE = __REFILL_HTML_JSON__;
async function isSignedIn(request, env) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let credentials;
  try { credentials = atob(header.slice(6)); } catch { return false; }
  const expected = `admin:${env.REORDIA_ADMIN_PASSWORD}`;
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(credentials), digest(expected)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
export default {
  async fetch(request, env) {
    if (!env.REORDIA_ADMIN_PASSWORD) return new Response('Set the REORDIA_ADMIN_PASSWORD Worker secret.', {status:503});
    if (!await isSignedIn(request, env)) return new Response('Sign in with username admin and your workspace password.', {
      status:401, headers:{'WWW-Authenticate':'Basic realm="Reordia", charset="UTF-8"','Cache-Control':'no-store'}
    });
    const meta = await handleMeta(request, env);
    if (meta) return meta;
    if (request.method !== 'GET') return new Response('Method not allowed', {status:405, headers:{Allow:'GET'}});
    if (new URL(request.url).pathname === '/') return new Response(PAGE, {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    return new Response('Not found',{status:404});
  }
};
