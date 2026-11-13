> Publication update: the user explicitly authorized disabling previews for this feature branch only, then pushing it and opening a draft PR. `vercel.json` now uses the documented exact branch rule `git.deploymentEnabled["feature/backend-pilot-readiness"]=false`. Main and all unspecified branches retain Vercel’s default behavior. This permits code-review publication **without a preview**, not deployment or access to production. The earlier staging-isolation findings remain a blocker to enabling any preview. See the publication verification appended below.

# Backend pilot readiness — feature branch only

Base: `997298a` (`origin/main`, fetched 2026-11-02). Worktree: `/workspace/loyalty-backend-pilot`.
No changes to the original checkout or its uncommitted work. No production deployment, migration, tests, seeds, settings changes or data reads are authorized in this exercise.

## Original preview push gate — superseded for code-only publication

Read-only Vercel environment **metadata** inspection on 2026-11-02 returned the same unscoped `DATABASE_URL` entry targeting both `production` and `preview`. `DATABASE_CA_CERT`, `STAFF_PASSWORD_HASH`, `PUBLIC_BASE_URL` and multiple provider file settings are also shared. Values were not decrypted/read. No isolated staging database/provider configuration was evidenced. At the original audit this blocked pushing. The later explicit authorization permits code-only publication with this exact branch’s Vercel deployments disabled; enabling a preview remains blocked. No Vercel settings were changed.

Owner action: provision/identify an already authorized isolated staging database; configure dedicated branch-scoped `STAGING_DATABASE_URL`, `APP_ENV=staging`, and staging origin, with external delivery disabled and the operator-verified production identity fingerprint. Ensure production database/provider secrets are absent from preview builds as well as runtime; verify database identity differs from production and the branch cannot use production aliases. Review the branch's fail-closed preview guard before enabling previews. Verify Git preview behavior and CI secret isolation. Code-only publication is already authorized with the exact feature-branch deployment exclusion in place; isolation is required before enabling any preview. Never merge/deploy automatically.

## Completed requirement checklist

“Verified complete” below means repository implementation and isolated local verification, not production launch approval.

