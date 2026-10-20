# Shop QR + Supabase + Vercel phone testing

The shop QR opens **`/join.html`**, never one customer's QR. A visitor chooses a nickname and confirms membership; the app opens the real server-signed Google Wallet flow. Google requires the customer to confirm **Add**. QR scanning cannot silently install a card.

A random HttpOnly customer cookie lets the same browser re-open its membership; only its SHA-256 hash is stored in the database. Repeat submissions reuse that membership and never reset its balance. Another browser/phone creates a different membership. There is no verified email/phone identity: preserve the private card link. A shared tablet/browser would reuse its customer, so the shop QR should be scanned on each customer's own phone. Clearing cookies does not identify a returning person; their private link or saved Wallet QR is the recovery mechanism.

## Architecture and cost boundary

- **Vercel** serves `public/` and one Express serverless function (`api/index.ts`). Staff APIs remain authenticated even though the static staff page shell can be loaded publicly.
- **Supabase Postgres** stores memberships, staff, hashed sessions, idempotency records, programme settings and delivery jobs. This is a private SQL schema named `coffee`, with RLS and public privileges revoked. Browser code never receives a database URL, service-role key or signing key. Do not expose `coffee` in Supabase's Data API settings.
- A purchase commits an atomic SQL function first, then Vercel `waitUntil` attempts delivery. Failure leaves a durable job. Google object updates reuse the existing IDs.
- **Supabase Cron + pg_net** calls the authenticated recovery endpoint each minute. Three workers can claim jobs per call; one membership has only one active lease. Successful updates coalesce older queued revisions for the same membership.
- The included Vercel daily cron is only a fallback. It is **not** adequate for prompt retry behavior; install and verify the Supabase minute schedule. Check current provider plan limits before use.

