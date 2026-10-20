# Test checklist and evidence

## Automated local checks

Run from repository root with Node 24, OpenSSL and Python 3:

```sh
npm ci --cache /tmp/npm-cache
npm run typecheck
npm test
```

Current result: **19 tests passed, 0 failed, 0 skipped**. A separate live-process HTTP smoke check also passed: customer page/API, protected staff redirect/login, scanner library delivery, duplicate purchase, worker credential-blocked status, and persistence after restarting the server. Tests use independent isolated databases; they do not change the live seeded member. Google HTTP is stubbed only in its explicitly named test. Apple signature tests create a temporary local CA, verify the archive manifest and CMS signature against that CA, and remove it. That archive is not trusted by Apple Wallet.

Covered: duplicate purchase key, eighth-stamp reward, new-cycle unused reward retention, no stamp on redemption, concurrent redemption from distinct database connections using the actual transaction function, staff authentication/confirmation/origin enforcement, durable outbox failure and successful retry, Apple registration authentication/discovery/removal, disabled real issuance, QR generation, signed Google JWT and stable PATCH identity, signed Apple package and unchanged serial/token on update.

## Local browser/staff check

- [ ] Set a staff password locally, start server and separate worker.
- [ ] Customer page shows seed at 0/8, zero rewards, and a QR with only its random UUID.
- [ ] Without credentials, real wallet buttons are disabled with missing configuration listed; direct issuance requests return HTTP 503, not simulated success.
- [ ] Staff page redirects to sign-in; an unauthenticated mutation returns 401.
- [ ] Sign in; look up the printed UUID. No balance changes until an action is explicitly confirmed.
- [ ] Record one paid coffee; backend becomes 1/8 even though wallet jobs are blocked. Refresh lookup to inspect delivery status.
- [ ] Refresh browser customer card; it shows the backend value. Stop and restart both processes; balance persists.
- [ ] Grant camera permission on localhost/HTTPS and scan the browser QR using a second screen. Denied camera access has a usable manual lookup fallback.

**Physical camera and phone behavior have not been observed by the agent.** Headless Chromium now verifies rendered staff/customer workflows, enrollment, earning, rollover, redemption, programme changes and live customer refresh. That is not camera hardware or real-device verification.

For a public test origin with seed lookup disabled, obtain only the existing membership ID locally (not its Apple token):

```sh
node --env-file=.env --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync(process.env.DB_PATH||"data/coffee.sqlite"); console.log(db.prepare("SELECT id FROM members LIMIT 1").get().id); db.close()'
```

Visit `https://your-test-origin/?member=THAT_UUID`. Keep that link private. Tests below assume a new **test** member at 0/8; if you've already recorded a local coffee, record the starting balance and adjust the checklist counts. Do not delete a live database to reset installed cards. There is deliberately no reset button.

## Real Android / Google Wallet

Prerequisites: configured issuer, enabled API, service account issuer role, authorized Demo Mode Google test account, public HTTPS logo, server and worker running with persistent data. Public issuance additionally requires publishing approval.

- [ ] On Android, sign into Google Wallet with the registered test account. Open the private membership link and select Add to Google Wallet.
- [ ] Save the loyalty card in Google's real UI. Record the class/object ID and membership UUID in a private test record; do not record tokens/keys.
- [ ] Card shows Demo Coffee Shop, 0/8 and zero rewards. Staff camera scans its QR and resolves the exact same UUID as the browser card.
- [ ] With the wallet already installed and closed, staff confirms one paid coffee. Backend immediately reads 1/8. Worker PATCH is accepted; reopen Wallet and observe 1/8 without saving a new card.
- [ ] Record timestamps separately: backend commit, provider acceptance, device observation. A delayed phone refresh is not a failed backend purchase.
- [ ] Reopen the original save link. It references the same LoyaltyObject and UUID and does not duplicate the membership or reset progress.

## Real iPhone / Apple Wallet

Prerequisites: set `APPLE_WALLET_ENABLED=true`, active developer membership, Pass Type ID/certificate/private key/matching chain, stable public HTTPS callbacks, production APNs certificate-authenticated HTTP/2 access, server and worker running.

- [ ] In Safari, open the private member link, download the actual signed `.pkpass` and complete Add in Apple's Wallet UI.
- [ ] Observe the registration request persisted. In a protected local terminal, inspect **counts only**, avoiding push/auth token output:

  ```sh
  node --env-file=.env --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync(process.env.DB_PATH||"data/coffee.sqlite"); console.log(db.prepare("SELECT count(*) AS registeredDevices FROM registrations").get()); db.close()'
  ```

- [ ] Wallet shows the same member QR and current backend progress. Staff scans the Apple QR and identifies the same UUID as Android/browser.
- [ ] Starting at 0/8 (or the recorded current value), change progress remotely from staff. For the required 0→1 test, do this before the shared membership's first purchase while **both** real cards are already saved.
- [ ] Observe an APNs request accepted, then update discovery and authenticated pass retrieval. Check Wallet shows 1/8 **without tapping Add again or manually downloading another pass**. Test with automatic updates enabled on the pass.
- [ ] Remove the pass and verify deregistration reduces the registration count (device/network timing may delay callbacks). Save the same customer link again; serial/type/membership remain unchanged.
- [ ] Reopen the original save link; it represents the same serial/type and membership, without resetting the backend.

## Shared programme and retry exercise

Use **both saved cards before the first coffee** if you need an exact shared 0/8→1/8 observation. Actions on either card affect one shared membership, not independent Google/Apple balances.

