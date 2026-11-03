const workspace = env => env.WORKSPACE_ID || 'jayga';
const version = env => env.META_GRAPH_VERSION || 'v24.0';
const now = () => Math.floor(Date.now() / 1000);
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const text = new TextEncoder();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cookie = (value, age = 600) => `refill_meta_state=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/meta; Max-Age=${age}`;
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json', 'Cache-Control':'no-store'}});
const html = (body, status = 200, extra = {}) => new Response(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Reordia · Facebook Page</title><style>body{font:16px system-ui;background:#f7f8fc;color:#25304b;margin:0;padding:40px 16px}main{max-width:620px;margin:auto;background:white;padding:28px;border-radius:16px}p{line-height:1.6}button,a{display:inline-block;margin:8px 8px 8px 0;padding:10px;color:#3546a0}button{cursor:pointer}small{color:#687087}form{display:inline}</style></head><body><main>${body}<p><a href="/api/meta/connection">Page connection</a><a href="/">Dashboard</a></p></main></body></html>`, {status, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", ...extra}});

function stateCookie(request) {
  const match = (request.headers.get('cookie') || '').match(/(?:^|;\s*)refill_meta_state=([^;]+)/);
  try { return match ? decodeURIComponent(match[1]) : ''; } catch { return ''; }
}
async function hash(value) {
  return encode(await crypto.subtle.digest('SHA-256', text.encode(value)));
}
async function key(env) {
  const bytes = decode(env.PAGE_TOKEN_ENCRYPTION_KEY || '');
  if (bytes.length !== 32) throw new Error('Invalid encryption key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function encrypt(env, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:text.encode(context)}, await key(env), text.encode(value));
  return JSON.stringify({v:1, iv:encode(iv), data:encode(encrypted)});
}
export async function decrypt(env, value, context) {
  const envelope = JSON.parse(value);
  if (envelope.v !== 1) throw new Error('Unsupported encryption version');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:text.encode(context)}, await key(env), decode(envelope.data)));
}
class MetaError extends Error {
  constructor(code) { super('Meta request failed'); this.code = code; }
}
async function graph(env, path, params = {}, accessToken) {
  const url = new URL(`https://graph.facebook.com/${version(env)}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url, {headers:accessToken ? {Authorization:`Bearer ${accessToken}`} : {}, signal:AbortSignal.timeout(15000)});
  const body = await response.json();
  if (!response.ok || body.error) throw new MetaError(body.error?.code);
  return body;
}
async function connection(env) {
  return env.DB.prepare('SELECT workspace_id, page_id, page_name, connected_at, checked_at, status FROM page_connections WHERE workspace_id = ?').bind(workspace(env)).first();
}
function actions() {
  return '<p><a href="/api/meta/connect">Connect or reconnect Facebook Page</a></p>';
}
export async function handleMeta(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/meta/')) return null;
  const configured = Boolean(env.META_APP_ID && env.META_APP_SECRET);
  const storageReady = Boolean(env.DB && env.PAGE_TOKEN_ENCRYPTION_KEY);
  if (!['GET','POST'].includes(request.method)) return new Response('Method not allowed', {status:405});
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) return html('<h1>Request rejected</h1><p>Return to Reordia and try again.</p>',403);
  try {
    if (path === '/api/meta/status' && request.method === 'GET') {
      return json({configured, storageReady, callback:`${url.origin}/api/meta/callback`, connection:storageReady ? await connection(env) : null, mode:'Encrypted Page storage. Messaging is not enabled yet.'});
    }
    if (!storageReady) return html('<h1>Storage setup required</h1><p>Configure the D1 binding and Page token encryption key.</p>',503);
    if (path === '/api/meta/connection' && request.method === 'GET') {
      const page = await connection(env);
      return html(`<h1>Facebook Page connection</h1>${page ? `<h2>${esc(page.page_name)}</h2><p>Page ID: ${esc(page.page_id)}<br>Status: ${esc(page.status)}<br>Saved: ${esc(page.connected_at)}<br>Last checked: ${esc(page.checked_at || 'Not checked yet')}</p><p>The Page token is encrypted and stays on the server.</p><form method="post" action="/api/meta/check"><button>Check connection</button></form><form method="post" action="/api/meta/disconnect"><button>Disconnect Page</button></form>` : '<p>No Page saved yet. Connect Facebook and choose Jayga to remember it.</p>'}${actions()}`);
    }
    if (path === '/api/meta/connect' && request.method === 'GET') {
      if (!configured) return html('<h1>Meta setup required</h1><p>Set META_APP_ID and META_APP_SECRET in Cloudflare.</p>',503);
      await key(env);
      await env.DB.prepare('DELETE FROM meta_sessions WHERE expires_at <= ?').bind(now()).run();
      const nonce = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO meta_sessions (id, workspace_id, kind, expires_at) VALUES (?, ?, ?, ?)').bind(await hash(nonce), workspace(env), 'oauth', now() + 600).run();
      const auth = new URL(`https://www.facebook.com/${version(env)}/dialog/oauth`);
      for (const [name, value] of Object.entries({client_id:env.META_APP_ID,redirect_uri:`${url.origin}/api/meta/callback`,state:nonce,scope:'pages_show_list,pages_manage_metadata,pages_messaging',response_type:'code'})) auth.searchParams.set(name,value);
      return new Response(null,{status:302,headers:{Location:auth.toString(),'Set-Cookie':cookie(nonce),'Cache-Control':'no-store'}});
    }
    if (path === '/api/meta/callback' && request.method === 'GET') {
      const state = stateCookie(request);
      if (!state || state !== url.searchParams.get('state')) return html('<h1>Connection rejected</h1><p>The authorization state did not match.</p>',400,{'Set-Cookie':cookie('',0)});
      const session = await env.DB.prepare("DELETE FROM meta_sessions WHERE id = ? AND workspace_id = ? AND kind = 'oauth' AND expires_at > ? RETURNING id").bind(await hash(state),workspace(env),now()).first();
      if (!session) return html('<h1>Connection expired</h1><p>Start the connection again.</p>',400,{'Set-Cookie':cookie('',0)});
      if (url.searchParams.has('error')) return html('<h1>Facebook permission was not granted</h1>'+actions(),400,{'Set-Cookie':cookie('',0)});
      const code = url.searchParams.get('code');
      if (!code) return html('<h1>Missing authorization code</h1>',400,{'Set-Cookie':cookie('',0)});
      const short = await graph(env,'oauth/access_token',{client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,redirect_uri:`${url.origin}/api/meta/callback`,code});
      const long = await graph(env,'oauth/access_token',{grant_type:'fb_exchange_token',client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,fb_exchange_token:short.access_token});
      if (!long.access_token) throw new Error('Missing user token');
      const pages = [];
      let after;
      for (let i = 0; i < 20; i++) {
        const result = await graph(env,'me/accounts',{fields:'id,name,tasks,access_token',limit:'100',...(after ? {after} : {})},long.access_token);
        pages.push(...(result.data || []).filter(p => p.id && p.access_token));
        if (!result.paging?.next) break;
        after = result.paging.cursors?.after;
        if (!after || i === 19) throw new Error('Page list incomplete');
      }
      if (!pages.length) return html('<h1>No Pages available</h1><p>Check your Page access and permissions, then reconnect.</p>'+actions(),400,{'Set-Cookie':cookie('',0)});
      const nonce = crypto.randomUUID(), id = await hash(nonce);
      const payload = await encrypt(env,JSON.stringify(pages),`${workspace(env)}:selection:${id}`);
      await env.DB.prepare('INSERT INTO meta_sessions (id, workspace_id, kind, payload, expires_at) VALUES (?, ?, ?, ?, ?)').bind(id,workspace(env),'pages',payload,now()+600).run();
      return html(`<h1>Choose the business Page</h1><p>Select Jayga to save its connection. This list expires in 10 minutes.</p><form method="post" action="/api/meta/select"><input type="hidden" name="state" value="${esc(nonce)}">${pages.map(p=>`<p><label><input type="radio" name="page_id" value="${esc(p.id)}" required> ${esc(p.name)} <small>${esc(p.id)}</small></label></p>`).join('')}<button>Save Page connection</button></form>`,200,{'Set-Cookie':cookie(nonce)});
    }
    if (path === '/api/meta/select' && request.method === 'POST') {
      const form = await request.formData();
      const state = stateCookie(request);
      if (!state || form.get('state') !== state) return html('<h1>Selection rejected</h1>',403);
      const id = await hash(state);
      const pending = await env.DB.prepare("DELETE FROM meta_sessions WHERE id = ? AND workspace_id = ? AND kind = 'pages' AND expires_at > ? RETURNING payload").bind(id,workspace(env),now()).first();
      if (!pending) return html('<h1>Selection expired</h1>'+actions(),400,{'Set-Cookie':cookie('',0)});
      const pages = JSON.parse(await decrypt(env,pending.payload,`${workspace(env)}:selection:${id}`));
      const page = pages.find(p=>p.id === form.get('page_id'));
      if (!page) return html('<h1>Page not authorized</h1>'+actions(),403,{'Set-Cookie':cookie('',0)});
      const encrypted = await encrypt(env,page.access_token,`${workspace(env)}:page:${page.id}`);
      await env.DB.prepare(`INSERT INTO page_connections (workspace_id,page_id,page_name,encrypted_token,tasks,connected_at,status) VALUES (?,?,?,?,?,?,'saved')
        ON CONFLICT(workspace_id) DO UPDATE SET page_id=excluded.page_id,page_name=excluded.page_name,encrypted_token=excluded.encrypted_token,tasks=excluded.tasks,connected_at=excluded.connected_at,checked_at=NULL,status='saved'`).bind(workspace(env),page.id,page.name,encrypted,JSON.stringify(page.tasks || []),new Date().toISOString()).run();
      return html(`<h1>${esc(page.name)} connection saved</h1><p>Reordia will remember this Page. Its access token is encrypted in the database. Messenger events and sending come in the next steps.</p>`,200,{'Set-Cookie':cookie('',0)});
    }
    if (path === '/api/meta/check' && request.method === 'POST') {
      const page = await env.DB.prepare('SELECT * FROM page_connections WHERE workspace_id = ?').bind(workspace(env)).first();
      if (!page) return html('<h1>No Page connected</h1>'+actions(),404);
      const token = await decrypt(env,page.encrypted_token,`${workspace(env)}:page:${page.page_id}`);
      try {
        const result = await graph(env,page.page_id,{fields:'id,name'},token);
        if (result.id !== page.page_id) throw new Error('Page mismatch');
        await env.DB.prepare("UPDATE page_connections SET status = 'active', checked_at = ? WHERE workspace_id = ? AND encrypted_token = ?").bind(new Date().toISOString(),workspace(env),page.encrypted_token).run();
        return html(`<h1>${esc(result.name)} connection works</h1><p>Meta accepted the saved Page token. Messaging permissions and delivery will be checked in the next steps.</p>`);
      } catch (error) {
        if (error instanceof MetaError && [190,102,10,200].includes(error.code)) {
          await env.DB.prepare("UPDATE page_connections SET status = 'reconnect_required', checked_at = ? WHERE workspace_id = ? AND encrypted_token = ?").bind(new Date().toISOString(),workspace(env),page.encrypted_token).run();
          return html('<h1>Reconnect your Page</h1><p>Meta rejected the token or its access. Reconnect to renew permission.</p>'+actions(),409);
        }
        return html('<h1>Could not check Meta</h1><p>Your saved connection was kept. Try again later.</p>',502);
      }
    }
    if (path === '/api/meta/disconnect' && request.method === 'POST') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM page_connections WHERE workspace_id = ?').bind(workspace(env)),
        env.DB.prepare('DELETE FROM meta_sessions WHERE workspace_id = ?').bind(workspace(env))
      ]);
      return html('<h1>Page disconnected from Reordia</h1><p>The saved token and pending connections were removed. To revoke the app in Meta too, remove it from Facebook Business Integrations.</p>',200,{'Set-Cookie':cookie('',0)});
    }
    return html('<h1>Route not found</h1>',404);
  } catch {
    return html('<h1>Connection could not be completed</h1><p>Check the Worker storage and Meta settings, then reconnect. Your existing saved Page has been kept.</p>'+actions(),502,{'Set-Cookie':cookie('',0)});
  }
}