No Vercel/Supabase project was created and no subscription purchased by the agent. Free tiers may support this small personal test, but their current quotas, inactivity/pausing behavior, commercial-use terms and Cron availability must be checked in your accounts. Do not treat a free testing deployment as guaranteed always-on production hosting. Direct current documentation requests were blocked by the environment proxy, so pricing/limits are not claimed as independently verified. Official references: [Supabase Cron](https://supabase.com/docs/guides/cron), [database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Vercel environment variables](https://vercel.com/docs/environment-variables).

## 1. Create Supabase and install the schema

1. Sign up at https://supabase.com and create a project in your preferred region. Choose your intended plan after reviewing costs. Save its database password securely; do not send it in chat.
2. In **SQL Editor**, run the contents of [`supabase/schema.sql`](../supabase/schema.sql). It installs pgcrypto if necessary, creates the private tables/functions and restricts public access. This script is repeatable for this version; do not drop the schema of a live shop to reset it.
3. Click **Connect** and choose the **transaction pooler** connection string, normally port **6543**. Use its full username (`postgres.PROJECT_REF`) and percent-encode any password characters requiring URL encoding.
4. Set that value as `DATABASE_URL` in a local ignored `.env` for administration and in Vercel's server-only Production environment later. Never use a `NEXT_PUBLIC_`/`VITE_` prefix. No Supabase browser SDK or public API key is required.
5. TLS certificate verification is enabled for non-loopback databases. If the project requires a particular root certificate, download the official CA from Supabase and put its PEM contents in `DATABASE_CA_CERT`. Never disable verification or set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Optional local schema installation: `npm run hosted:schema` reads DATABASE_URL and runs the same SQL.

## 2. Preserve your existing test member (optional but recommended)

Do this **before enrolling any customer on the hosted site**:

1. Stop the local server and worker so the official balances stop changing. Back up the SQLite database and sidecars securely.
2. With the original DB_PATH and the new DATABASE_URL set only in your local `.env`, run:

   ```powershell
   npm run hosted:import
   ```

3. The importer requires an **empty hosted members table** and refuses to overwrite live members. It imports customer IDs, balances, rewards, original pass tokens, transaction history, programme goal, enrollment hashes and named staff accounts. It queues fresh Google updates. It deliberately does not copy staff sessions, old delivery jobs or Apple device registrations. Existing Google object IDs stay the same if the issuer ID stays the same.
4. Do not continue accepting purchases in SQLite after cutover: the two databases do not synchronize. The URL origin changes, so old browser cookies do not migrate; the existing private `/?member=UUID` link still identifies the imported customer. Use the hosted staff page to retrieve it. Do not create a replacement membership for an existing saved Google card.

This hosted mode is Google/browser only. Optional Apple callbacks remain available only in the local/server version and are not included in this Vercel deployment.

## 3. Create your hosted owner

With DATABASE_URL configured in your private local `.env`:

```powershell
npm run hosted:staff -- owner owner
npm run hosted:staff -- barista staff
```

The commands prompt for hidden passwords and write hashes directly to Postgres. They do not change your SQLite staff accounts. Imported accounts can be reused. Reset a password by repeating the command. Disable a user with `npm run hosted:staff -- barista disable`; the last owner is protected. Never create public unauthenticated staff-signup endpoints.

## 4. Import the GitHub repository into Vercel

1. Create/sign in to your Vercel account, connect GitHub, choose **Add New → Project**, and import `Diwas03/Loyalty-card` on `main`.
2. The included `vercel.json` selects `npm run build`, static output `public`, and routes APIs/wallet issuance to the serverless function. Use Node **24.x**, one production deployment and no custom SQLite disk.
3. Add these **Production-only** environment values in the project settings:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase transaction pooler URL |
   | `DATABASE_CA_CERT` | Official CA PEM only if needed |
   | `GOOGLE_ISSUER_ID` | Your existing issuer ID |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Entire genuine service-account JSON, pasted only in Vercel's secure server environment editor |
   | `PUBLIC_BASE_URL` | Exact production HTTPS origin, such as `https://your-project.vercel.app`, no path |
   | `CRON_SECRET` | A new random token of at least 32 characters |
   | `APPLE_WALLET_ENABLED` | `false` |

   Generate CRON_SECRET locally if needed: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Do not send it here. Do not configure a Windows GOOGLE_SERVICE_ACCOUNT_FILE path on Vercel; that file will not exist there. Prefer keeping the JSON only in encrypted environment settings. An organization key-creation restriction still needs an approved credential method; deployment does not bypass it.

4. Deploy. If the exact project hostname was unknown before deployment, set PUBLIC_BASE_URL to the assigned production origin and **redeploy**. Missing database settings return a clear 503 until configured. Production credentials must not be shared with preview deployments: leave preview disabled/unconfigured or use a separate test database and issuer setup.
5. Check `/healthz`, then `/join.html`. Sign into `/staff.html` with your hosted owner. Check customer search if importing old data. Verify `/logo.png` is publicly reachable by Google.
6. The local CLI tests cannot prove Vercel routing, production TLS, credentials, quotas or callbacks; validate these on the actual deployed URL before printing a QR.

## 5. Turn on durable minute retries

After you have the stable production origin:

1. Open `supabase/cron.sql` in Supabase's **SQL Editor**.
2. Replace the two placeholders there, securely: the real production URL and exactly the same CRON_SECRET configured in Vercel. They are stored in Supabase Vault. **Never commit the edited secrets or paste them in chat.**
3. Verify Cron and pg_net are available under your chosen plan, then run the script once. Running it repeatedly can create duplicate Vault names/schedules; inspect existing entries before changes.
4. In Supabase Cron, check job run history. In Vercel logs, confirm successful authenticated `/api/cron/wallet-updates` calls. The endpoint is HTTP 401 without the bearer secret. Supabase's pg_net request timeout is set to 55 seconds; the function's configured maximum is 60 seconds.
5. Confirm an intentional delivery failure leaves the purchase committed, the next job retry time advances, and restoring valid credentials allows a later minute tick to deliver it. `delivered` is provider acceptance, not a phone acknowledgment.

Immediate background work is a best-effort latency optimization. The SQL outbox plus the verified scheduled recovery job is the durable mechanism. Do not claim automatic retries work if you have not enabled and observed the schedule. Monitor queue depth and errors; the three-claims-per-minute recovery path is for this small pilot, not a high-volume queue.

## 6. Print the QR and test on phones

1. Open `https://YOUR-PRODUCTION-HOST/shop.html`, or select **Print shop QR** from staff.
2. Check the displayed URL is exactly your production **`/join.html`**. Print that poster.
3. Phone A scans the shop QR, enters a nickname, confirms membership, and completes Google's Add flow with an authorized Demo Mode account. It receives its **own** membership QR in Wallet.
4. Staff scans that membership QR, confirms a paid coffee, and checks backend progress. Observe the existing saved card updating—do not download another card as an update test.
5. Phone A scans the shop QR again in the **same browser**: it reuses its membership. Phone B gets a different membership. Test separately if the camera opens a different browser or an in-app webview.
6. Test rollover, reward redemption, delayed refresh, failed delivery and scheduled retry. Keep the same public origin and database. Google publishing approval is still required before issuing publicly beyond Demo Mode test accounts.

## Local verification

- `npm test`: local SQLite, original wallet contracts, plus self-enrollment/consent/retry/QR cases.
- `npm run test:browser`: rendered staff/customer and shop enrollment flows (install Playwright Chromium or set CHROMIUM_PATH).
- `npm run test:hosted`: real PostgreSQL transactions/roles/API tests, **only** against a disposable loopback database named `coffee_test`. Set TEST_DATABASE_URL first. The test drops/recreates the private coffee schema; it refuses a non-loopback URL or another database name.

These checks do not create Supabase/Vercel projects or demonstrate phone behavior. Hosted credentials, deployment, minute schedule and real-device verification remain user-account steps.
