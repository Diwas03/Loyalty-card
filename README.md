# Demo Coffee Shop · Single-shop loyalty pilot

**Quick local start:** with Node 24 and Docker Desktop running, use `npm ci` then `npm run local`. In another terminal, run `npm run local:staff -- owner owner` to choose your password. See [Windows run instructions](docs/RUN_LOCALLY.md). This is an isolated local database; live Vercel/Supabase setup remains separate.


**Current connected-deployment setup:** read [Automatic setup and migration](docs/AUTOMATIC_SETUP.md). The latest server uses Postgres; older SQLite instructions below apply only to historical installations/imports. Vercel uses the private `coffee` schema, while the preceding server migration created `public` tables. The configuration command preserves source data and refuses ambiguous overwrites. Tests now use disposable real Postgres through Docker, not a database emulator.


A Google Wallet first coffee-shop pilot built with TypeScript, Express and SQLite. Customers get a private browser card and a real Google Wallet save link; staff enroll customers, scan QRs, record coffees and redeem rewards. The server holds the official balance. A separate durable worker handles wallet delivery without reversing purchases when a provider fails.

Google Wallet testing was reported successful by the project owner. This version's new workflows have been tested locally; they have **not** been retested on a physical phone. An iPhone opening a Google save link is not proof of native Apple Wallet support. Use the browser card on iOS unless your intended iOS wallet experience has been verified. Apple signing/callback code is retained as an optional separate integration, disabled by default.

## What is included

- Responsive customer card, stamp indicators, reward count and QR; automatic balance refresh every five seconds while visible.
- Staff workspace with name/ID search, staff-assisted customer enrollment, private card links, camera scanning and manual lookup.
- Individual staff and owner accounts; password reset, session revocation and account disabling through local operator commands. Existing shared-password installs remain compatible until the first named account is created.
- Timestamped purchase/redemption history with staff attribution. Duplicate request keys replay the original result; concurrent redemption is atomic.
- Owner-only stamp goal (2–100), default **eight**. Existing stamps/rewards are retained; a reduction is rejected if any customer has progress at or above the proposed goal. All cards get update jobs after a change.
- Persistent outbox, bounded exponential retries, actionable delivery status and owner retry controls. Google 404 pauses as `waiting-save`; reopening the save link repairs/creates the object and wakes pending deliveries.
- Consistent SQLite backup command and automatic, transactional migration from the original PoC. Existing IDs, QR values, wallet object IDs, pass tokens, balances and rewards are preserved.

This is a pilot, not a claim of production certification. It intentionally excludes payments, referrals, multiple shops, NFC and native apps. Enrollment is staff-assisted; no SMS, email or customer password is collected.

## New local setup

Requirements: Node **24.x**, npm, and OpenSSL/Python 3 for the synthetic signing tests.

```sh
npm ci
# Copy only when .env does not already exist:
cp .env.example .env
npm run staff-account -- owner owner
npm run staff-account -- barista staff
npm run typecheck
npm test
npm start
```

PowerShell uses `Copy-Item .env.example .env` instead of `cp` if preferred. Account commands prompt locally with hidden input and store salted scrypt hashes in SQLite. No default password is supplied. Never paste passwords or keys into chat.

In a separate terminal, from the same directory and with the same `.env`:

```sh
npm run worker
```

Open `http://localhost:3000/staff.html`, sign in as `owner`, and create a customer. Share the generated private customer link. Confirm each staff action explicitly. One paid qualifying coffee earns one stamp; reaching the configured goal issues a reward and resets stamp progress. Redeeming consumes a reward and never earns a stamp. Unused rewards remain into new cycles.

Customer links and QRs use random UUIDs; no balance, contact data or staff credential is encoded. A QR identifies a customer but authorizes no mutations. Use a nickname if the customer does not want their display name on a private card.

## Upgrade your existing Windows installation

