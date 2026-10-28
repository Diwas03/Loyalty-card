# Loyalty upgrade: audit and implementation checklist

Audit date: 26 October 2026. Requirements: the complete user-supplied Codex_Loyalty_App_Upgrade_Prompt.md was read. This is a feature branch; no production deployment or production database access is authorized by that document.

Implementation and verification continued on 27 October 2026. See validation.md for commands actually run and screenshot artifacts.

## Baseline evidence

Stack: Express 5, TypeScript, PostgreSQL, plain browser JavaScript, existing Playwright. Vercel runs `api/index.ts` / `createHostedApp`; `npm start` runs the older single-shop `createApp`. These are materially different applications. New multi-shop pilot capabilities currently target the hosted application; do not imply local legacy parity.

| Feature | Baseline | Evidence |
|---|---|---|
| Tenant onboarding, separate shop balances | Working in hosted tests | `register_shop`, `shops.sql`, hosted shop-isolation test |
| Staff accounts, owner/staff permission checks | Working; limited model | `staff_profiles` has one shop per username; no manager/location memberships |
| Scan, earn, redeem, retry | Working, unsafe purchase inference | `scan_purchase`; originally scanning immediately credited a stamp |
| Atomic reward redemption/idempotency | Working | hosted concurrency and duplicate-operation tests |
| Web card design and logo | Working | `card-design.ts`, owner design and browser tests |
| Two-shop customer wallet, PWA, private-link restore | Working; device shortcuts | `card-ui.js`, `customer.js`, `sw.js`; balances are server records |
| First-paid-visit referral bonus | Working; refund reversal missing | `referrals.sql`, hosted referral tests |
| Sessions | Partial | bearer in memory, reload required login; fixed in this checkpoint |
| Google Wallet | Adapter implemented, live unverified | signed-JWT/HTTP-stub tests, issuer/account required |
| Apple Wallet | Legacy adapter only | synthetic certificate test; hosted route explicitly unavailable |
| Overview | Partial | actual operation counts, no spend amounts; no fabricated revenue |
| Ledger/refunds/rule lifecycle | Partial | immutable event ledger added; full refund and expiry models still pending |
| Spend programs, locations, roles, import, campaigns, billing/admin | Missing | no complete vertical implementations found |

Initial checks: typecheck and build passed; Docker unavailable. A separate PostgreSQL 17 cluster was created under ignored `data/upgrade-test-pg`, bound to loopback port 55439. Baseline hosted: 14/14 passed. Baseline local: 23/24 passed, certificate test could not launch its Python helper. Setting PYTHON_PATH to the installed runtime and adding Git's OpenSSL directory resolved this tooling failure.

## Architecture and safety decisions

- Preserve Express/plain JS; no framework migration or animation dependency.
- Add migrations to `installHosted` under its existing advisory locks and transaction.
- Preserve original IDs and balances. Existing private ID links remain valid until an owner explicitly replaces one. Replacement separates private link token from membership QR identifier.
- Keep privileged bearer tokens in memory. A scoped HttpOnly, SameSite=Strict cookie restores them through a same-origin JSON endpoint only. Cookie alone never authorizes a staff mutation. Fixed 30-minute server expiry, revocation and explicit logout remain enforced. Fifteen-minute open-page idle logout remains.
- New ledger entries capture signed deltas, resulting balances, rule goal, actor, reason and operation key. Import snapshots are opening balances, not sales. Updates/deletes are rejected; corrections append events.
- A bounded stamp correction is not a monetary refund. It cannot cross a reward threshold or change issued rewards. Refund behavior still needs a complete lifecycle before exposing refund controls.
- Reports explicitly state their migration-era scope; legacy opening rewards are excluded from newly issued totals. Sales are not tracked.

## Ordered checklist and acceptance

`[x]` implemented and tested; `[ ]` incomplete. No P0/P1 acceptance gate is claimed complete.

### P0 foundations

