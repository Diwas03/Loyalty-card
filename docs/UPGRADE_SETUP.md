# Upgrade checkpoint setup and verification

This branch is an incomplete P0/P1 checkpoint, not the full platform requested in the upgrade document. See implementation-plan.md for every remaining gate. No production data or deployment has been changed.

## Test environment

Use Node 24, npm ci, and disposable PostgreSQL. Docker remains supported by the existing runner. Without Docker, create a separate loopback database named coffee_test. Never point tests at hosted/production databases; fixtures enforce loopback and the database name.

```powershell
$env:TEST_DATABASE_URL = 'postgres://postgres@127.0.0.1:55439/coffee_test'
# Set these to installed runtimes when they are absent from PATH:
$env:PYTHON_PATH = 'C:/path/to/python.exe'
$env:CHROMIUM_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
# Ensure openssl.exe is on PATH for the synthetic certificate test.
npm test
npm run test:hosted
node scripts/run-tests.mjs upgrade-browser
npm run test:browser
npm run test:scanner
npm run typecheck
npm run build
```

No lint command is configured. The new browser test saves screenshots in ignored data/upgrade-screenshots. These are headless desktop browser emulations, not real phone or camera tests. Existing scanner tests emulate decoded QR frames. Native wallet tests use a local HTTP provider stub and synthetic CA, never live issuer activation.

## Isolated two-business development seed

Create coffee_dev on loopback. Set DEV_DATABASE_URL explicitly to it, and DEV_SEED_PASSWORD to a locally chosen password of 12–200 characters. Run `npx tsx scripts/seed-development.ts`. The script refuses non-loopback/other database names and existing non-seed customers/accounts. Repeating it retains existing seed credentials and replays the same purchase keys. Never put the password in source control.

If the test seed already exists and you need to choose your own password, also set DEV_SEED_RESET_PASSWORDS=true for that run. This resets only the two deterministic development accounts and revokes their existing sessions. Clear that flag afterwards. It still refuses remote databases or non-seed data.

Run `npm run pilot` with that DEV_DATABASE_URL to open the same multi-shop application as Vercel at http://127.0.0.1:3000/business/. This development entry point refuses other database names/remote hosts, binds only loopback, ignores the production DATABASE_URL and disables external native-wallet delivery. The older `npm start` entry point remains available for legacy installations; it does not provide the new hosted pilot features.

On this Windows workspace the isolated cluster is already initialized under data/upgrade-test-pg and coffee_dev exists. After stopping the test cluster, restart it and choose your own seed password locally:

```powershell
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D 'D:/Loyalty Card Project/data/upgrade-test-pg' -l 'D:/Loyalty Card Project/data/pilot-postgres.log' -o '-h 127.0.0.1 -p 55439' start
$env:DEV_DATABASE_URL = 'postgres://postgres@127.0.0.1:55439/coffee_dev'
$env:DEV_SEED_PASSWORD = Read-Host 'Choose a development password' -MaskInput
$env:DEV_SEED_RESET_PASSWORDS = 'true'
npm run seed:development
Remove-Item Env:DEV_SEED_PASSWORD
Remove-Item Env:DEV_SEED_RESET_PASSWORDS
npm run pilot
```

Sign in as seed-cafe-owner or seed-salon-owner using that password. Do not re-run pg_ctl start if this isolated cluster is already running. It binds only to loopback and is a development cluster, not a production database.

## Migrations and rollback

Hosted startup applies schema.sql, shops.sql, referrals.sql and additive pilot.sql/rewards.sql atomically under existing migration locks. Local legacy server still uses the separate public schema. Do not silently point a legacy installation at coffee tables. Use existing explicit import tooling; mixed source/target data is refused.

Issued rewards snapshot their label and validity at issuance. Existing rewards are grandfathered without expiry. Expiry is applied lazily when a member is read and before a report is calculated; there is not yet a scheduled expiry campaign worker. Redemption rejects expired vouchers. Full refunds, spent-reward debt, referral reversal and revocation controls are not implemented; bounded stamp correction must not be presented as a refund.

Before a production rollout: take a verified pg_dump backup of the configured database and private configuration using operator tooling; test restore into a separate database; apply the migration and run acceptance there. Do not copy a live data directory as a PostgreSQL backup. This branch has not performed a production backup or restore rehearsal.

Rollback application code while retaining additive tables/columns; do not drop ledger data, truncate balances or reverse customer operations. A private link replaced on this branch will not work correctly with older application code that only accepts IDs. Retain this branch's private-link resolver if rolling back other features. Choose a maintenance window and verified database restore only if an actual data rollback is necessary; that loses subsequent transactions and requires an operator decision.

## Integration checklist

| Integration | Implemented/tested | External setup / missing implementation |
|---|---|---|
| Google Wallet | Existing JWT signing, stable object updates, queue/retry behavior and local stub tests | Wallet issuer ID, service-account authorization, public HTTPS origin, issuer publishing authorization, live issue/save/update/revoke verification. See WALLETS.md; not live-verified here |
| Apple Wallet | Existing legacy signing/registration tests with synthetic CA | Hosted adapter is still unavailable; Apple developer identifiers/certificates/private key/WWDR, HTTPS update service and device tests required. Credentials alone do not complete hosted support |
| Card transfer | Private one-time ten-minute fragment link; server atomic consumption | No provider required. Original card possession is required; this does not verify an email/phone or recover a lost identity |
| Email/SMS/web push | Not implemented | Named provider, availability in merchant country, credentials, consent/unsubscribe and adapter tests |
| Billing | Not implemented | Manual invoice/subscription model first. Verify a chosen payment provider's merchant-country support before paid integration |
| POS/webhooks | Not implemented | Versioned scoped signed event boundary first; then named provider/API/credentials |

Use [Google's loyalty documentation](https://developers.google.com/wallet/retail/loyalty-cards) and [Apple Wallet Passes](https://developer.apple.com/documentation/walletpasses) as current official entry points (reviewed 26 October 2026). Never treat a web card, printout or screenshot as a native wallet pass.