1. Stop the server and worker with Ctrl+C. Keep your `.env`, credential files and database.
2. Back up the **whole `data` directory**, including any SQLite WAL/SHM files, to a private folder outside the repository while both processes are stopped. For a custom DB_PATH, back up that database and its sidecar files instead.
3. Pull the changes and install:

   ```powershell
   git pull origin main
   npm ci
   npm run typecheck
   npm test
   npm run staff-account -- owner owner
   npm run staff-account -- barista staff
   npm start
   ```

4. Start `npm run worker` in another terminal. Sign in with the new named account. The previous shared password (`STAFF_PASSWORD_HASH`) no longer authenticates once any named account exists; legacy sessions are revoked. You may remove the old hash from `.env` after checking named login.
5. Reopen the **same private customer link** and verify the same progress and saved Google card. Do not delete `data/coffee.sqlite` to resolve a login or update issue.

Migration runs on first open by the server, worker or account command. Original transaction history has no reliable timestamps or actor data; it is shown as an earlier record by `legacy`, without inventing dates. New history includes the real operator and time. Keep your pre-upgrade backup if rollback is necessary; older code cannot use the new schema unchanged.

## Operating accounts and backups

```sh
# Create an account or reset its password/role; prior sessions are revoked:
npm run staff-account -- alice staff
npm run staff-account -- owner owner
# Disable a departed staff member and revoke their sessions:
npm run staff-disable -- alice
# Create a consistent snapshot (default ignored data/backups/):
npm run backup
# Or choose a private destination that does not already exist:
npm run backup -- D:/WalletBackups/coffee.sqlite
```

Do not disable the last enabled owner. The reserved username `legacy` cannot be created. Operator CLI commands require local access to the server's database; they are not public account-registration endpoints. In the UI staff can enroll/find customers and record coffees/redemptions. Only owners can change the stamp goal or manually retry wallet jobs. Sessions expire after eight hours and disabled/reset accounts lose access immediately.

Backups contain customer IDs, password hashes, session tokens and Apple pass tokens: restrict access and never commit or share them. Restore only with server/worker stopped, preserve the current files first, and remove stale WAL/SHM sidecars from the database being replaced. Test restores on a separate private copy before relying on a backup.

## Wallet configuration and device checks

Follow [account setup](docs/WALLETS.md), [device checklist](docs/TESTING.md) and [.env.example](.env.example). Use forward slashes for quoted Windows paths:

```dotenv
GOOGLE_ISSUER_ID=your_real_issuer_id
GOOGLE_SERVICE_ACCOUNT_FILE="D:/WalletSecrets/google-wallet.json"
PUBLIC_BASE_URL=https://your-real-test-origin
APPLE_WALLET_ENABLED=false
```

Real keys remain outside the repository. Do not copy literal example values into a live setup. Missing configuration disables real saving; configured fields alone do not prove credentials or approval are valid. The current Google implementation requires a service-account JSON key; keyless impersonation is not implemented.

Google uses the original `${issuerId}.demo_coffee` LoyaltyClass and `${issuerId}.${membershipUUID}` LoyaltyObject IDs. It signs save JWTs server-side and PATCHes the existing object; reopening a save link does not create a new membership. The stamp goal is supplied per object. For Apple, explicitly set `APPLE_WALLET_ENABLED=true` and all signing configuration before testing; Apple requires its own certificates and real-device automatic-update verification.

Use a stable public HTTPS origin for real devices, public logo access and Apple callbacks. Quick tunnels are suitable only for short tests: changing the URL requires updating `.env` and restarting both processes, and old Apple passes may retain their old callback URL. The app hides anonymous seed lookup on HTTPS (`DEMO_PUBLIC_CUSTOMER=false`), so use the private membership URL from staff. The customer homepage explains how to obtain a card rather than exposing another customer's link.

For a compiled deployment, `npm run build`, then `npm run start:production` and `npm run worker:production` from the repository root. Keep `public/`, `assets/` and runtime dependencies alongside `dist/`. Server/worker handle SIGINT/SIGTERM so SQLite connections close cleanly; interrupted leased deliveries recover after the lease expires.

