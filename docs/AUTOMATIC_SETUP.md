# Completing this connected deployment

Production URL: **https://loyalty-card-pi.vercel.app**.

## Create staff accounts in the website

Open `/register.html` to create the first owner account with your name, chosen
username and a new password of 12–200 characters. The shop setup password is the
original shop password whose salted hash is saved as `STAFF_PASSWORD_HASH` in
Vercel. It authorizes first-owner creation only; it does not choose the new
account's username or password. No predefined account is created automatically.
Passwords are hashed with scrypt before they are stored in the database.

Sign in at `/login.html`. Owners see **Create a staff account** in their dashboard
and can create individual staff usernames and passwords. Staff can sign in and
manage loyalty cards but cannot create accounts or change owner-only settings.
Public registration closes atomically after the first account exists, including
simultaneous setup requests. Existing staff accounts and passwords are preserved.
If an owner already exists, use that account or the private `hosted:staff` helper;
registration cannot be used to take over or reset an existing shop.

The Vercel function initializes the private schema in a locked transaction before
accepting API requests. The schema SQL is explicitly included in the function
bundle. Failed initialization can retry on a later request; it does not permanently
cache a failed connection. This still requires a valid database URI, verified TLS,
network access and a backend database role allowed to install the schema.

Google Wallet buttons require a readable, valid RSA service-account credential;
a Windows file path or blank placeholder is insufficient on Vercel. Missing or
malformed credentials keep wallet saving disabled while browser membership cards
remain available. Provider approval and real-device saving need separate checks.

Connecting Supabase to Vercel supplies connection variables. It does not create the private loyalty tables, a staff owner, Google signing credentials or the minute retry schedule. The newest server commit also introduced `public` Postgres tables; the Vercel function still uses the private `coffee` schema. These must not be treated as interchangeable or independently updated copies of the official balance.

## Configuration now handled automatically by code

- The server accepts the integration's DATABASE_URL, POSTGRES_URL, SUPABASE_DB_URL, SUPABASE_POSTGRES_URL, POSTGRES_PRISMA_URL or POSTGRES_URL_NON_POOLING. Prefer the transaction pooler URL; do not use a browser/public-prefixed variable for a database password.
- TLS certificate verification is on for remote Postgres. Use DATABASE_CA_CERT with the official project certificate if required, never `rejectUnauthorized:false`.
- In a Production Vercel deployment, the stable VERCEL_PROJECT_PRODUCTION_URL is used when PUBLIC_BASE_URL is absent. Preview/request headers cannot set this fallback. An explicitly configured PUBLIC_BASE_URL must be an HTTPS origin without a path. Secure cookies follow the resolved origin.
- The health check now tests the private programme table, not only an open database socket.
- Enrollment is transactional, stores a hashed customer cookie and reuses the same membership. Raw-cookie enrollments written by the preceding server version are upgraded when the customer returns.
- Both startup migration and hosted configuration enable RLS on the legacy app tables and revoke browser-role access while preserving the rows. This protects the public-table migration; staff access continues through authenticated server APIs.
- `hosted:configure` installs the schema repeatedly without deleting memberships, reports non-secret setup status and can explicitly import legacy public tables. It refuses to overwrite a populated private membership table. It does not merge conflicting balances by guessing.
- The optional `--cron` flag configures Vault and exactly one app-specific minute retry schedule, updating existing app entries rather than creating duplicates. It requires the database role's Supabase extension/Vault/Cron permissions and a secure CRON_SECRET of at least 32 characters.

## One-command database configuration

If `DATABASE_URL` was accidentally set to your `https://PROJECT_REF.supabase.co`
API address, replace it in secure environment settings with **Connect → Transaction
pooler → PostgreSQL URI**. Replace `[YOUR-PASSWORD]` with the actual database
password and percent-encode its special characters. A valid `POSTGRES_URL`
integration binding takes precedence over an invalid API address. No script can
recover a missing database password from the project ID. Passwords and completed
connection strings must stay outside Git. Malformed staff hashes fail closed;
create a hosted owner with `npm run hosted:staff -- owner owner` after the database
connection is working. This prompts privately and writes the account to the database.

With the Supabase connection configured in a **private local environment** and PUBLIC_BASE_URL set to the production URL:

```powershell
npm ci
npm run hosted:configure
```

If the status reports legacy public data, stop the legacy server/worker, back up the source, and explicitly import:

```powershell
npm run hosted:configure -- --import-public
```

If both stores contain members, the command refuses to overwrite either. Inspect the two stores before choosing a cutover. All source public tables are retained; staff sessions and failed delivery history are not imported. After cutover, use the Vercel/private APIs for purchases; an old server process writing `public` does not synchronize with `coffee`.

With the same securely configured CRON_SECRET used by Vercel:

```powershell
npm run hosted:configure -- --cron
```

Create/reset an owner in an interactive local terminal only if none was imported:

```powershell
npm run hosted:staff -- owner owner
```

Google additionally needs GOOGLE_ISSUER_ID and the genuine GOOGLE_SERVICE_ACCOUNT_JSON in Vercel's encrypted Production environment. A Windows file path cannot supply a file to Vercel. No script can manufacture Google issuer approval, a legitimate signing key or your personal password.

## Letting the assistant finish the provider-side work

No Supabase/Vercel connector or provider credentials were available inside the coding workspace when these changes were prepared. Connecting the two dashboards does not automatically authorize this separate workspace.

Secure credential requirements were saved in this cloud environment's settings:

- **VERCEL_API_TOKEN** — create/manage at https://vercel.com/account/tokens; it must have access to this project's settings and deployments. Allowed API destination: `api.vercel.com`.
- **SUPABASE_ACCESS_TOKEN** — manage at https://supabase.com/dashboard/account/tokens; it must have access to the intended project's database/configuration. Allowed API destination: `api.supabase.com`.

Enter values only through secure environment settings, never in chat, source files, issues or commits. Review/save the environment settings and publish to activate the bindings. The production hostname is also included in the saved network draft for read-only deployment checks. This does not configure Vercel/Supabase by itself; it lets the assistant access the required provider APIs on continuation. These tokens are administrative API credentials, not a replacement for the server's database URL or Google signing JSON. Scope access to the intended accounts/projects where supported.

The environment proxy denied the attempted live HTTPS check before it reached the app. That is not evidence the app itself returned HTTP 403. Live health, schema state, environment bindings, owner access, the minute schedule, redeployment and physical-phone behavior still need verification after provider access is available.

## Test and backup changes

The emulator was removed because it cannot validate Postgres locks/rollback. `npm test`, `npm run test:hosted` and `npm run test:browser` now start and remove their own disposable Docker Postgres instance. Start Docker Desktop first, or supply TEST_DATABASE_URL to a disposable **loopback database named coffee_test** on which the test role may create temporary databases. Tests reject other hosts/database names; never point them at Supabase. Chromium, OpenSSL and Python remain prerequisites for their respective checks.

`npm run backup` uses a read-only repeatable-read snapshot and refuses to overwrite an existing backup. If both database schemas exist, set BACKUP_SCHEMA explicitly to `coffee` or `public`. Backups are private JSON exports, not a complete pg_dump/restore workflow. Use Supabase's supported backup/export tools and verify recovery before relying on the hosted service.