| Requirement | Current implementation / relevant files | Completion evidence | Status / remaining owner |
|---|---|---|---|
| 1. Correct repo, latest base, isolated branch | Git remote is `Diwas03/Loyalty-card`; dedicated worktree and branch from `997298a`; original checkout untouched | Initial/final Git checks; remote main still `997298a` at final audit | Verified complete |
| 2. Production/preview boundaries | `environment-safety.ts`, `api/index.ts`, `hosted-runtime.ts` | No deployment/production DB connection; code-only push subsequently authorized with previews disabled; preview guard rejects inherited production identities, URI overrides, provider creds and missing fingerprint; cold start is read-only | Local guard verified; hosted isolation blocked (owner/platform operator) |
| 3. Isolated DB/tooling/secrets | Loopback PG 18.4 on port 55447; `run-tests.mjs`, `verify-pilot.mjs`, guarded CLI/server/worker/seed; `.env.example`, ignore files | Synthetic disposable per-fixture databases; production env aliases stripped; override-parameter tests; repeated seed/startup smoke | Verified complete locally; no shared staging authorized |
| 4. Durable audit and SQL package repair | This checklist; `vercel.json`, `vercel-package.test.ts` | Emulated Vercel bundle executes all seven SQL files, including readiness tables/functions; no reliance on historic PR evidence | Verified complete |
| 5. Scan/cancel/confirmed purchase/idempotency | Existing main's explicit confirmation retained; `hosted-app.ts`, `staff.js`, upgrade/scanner/hosted tests | Scan/cancel no credit; one confirmed purchase credits once; dropped-response/retry/concurrent duplicate tests | Verified complete |
| 5. Reward issue/redemption/terms/expiry | `rewards.sql`, existing upgrade tests, new migration/restore tests | Concurrent final redemption succeeds once; original labels/expiry retained; expiry reconciles ledger; customer reads return committed balance | Verified complete; legacy undocumented promises require merchant review |
| 5. Corrections | `pilot.sql`, new `staff_adjust` wrapper in `readiness.sql` | Bounds/reason/actor/idempotency/immutable audit retained; unassigned locations rejected; location stamped transactionally | Verified complete within supported limits; monetary/voucher/referral reversal remains out of scope |
| 5–6. Private links/transfer/recovery | Atomic `create_transfer`, `consume_transfer`, `rotate_private_link`; private token omitted for cashier/manager; minimal staff UI capability handling | Rotation closes old URL/QR-image/cookie mapping/transfers; stale transfer creation denied; conflict doesn't consume; concurrent single-use and expiry pass | Verified complete |
| 5–6. Reports/CSV/privacy | Existing reports preserved; CSV formula hardening and expiry reconciliation; tenant authorization before side-effecting reads | Shop/role tests, CSV formula-like legacy name test, correct counts, unauthorized cross-shop read cannot expire another shop's vouchers | Verified complete; existing manager shop-wide aggregate scope preserved pending merchant approval |
| 6. Shop/location/accounts/sessions | Active location check for reads and writes; workspace-switch escape remains allowed; DELETE session revokes bearer; logout clears recovery cookie | Disabled account/membership, shop/location/role, refresh/logout/expiry/revocation tests; no cookie-auth mutation bypass | Verified complete |
| 6. Abuse and pilot merchant approval | Existing shared-DB login/register/enroll limits plus 180/min/IP staff-sensitive limit; opt-in `PILOT_ONBOARDING_MODE=invite`, hashed atomic invites; fragment-only registration support | Uninvited/expired/reused/concurrent invite tests; existing business remains accessible; no default onboarding policy silently changed | Verified complete; merchant/operator chooses when to enable invitation mode |
| 7. Safe migrations/backup/restore | Additive reviewed `readiness.sql`; dedicated transaction and restored search_path; local-only full private-table/sequence JSON backup + restore | Six-file upstream fixture upgraded without ID/balance/voucher changes; serialized 0600 backup restored in fresh DB; login/redemption/immutability verified; sessions revoked, delivery quarantined | Verified complete locally; real production backup and authorized hosted restore remain external prerequisites |
| 8. CI and regressions | `.github/workflows/pilot-readiness.yml`; isolated PG 17 service; read-only permission; no deployment/secrets; fixed stale navigation/PWA harness assumptions | All nine requested local checks pass at source commit below; new regression tests cover risky seams | Repository CI config complete; GitHub execution not verified; PR creation currently blocked by API access |
| 9. Operations/monitoring/recovery/costs | `pilot-operations.md`, `ops/monitoring.example.yml`, safe correlation IDs, staging-only authenticated alert drill | Local alert endpoint test returns intentional 503, hidden in production; health/local server smoke passes | Repository support verified; real monitor notification, hosting plans/limits/costs and production recovery evidence require owner/operator |
| 10. Review/PR/main protection | Focused local commits, API contract, PR template and local PR body; no repo settings changes | Complete diff/secret-pattern audit and clean source tree; main-protection recommendations documented | Published for code review without previews; automatic draft PR creation blocked by GitHub API Forbidden |
| 11. Scope boundaries/referrals | No native activation, spend/refund/campaign/import/billing/VIP/POS expansion | Existing helper code left unactivated; full first-confirmed-paid-visit referral tests pass | Verified complete within pilot scope |
| 12. Devices/accessibility/release | `pilot-manual-acceptance.md` | Browser flows and 375/768/1440 UI checks plus upgrade suite's narrow/large layouts, keyboard, reduced motion, CSS 200% zoom | Real phones, real camera permissions/denial and assistive-tech usability remain manual partner tasks |

## Merchant policy boundaries

Use current main's explicitly confirmed stamp purchases (not historical automatic-on-scan behavior). Preserve one programme per shop, existing reward terms, current manager capabilities, and referral qualification after the first confirmed paid visit. No monetary refunds, voucher reversal, spend programmes, campaigns, imports, billing, VIP, POS or native-wallet activation. Corrections adjust only unconverted progress within `[0, goal-1]`; they do not retract issued rewards or referral bonuses. Changes to that rule require merchant approval before implementation.