- [ ] From 1/8, record seven more distinct paid coffees. At stamp eight, observe backend 0/8 with exactly one available reward; both wallets eventually show those values.
- [ ] Record one more paid coffee. Backend 1/8 while the unused reward remains one; verify eventual wallet values.
- [ ] Redeem one reward with confirmation. Backend stays 1/8 and reward count becomes zero. Verify both wallets eventually update.
- [ ] Try to redeem again: explicit failure, no negative balance and no stamp earned. The automated test separately verifies simultaneous competition succeeds only once.
- [ ] Stop **only the worker**, record one coffee and confirm the official balance changes with pending delivery jobs. Restart the worker and observe delivery catching up.
- [ ] Test a real provider failure safely in a **test environment**: stop the worker, replace one credential file path in the local test `.env` with a nonexistent path (do not delete any keys), restart worker and record a coffee. It must preserve balance, show a delivery failure/retry and increasing attempts, and schedule a later attempt. Restore the original path and restart worker; wait for `next_at`, then observe successful delivery and the real phone catching up. Do not disable TLS/signature checks.
- [ ] With the app still reachable, temporarily put a phone offline, record a coffee, then restore connectivity. Provider acceptance can precede the device update; record the delay rather than claiming instant delivery.
- [ ] After server/worker restart, re-open both original save links and verify the same UUID, Google object ID, Apple serial/pass type, stamps and rewards survive.

## Capability status

| Capability | Status |
| --- | --- |
| SQLite ledger, rollover, rewards, duplicate keys, atomic redemption | Implemented and locally tested |
| Staff authentication/API protection, explicit confirmation | Implemented and locally tested |
| Browser card HTTP/QR endpoints | Implemented and locally tested |
| Rendered browser workflows (headless Chromium) | Implemented and locally tested |
| Physical camera scanning | Not yet tested |
| Durable outbox, failure isolation and retry | Implemented and locally tested |
| Google JWT/class/object/update contract with stubbed HTTP | Implemented and locally tested |
| Google actual issuance, Demo Mode account access and live updates | Blocked by credentials or approval |
| Apple package generation/signature with synthetic local certificates | Implemented and locally tested |
| Apple registration/discovery/removal/authentication protocol | Implemented and locally tested |
| Apple trusted signing, APNs and automatic phone updates | Blocked by credentials or approval |
| Public HTTPS callback connectivity | Not yet tested |
| Original Google Wallet test | User-reported successful; device/update details unconfirmed |
| New pilot behavior on Android/iPhone | Not yet tested |
| Current official Google sample source | Implemented and locally tested (reviewed source; not API acceptance) |
| Live official documentation recheck, especially Apple | Not yet tested (documentation hosts blocked by proxy) |

The owner reported Google Wallet testing successful after the initial PoC. Device model/OS and automatic-update observations were not supplied; the new pilot changes have not been independently verified on a physical device. Fill in device model/OS, date, pass identity and observations only after running the checklist. Do not store screenshots containing secrets or raw callbacks/authentication headers.


## Pilot regression checks

`npm test` additionally covers transactional migration from the old database, preserved pass identity/balances, named account sign-in and reset revocation, legacy account retirement, owner/staff permission boundaries, enrollment/search, attributed transaction history, configurable stamp goal, rejecting destructive reductions, Google 404 waiting-save state, owner retry, finite retries, and active-delivery ordering.

Run `npx playwright install chromium` once, then `npm run test:browser` for the rendered workflow. For an installed Chromium, set CHROMIUM_PATH to its executable. No actual provider requests or phone interactions are performed by that test.

- [ ] Back up existing SQLite and sidecars; upgrade; confirm same customer IDs, tokens, balances and original Google card.
- [ ] Create owner/barista accounts. Old shared-password login/session no longer works. Barista cannot change the goal or retry delivery; owner can.
- [ ] Staff creates a customer and shares their private link. Search by nickname/ID; test scanning with actual hardware.
- [ ] Confirm transaction attribution and old records explicitly labeled `legacy` / earlier record.
- [ ] Change goal as owner, confirm all existing rewards remain and all current cards receive updates. Test new goal remotely on an already installed real card.
- [ ] Make a backup, restore to a separate private test database, and verify memberships/balances. Do not test restoration by overwriting your only live database.
- [ ] Repeat the Google real-device checklist after this pilot upgrade. Record precisely what works on iOS; do not equate a save-link webpage with a native iOS wallet card.

Additional local operations smoke passed: SQLite backup/readback, staff disable and last-owner protection, compiled server/worker startup, health request and graceful shutdown. The browser test also exercises an aborted purchase response (safe idempotent retry) and clears a rejected request without leaving staff stuck. Provider errors are sanitized to prevent credential-file parse errors exposing key fragments through delivery status.


## Shop QR and hosted Postgres additions

Local self-enrollment tests cover consent, browser-cookie requirements, idempotent retries, distinct customers across browsers, hashed customer cookies and a common shop QR that points to `/join.html`. The Chromium test also exercises first-time and returning shop enrollment (browser-card fallback).

Five integration tests against a real disposable PostgreSQL 17 database pass: atomic duplicate earning/rollover/reward retention/concurrent redemption; hosted enrollment/authentication/history; failure isolation/retry/claim ordering; programme changes and cron authentication; private-schema access denied to an untrusted database role. These are local Postgres tests, not a Supabase project or Vercel deployment. See [hosting guide](HOSTING.md) for account setup and the required minute retry schedule.

Vercel routing, Supabase production TLS, the pg_net/Cron schedule, hosted credentials, and live phone enrollment still require deployment validation. The agent did not create accounts or buy hosting.
