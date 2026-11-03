const PAGE = __REFILL_HTML_JSON__;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const graphVersion = env => env.META_GRAPH_VERSION || 'v24.0';
const redirectUri = url => `${url.origin}/api/meta/callback`;
const cookies = request => Object.fromEntries((request.headers.get('cookie') || '').split(';').flatMap(v => {
  const at = v.indexOf('=');
  if (at < 0) return [];
  try { return [[v.slice(0, at).trim(), decodeURIComponent(v.slice(at + 1))]]; }
  catch { return []; }
}));
const cookie = (name, value, maxAge = 600) => `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/api/meta; Max-Age=${maxAge}`;
const html = (body, status = 200, headers = {}) => new Response(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Refill · Facebook connection</title><style>body{font-family:system-ui;background:#f7f8fc;color:#25304b;margin:0;display:grid;min-height:100vh;place-items:center}.panel{background:#fff;border:1px solid #e9ebf3;border-radius:16px;padding:36px;max-width:540px;box-shadow:0 8px 35px #25304b0a}h1{font-size:24px}p,li{line-height:1.7;color:#667087}a{color:#6755ef}code{background:#f1efff;padding:3px 5px;border-radius:4px}</style></head><body><main class="panel"><div style="font-size:22px;color:#6755ef;font-weight:800">↻ refill.</div>${body}<p><a href="/">← Return to dashboard</a></p></main></body></html>`, {status, headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store',...headers}});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function graph(path, params) {
  const url = new URL(`https://graph.facebook.com/${path}`);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  const response = await fetch(url, {headers:{accept:'application/json'}});
  const body = await response.json().catch(()=>({}));
  if (!response.ok || body.error) throw new Error(body.error?.message || `Meta returned ${response.status}`);
  return body;
}
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
    const url = new URL(request.url);
    if (!env.REORDIA_ADMIN_PASSWORD) return html('<h1>Reordia setup required</h1><p>Set the <code>REORDIA_ADMIN_PASSWORD</code> Worker secret to enable this private workspace.</p>',503);
    if (!await isSignedIn(request, env)) return new Response('Sign in with username admin and your workspace password.', {
      status:401, headers:{'WWW-Authenticate':'Basic realm="Reordia", charset="UTF-8"','Cache-Control':'no-store'}
    });
    if (request.method !== 'GET') return new Response('Method not allowed', {status:405, headers:{Allow:'GET'}});
    if (url.pathname === '/') return new Response(PAGE, {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    if (url.pathname === '/api/meta/status') return json({configured:Boolean(env.META_APP_ID && env.META_APP_SECRET),callback:redirectUri(url),mode:'Connection test only. No Page tokens are retained.'});
    if (url.pathname === '/api/meta/connect') {
      if (!env.META_APP_ID || !env.META_APP_SECRET) return html('<h1>Meta setup required</h1><p>Add <code>META_APP_ID</code> and <code>META_APP_SECRET</code> to the Site environment first. Then configure the callback URL in Meta for Developers.</p>',503);
      const nonce = crypto.randomUUID();
      const auth = new URL(`https://www.facebook.com/${graphVersion(env)}/dialog/oauth`);
      auth.searchParams.set('client_id',env.META_APP_ID);
      auth.searchParams.set('redirect_uri',redirectUri(url));
      auth.searchParams.set('state',nonce);
      auth.searchParams.set('scope','pages_show_list,pages_manage_metadata,pages_messaging');
      auth.searchParams.set('response_type','code');
      return new Response(null,{status:302,headers:{Location:auth.toString(),'Set-Cookie':cookie('refill_meta_state',nonce),'Cache-Control':'no-store'}});
    }
    if (url.pathname === '/api/meta/callback') {
      const state = cookies(request).refill_meta_state;
      const clear = cookie('refill_meta_state','',0);
      if (!state || state !== url.searchParams.get('state')) return html('<h1>Connection rejected</h1><p>The authorization state did not match. Return to Refill and start again.</p>',400,{'Set-Cookie':clear});
      if (url.searchParams.has('error')) return html(`<h1>Permission not granted</h1><p>${escape(url.searchParams.get('error_description')||url.searchParams.get('error'))}</p>`,400,{'Set-Cookie':clear});
      const code = url.searchParams.get('code');
      if (!code) return html('<h1>Missing authorization code</h1>',400,{'Set-Cookie':clear});
      try {
        const token = await graph(`${graphVersion(env)}/oauth/access_token`,{client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,redirect_uri:redirectUri(url),code});
        const result = await graph(`${graphVersion(env)}/me/accounts`,{access_token:token.access_token,fields:'id,name,tasks',limit:'100'});
        const pages = result.data || [];
        return html(`<h1>Facebook authorization succeeded</h1><p>Meta returned ${pages.length} Page${pages.length===1?'':'s'} available to this authorization.</p>${pages.length?`<ul>${pages.map(p=>`<li><strong>${escape(p.name)}</strong> — Page ID ${escape(p.id)}</li>`).join('')}</ul>`:'<p>No Pages were returned. Check your Page access and permissions in Meta Business settings.</p>'}<p><strong>Security:</strong> This test has not stored any user or Page access token, and cannot read ongoing conversations or send reminders yet.</p>`,200,{'Set-Cookie':clear});
      } catch (error) {return html(`<h1>Meta connection failed</h1><p>${escape(error.message)}</p><p>Confirm the App ID, secret, callback URL, and test-user role in Meta.</p>`,502,{'Set-Cookie':clear});}
    }
    return new Response('Not found',{status:404});
  }
};