No public deployment or paid service has been created. Host one app and one worker against the same persistent SQLite file; do not use separate ephemeral filesystem copies. GET `/healthz` checks database availability, not provider health. The worker must be monitored independently. Restrict network access and configure a trusted reverse proxy before public production use; no arbitrary forwarded-IP headers are trusted.

## Delivery semantics

- `pending` / `working`: queued or leased for two minutes for crash recovery.
- `blocked`: credentials missing; checked again every minute.
- `waiting-save`: Google returned object-not-found; open the customer's real save link. Reopening it wakes failed/retry/blocked Google jobs for that member.
- `retry`: failed provider delivery, exponential delay from two seconds to one hour.
- `failed`: 12 failed attempts; an owner can retry after fixing the cause. The retry control does not record another purchase or erase the attempt count.
- `delivered`: provider accepted the update/push, **not confirmation of a device refresh**.
- `no-device`: no Apple registration to notify. `disabled`: historical Apple job when Apple is off.

Purchase and outbox creation commit together. Jobs read the latest official balance and do not replay old balance snapshots. A live lease prevents later jobs for the same member/provider from overtaking the active one. Run exactly one worker for this pilot; Apple operations across many devices can exceed the lease and need a stronger distributed delivery design before scaling.

## Verification

```sh
npm run typecheck
npm test
# Optional headless browser test; one-time browser installation:
npx playwright install chromium
npm run test:browser
```

An existing Chromium installation can be used with `CHROMIUM_PATH` (PowerShell: `$env:CHROMIUM_PATH="C:/path/to/chrome.exe"`). The browser test uses an isolated in-memory database and tests login, enrollment, eight coffees, reward redemption, owner programme changes, history automatic customer refresh, a lost-response retry and a definitive rejection. It does not contact Google or simulate real camera hardware.

**19 automated tests pass**, plus the Chromium workflow. Coverage includes legacy migration/reopen, reward policy, duplicate submissions, concurrent redemption, authorization/roles, revoked sessions, delivery failure isolation, Google 404 recovery, retry budget and delivery ordering. Google signing tests use stubbed HTTP; Apple signing tests use disposable synthetic certificates. See the [checklist and evidence](docs/TESTING.md) for the exact verification boundary and remaining real-device work.

## Shop QR and online phone testing

Open `/shop.html` to print a **shared shop enrollment QR**; each customer scans it on their own phone, chooses a nickname and is taken to Google's real Add confirmation. Returning browsers reuse their membership without losing stamps. The membership QR inside a card is different: staff scans it to identify that customer.

For **Supabase + Vercel**, follow [the complete hosting and cutover guide](docs/HOSTING.md). `vercel.json` uses the serverless Postgres backend; ordinary `npm start` uses the legacy public-schema Postgres server. Do not deploy SQLite or the indefinite local worker to Vercel. The hosted database schema, importer, hosted staff tools, persistent retry endpoint and minute Cron setup are included. No accounts, hosted projects, paid services or public deployment were created automatically. Do not paste credentials into chat.

### Installable web loyalty cards

The customer flow uses a PWA instead of Google Wallet. Customers open their
private card link and choose **Install loyalty app** when supported. On iPhone,
use Safari → Share → Add to Home Screen. The home screen app lists cards opened
on that device, including memberships at different shops. Keep the private link
as a backup: clearing browser data removes saved shortcuts. Internet is required
for QR display and authoritative balances; the service worker never caches
private cards, staff pages, API responses or QR images. Staff scanning continues
to award stamps in the database, and open customer cards refresh every five
seconds. Existing wallet endpoints remain for compatibility with issued passes;
new customers are not sent to Google Wallet and Google credentials are not
required for the web app. Run `node tests/pwa-smoke.mjs` with Chromium installed
to verify saved-card reopening, installation UI and the offline fallback.