## Latest follow-up verification

A second code review against the original prompt found and fixed two remaining safety gaps:

1. PostgreSQL identity fingerprints now compare canonical DNS and decoded URI identities, reject non-PostgreSQL inputs without echoing their values, and force an explicit preview port. Equivalent encodings/capitalization/trailing-dot spellings of production cannot masquerade as staging. Recompute operator fingerprints with the current helper before enabling a preview; independent infrastructure verification is still required.
2. Restore now locks and admits only untouched migration bootstrap rows, rejects configuration/invitation/application data and unknown snapshot versions, and no longer uses `TRUNCATE ... CASCADE`. A dependency from an unrelated schema causes rollback without deleting that schema's records. Tests verify the unrelated row and restored session replication mode remain intact.

The correction regression additionally asserts the exact actor, reason, location, stamp delta and zero reward delta, and rejects a correction that would cross a reward threshold. No merchant policy was changed, and no application schema migration was added by this follow-up.

**Validated source commit: `ed4bac1d14da21f26539eb3c5b0d76181b470f5e`.** `npm run verify:pilot` completed all nine commands with exit 0: typecheck, build, **47** unit/integration tests, **14** hosted tests, browser, scanner, upgrade-browser, UI, and PWA. Environment: Node 24.19.0, isolated PostgreSQL 18.4 on loopback port 55449, Chromium, synthetic fixtures only. This supersedes the original test counts below; original evidence is retained as history. Detailed local logs remain ignored under `data/readiness-verification/`.

External gates remain unchanged: actual staging/provider isolation, real production backup/authorized recovery, monitor notification delivery, commercial plan review, merchant decisions and real-device testing. The feature branch's preview exclusion remains mandatory. Earlier GitHub API access was forbidden; this follow-up does not claim a remote PR or CI result.

## Original verification evidence


Validated source commit: **`d6a8b079276c7cc56d13bed0eb3035f85dddf394`**. Documentation/release-artifact exclusions are committed afterwards without application changes. Environment: Linux, Node **24.19.0**, npm **11.9.0**, disposable PostgreSQL **18.4**, `/usr/bin/chromium`, synthetic data only. CI targets PostgreSQL 17; hosted CI itself was not run during that validation; later publication does not imply CI passed.

The aggregate runner `npm run verify:pilot` was run with a securely supplied loopback `TEST_DATABASE_URL` and `CHROMIUM_PATH`. It strips inherited production DB/provider/deployment credentials. All nine commands returned **exit 0**:

