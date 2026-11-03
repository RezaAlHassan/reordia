# Reordia on Cloudflare Workers

The Worker serves the dashboard and handles `/api/meta/status`,
`/api/meta/connect`, and `/api/meta/callback` on the server.

## Deploy

```powershell
npm ci
npx wrangler login
npm run check
npm test
npm run deploy
npm run secrets
```

The first deploy creates the `reordia` Worker. It returns HTTP 503 until
`REORDIA_ADMIN_PASSWORD` is set. The secrets command reads the private `env`
file, creates a random password if needed, writes the ignored `.dev.vars`
file, and uploads non-empty values. It does not print secret values.

Open `env` to find the workspace password. The username is `admin`.
The browser asks for these credentials when you open the Worker URL.
This shared password protects the connection test. A multi-business product
still needs separate user accounts and sessions.

Alternatively, configure these Worker runtime secrets directly in Cloudflare:

- `REORDIA_ADMIN_PASSWORD`: the workspace password
- `META_APP_ID`: your Meta App ID
- `META_APP_SECRET`: your Meta App Secret

Deploy the settings change if the dashboard requires it. Local `env` changes
are not uploaded automatically; run `npm run secrets` again to upload them.
Never commit `env` or `.dev.vars` or put secrets in `wrangler.jsonc`.

## Cloudflare Git builds

Connect `RezaAlHassan/reordia`, choose branch `main`, and use the repository
root. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
Set the runtime secrets above separately from deployment credentials.

`wrangler.jsonc` points to `dist/server/index.js`. The build embeds the dashboard
in the Worker, so all routes use the server handler. No static assets directory
is exposed. The old `hosting.json` is not used by Cloudflare.

## Meta configuration

1. Copy the HTTPS Worker URL printed after deployment.
2. Register `https://YOUR-WORKER-HOST/api/meta/callback` as the exact valid
   OAuth redirect URI in your Meta app's login settings.
3. Configure Messenger and the Facebook login flow. The current OAuth request
   uses `pages_show_list`, `pages_manage_metadata`, and `pages_messaging`.
   If your selected Meta setup needs a configuration ID, update the OAuth flow
   to use it before testing that setup.
4. During development, use an app-role account with suitable Page access.
5. Open the Worker and sign in with username `admin` and the password in `env`.
6. Open `/api/meta/status`. `configured: true` means both Meta values exist;
   it does not validate the credentials or permissions.
7. Click **Connect Facebook Page**, authorize, and check the returned Page list.

`META_GRAPH_VERSION` defaults to `v24.0`. Check that the version is supported
by your Meta app before production use.

## Local preview

```powershell
node prepare-cloudflare-env.mjs
npm run dev
```

For OAuth, use a public HTTPS hostname registered with Meta. The OAuth state
cookie requires HTTPS.

## Current limits

The connection test does not retain Page tokens or send messages. There is no
Messenger webhook, database, Send API route, or scheduled sender yet. Do not
register the OAuth callback as a webhook. Customer records still live in the
browser, and the demo's sent status is not proof of delivery.

Real messaging needs encrypted Page token storage, verified webhooks, customer
Page-scoped IDs, business-level access control, consent checks, and delivery
tracking. Scheduled sending also needs server jobs and duplicate prevention.
Complete Meta review and permission access for other businesses.

Standard Messenger sending follows Meta's messaging window. A due reminder or
a merchant clicking Send does not open it. Verify an eligible Meta route before
enabling reminders outside the window.
