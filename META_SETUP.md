# Refill Meta setup

This project currently supports a Facebook authorization test. It lists the
Pages available to the signed-in account. It does not save access tokens,
receive Messenger events, or send messages yet.

## 1. Configure the hosting platform

Add these values in the platform's server-side secrets or environment settings:

| Name | Value |
| --- | --- |
| `META_APP_ID` | App ID from your Meta app settings |
| `META_APP_SECRET` | App Secret from your Meta app settings |
| `META_GRAPH_VERSION` | Optional; the backend currently defaults to `v24.0` |

The local `env` file is a private place to keep these values. The app does not
load it automatically. Do not upload it as a public asset or include it in the
build output. Configure secrets directly on the platform, then redeploy if the
platform requires it.

The current backend uses the hosting platform's `oai-authenticated-user-id`
header to check sign-in. Use hosting that securely supplies this identity and
removes any user-supplied copy of the header. Another host needs real session
authentication before this flow can be used safely.

## 2. Prepare the build

With Node.js and npm installed, run:

```powershell
npm run check
npm run build
```

The build uses the files in this project root and creates:

- `dist/index.html`: dashboard
- `dist/server/index.js`: backend with the dashboard included
- `dist/.openai/hosting.json`: hosting project settings

Deploy the `dist` artifact with backend support. Serving only the HTML will
not provide the `/api/meta/*` routes. The build does not include local secrets.

## 3. Configure Meta

Replace `YOUR-DOMAIN` below with the deployed HTTPS hostname.

1. Open the intended app in Meta for Developers.
2. Configure Messenger and the Facebook login flow suitable for your app.
3. Register this exact valid OAuth redirect URI:
   `https://YOUR-DOMAIN/api/meta/callback`.
4. Configure the app domain and website URL where requested.
5. During development, use an account with an app role and suitable Page access.
6. The current flow requests `pages_show_list`, `pages_manage_metadata`, and
   `pages_messaging`. Set up the required permission access in Meta's dashboard.

Meta may require a configured Facebook Login for Business flow and a
configuration ID for your selected app setup. This backend currently uses a
scope-based OAuth request and does not pass a configuration ID. Match the Meta
setup to the implemented flow, or update that flow before using a configuration
that requires an ID.

## 4. Check the connection

1. Open the deployed Refill app while signed in.
2. Visit `/api/meta/status`. `configured: true` means both required environment
   values exist. It does not prove the credentials or permissions are valid.
3. Return to the dashboard and click **Connect Facebook Page**.
4. Complete Facebook authorization.
5. Confirm the success screen lists the expected Page.

If setup is missing, check platform environment settings. If the redirect is
rejected, compare the full callback URL, including HTTPS and the path. If no
Pages appear, check the account's Page access and granted permissions.

## 5. Work needed before real sending

- Save the selected Page and its encrypted access token against a business account.
- Add a public webhook with verification, signature checks, and Page subscriptions.
- Link customer records to Page-scoped Messenger IDs from real interactions.
- Add an authenticated server-side Send API route with eligibility and consent checks.
- Add a database, scheduled jobs, duplicate prevention, retries, and delivery tracking.
- Replace the demo's local "sent" status with actual API results.
- Complete Meta's required review and access steps for other businesses.

There is no webhook URL to register in this version. Do not use the OAuth
callback URL as a webhook.

Standard Messenger sending is subject to the messaging window. A due reminder
or a merchant clicking Send does not open that window. Verify an eligible Meta
route for reminders outside the window before enabling automatic sending.