| Command | Actual result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm test` | **42 tests passed**, 0 failed; includes preview guards, authorization, merchant invitations, serialized restore, migration preservation and SQL packaging |
| `npm run test:hosted` | **14 tests passed**, 0 failed; hosted fixtures now create their own disposable database |
| `npm run test:browser` | Pass: local account/signup/purchase/reward/redemption/refresh/history |
| `npm run test:scanner` | Pass: invalid and wrong-shop QRs, confirmed-credit/retry behavior, branding/referral/two-shop wallet |
| `npm run test:upgrade-browser` | Pass: scan/cancel semantics, purchase/correction/reports, refresh/logout, transfer, locations, keyboard/zoom/layouts |
| `npm run test:ui` | Pass: current responsive navigation and all six baseline tabs at 375/768/1440; live reports additionally exercised by upgrade browser |
| `npm run test:pwa` | Pass: separate saved balances, current accessible card labels, install disclosure/prompt, manifest/icons and offline fallback |

Ignored detailed logs and machine-readable evidence: `data/readiness-verification/`. Do not upload these wholesale; screenshot/backup artifacts can contain synthetic or later real data. The initial UI/PWA harness failures were stale expectations from before the upstream redesign; corrected navigation/disclosure/accessible-name/confirmed-purchase assertions now exercise the current interface without weakening server controls. Initial npm installation used an unwritable default cache; switching only the cache to `/tmp` resolved it, without bypassing integrity verification.

Additional local development smoke: seed ran twice with fresh random synthetic credentials; exactly two independent memberships each retained one stamp and zero rewards. The real `pilot-server.ts` returned health 200, six static pages/assets 200, synthetic owner login 200 and the correct report (one qualifying visit). External delivery was disabled. The temporary server and coffee_dev database were stopped/removed.

Migration/restore evidence: tests first apply the six upstream SQL files, create three paid operations and a voucher with recorded 90-day terms, apply the new migration and compare complete membership/voucher rows and ledger counts. A separate 0600 serialized backup of a synthetic account, membership, ledger, voucher and sequence state is restored into a fresh `coffee_restore_*` DB, then old sessions fail, fresh login succeeds, redemption updates the restored card, ledger mutation is rejected, and restoring over occupied data is refused. Generated files/databases are removed. This does not establish a production recovery point.

No lint script exists. No paid resources, production data, external messages, live wallet authorization, GitHub CI execution or real monitor notification were used/claimed.

## Final review boundary and remaining launch actions

- Read-only Vercel metadata was inspected; production values were not decrypted and no project settings changed. Shared production/preview DB metadata still blocks enabling previews; it is not evidence of safe staging. Code-only pushes are permitted by the later explicit authorization and branch exclusion.
- Remote main was checked with `git ls-remote` and remains the base commit `997298a`. The original checkout remains clean on `fix/hosting-configuration` at its original source commit. At the original handoff no push, merge or deployment was performed. The subsequent authorized push is documented below; no merge or deployment occurred. No production database connection or data inspection occurred, so live records/behavior are not claimed to have been checked.
- See `pilot-operations.md` for migration-first deployment, backup/restore and incident steps; `pilot-api-contract.md` for contract/policy boundaries; `pilot-manual-acceptance.md` for partner device checks; `backend-pilot-pr.md` for the prepared draft PR body and later commands.
- Ready for **code review on the feature branch**, not an approved production release. External owners: platform operator for isolated preview config/production backup/alerts/plans; merchant for manager-reporting scope, onboarding mode and correction limits; partner for real devices/accessibility; separate reviewer for PR approval and protected-main checks.


## Authorized code-only publication follow-up

The user explicitly authorized: “Disable Vercel previews for the feature branch only, then push it and open a draft PR.” Official Vercel documentation was read at https://vercel.com/docs/project-configuration/git-configuration and confirms exact-branch `git.deploymentEnabled` rules, with unspecified branches enabled by default. `vercel.json` disables only `feature/backend-pilot-readiness`; there is no wildcard/main rule and no project-setting mutation.

The new exact-branch regression, typecheck and build passed. Commit `c08312a` and all preceding work were pushed to `origin/feature/backend-pilot-readiness`. Read-only Vercel inspection after the push found zero deployments for that branch in the latest 50 deployments; the latest production deployment ID and commit `997298a` were unchanged from the pre-push snapshot. These are observed checks, not permission to deploy manually or enable staging.

Draft PR creation was attempted with `gh pr create --draft --base main --head feature/backend-pilot-readiness --body-file docs/backend-pilot-pr.md`. GitHub's GraphQL API returned `Forbidden`; the repository REST permission lookup was also forbidden. No PR was created through these attempts and no restriction was bypassed. A repository user can open https://github.com/Diwas03/Loyalty-card/pull/new/feature/backend-pilot-readiness and choose **Create draft pull request**, using the prepared description. Alternatively restore authorized GitHub API access before retrying. No merge is authorized.

## Merchant-authorized instant scan update

The merchant subsequently requested automatic credit: each valid staff camera scan awards one stamp immediately, and each new scanner session can award another immediately. This supersedes the earlier confirmation/cooldown policy in the historical evidence above. Manual lookup remains read-only. Repeated decoded frames stop after the first result; network retries retain the same request key across reloads. Redemption and corrections still require confirmation.

Production deployment was explicitly authorized for this scan change. The isolated `release/instant-scan-stamps` branch starts from production/main `997298a`, includes only this scan change and its checks/documentation, and disables automatic previews for that exact release branch. Broader pilot readiness changes remain on this feature branch. Main is not merged or pushed.