- [x] Baseline audit, isolated branch, real PostgreSQL tests. Preserve live data; no force push/deploy.
- [x] Explicit purchase confirmation after scan/manual lookup; unconfirmed credit rejected by both servers. QR scanning alone leaves balance unchanged.
- [x] Refresh-safe session restore; cross-origin/content-type checks, logout/expiry tests. No local-storage staff credential.
- [x] Hosted append-only ledger and bounded owner correction with actor/reason; duplicate correction keys replay exactly once; tenant and role rejection tests.
- [x] Additive private-link rotation; old public reads/QR access rejected; existing balances and scanner IDs preserved. Concurrent one-use transfer, expiry and rotation invalidation tested.
- [x] Business memberships and location grants backfill existing profiles. One account can accept a one-use invitation to another business and switch authorized workspaces. Owner/manager/cashier checks, disabled access, last-owner protection, session revocation, and location enforcement inside earning/redemption transactions are tested. Re-migration does not re-grant removed locations.
- [x] Individual issued rewards, preserved labels/validity, atomic available-to-redeemed transition and lazy expiry with compensating ledger. Issuance/expiry/concurrent redemption and repeat migration tested. Existing rewards are grandfathered without invented issue dates or expiry.
- [ ] Complete revoked state controls and refund/debt rules, including referral reversal. The schema reserves revoked status; no completed revocation/refund workflow is claimed. Already-spent refunds require a deliberate policy and tests.
- [ ] Full versioned program rules, closure and reward expiry. Existing programme_changes only records target changes.
- [x] Deterministic two-business development seed on an explicit loopback coffee_dev database; repeat-run verification retained exactly one membership and one stamp in each business. Local `npm run pilot` serves the hosted application against that isolated database.
- [ ] Harden per-route abuse budgets, sensitive-log review and migration rollback rehearsal.

### P1 merchant pilot

- [x] Preserve tested onboarding, card designer, signup QR, customer enrollment, multi-shop wallet and referral flow.
- [x] Staff can look up a membership and explicitly record a paid visit when camera access fails.
- [x] Owner correction, Reports tab and authorized CSV export. Export neutralizes spreadsheet formula prefixes.
- [x] Configurable hosted currency/country/timezone with Bhutan defaults, validated settings form. No phone is collected; +975 is explained as the Bhutan prefix.
- [x] One-use card transfer to another device; private links retained. This requires possession of the original card; it is not lost-account identity recovery.
- [ ] Guided setup with cafe/salon/retail templates, draft/preview/publish and completion checklist.
- [ ] Multiple independently versioned stamp/spend programs, integer minor amounts, rounding/remainders, stacking policy, dates, eligible locations and caps. `program-rules.ts` has unit-tested integer earning/cumulative-refund arithmetic only; it is not connected to a merchant workflow and is not a completed spend/refund feature.
- [x] Hosted customer voucher list with original reward labels, status, expiry and recent event history.
- [ ] Full configurable customer terms/expiry UX and optional verified lost-device account recovery.
- [x] Team role changes, access revocation, new locations, grants, existing-account invitations and workspace selector. Owner location creation/switching exercised in the browser.
- [ ] Location edit/deactivation and invitation cancellation UX, restricted notes and consent capture.
- [ ] CSV import mapping/preview/validation/duplicates/error report with traceable imported balances.
- [ ] Full reporting windows/timezone boundaries/refunds and repeat-visit denominators. Current report is deliberately scoped to actual migration-era events.
- [ ] Complete navigation/accessibility/slow-network acceptance across every new screen; legacy scanner/browser suites updated for intentional confirmation and session changes.

### P2, only after P0/P1 gates pass

- [ ] VIP window, progress/perks/demotion/refund behavior. No external credential dependency.
- [ ] Durable in-app inbox/campaign scheduling, consent, quiet hours, limits/retries. No external credential dependency for inbox.
- [ ] Provider email/SMS/web-push adapters with contract tests. Credentials/provider/country coverage block live delivery only.
- [ ] Native Wallet lifecycle: Google issuer authorization/live verification; hosted Apple signing/update adapter and certificate setup. Existing local tests do not certify live activation.
- [ ] Platform admin, entitlements, manual subscription/invoice state and audit; bootstrap admin outside merchant APIs.
- [ ] Signed versioned purchase/refund integration boundary, scoped keys, replay protection and delivery history. POS provider still unspecified.

### P3 backlog

1. Dedicated liability ledgers for store credit, cashback, gift cards and prepaid packages.
2. Paid membership renewal/cancellation lifecycle.
3. Reseller domains/branding after tenancy and entitlements pass acceptance.
4. Named POS connectors after provider selection and API verification.
5. Campaign experimentation after consent/delivery infrastructure is reliable.

## Resume sequence

1. Finish P0 reward/refund/rule lifecycle and add integration tests for partial/full refunds, already-spent rewards and referral reversal. The membership/location authorization model and two-business seed are now implemented.
2. Use the new isolated local pilot entry point for hosted-model development. Complete an explicit legacy installation migration path; do not silently import or overwrite public tables.
3. Complete P1 program/setup/import/customer flows and the eleven supplied acceptance scenarios.
4. Only then implement credential-independent P2 modules and configured provider adapters.
5. Review all migration and browser artifacts; merge/deploy only on separate authorization.
