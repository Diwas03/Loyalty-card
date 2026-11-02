# Draft PR: harden backend pilot workflows and isolate development/release tooling

## Problem and resulting behavior

Main already includes confirmed purchases, vouchers, an immutable ledger, transfers and tenancy. The audit found that shared preview database settings could point initialization at production, private-link rotation left a cookie recovery path, transfers were consumed before enrollment completed, and some reads/corrections missed location checks. This branch closes those gaps while preserving the pilot's stamp-only business rules.

- Preview startup fails before connection unless independently verified staging identity, clean preview credentials and disabled providers are configured. Cloud startup is read-only; migrations are explicit release work.
- Transactions protect recovery/rotation/invitation flows. Unassigned locations cannot read or mutate staff data; corrections include authorized location. Unexpected error logs expose only a correlation ID/fixed category.
- Private links are owner-only in staff detail responses; rotation invalidates prior cookies/transfers. CSV safely quotes formula-like names and reports settled expiry balances.
- Isolated local tooling, CI, preserved SQL-packaging regression, synthetic migration/restore rehearsal, operations and manual acceptance guides are included. No native-wallet, financial-refund, spend-programme or unrelated UI redesign is added.

## Validation

At source commit `d6a8b079276c7cc56d13bed0eb3035f85dddf394`: typecheck/build pass, 42 unit/integration tests pass, 14 hosted tests pass, and browser/scanner/upgrade-browser/UI/PWA scripts all pass on disposable loopback PG 18.4/Node 24/Chromium. Synthetic serialized backup/restore, upstream migration preservation and repeatable local seed/startup are verified. CI is configured for isolated PG17 with no deployment credentials; remote CI has not run. See `backend-pilot-readiness.md` for exact evidence and limitations.

## Do not push yet

Read-only Vercel metadata shows DATABASE_URL targeting both production and previews. Preview isolation is **not verified**, so this PR description is local only. No production settings, DB connections, pushes, merges or deployments were performed. Real staging monitor notifications, real production backup/authorized restore, plan/cost review and actual phone/camera acceptance are outstanding external release prerequisites.

## Policy and compatibility

Preserve explicit confirmation (scan/cancel earns nothing), supported progress corrections without monetary/voucher/referral reversal, snapshot reward terms, and existing manager shop-wide aggregate reporting. Merchant signoff on these policies is still needed before launch. Invitation-only merchant onboarding is opt-in and doesn't block existing authorized merchants. Cashier private-card links are removed from the API/UI; see the API contract. Apply reviewed migrations before the new application; reverting app code does not reverse migrations.

## Later review and release steps

1. Review the local branch/worktree against base `997298a`; review SQL and all privacy/contract changes first.
2. Operator verifies isolated staging DB/provider/build settings, configures the identity fingerprint, and confirms no production credentials reach preview builds. Do not edit production targets to achieve this. Re-run the local matrix and isolated staging migration/alert tests.
3. Only after that gate, run:
   ```sh
   git push -u origin feature/backend-pilot-readiness
   gh pr create --draft --base main --head feature/backend-pilot-readiness --title "Harden backend pilot readiness and isolate preview tooling" --body-file docs/backend-pilot-pr.md
   ```
4. Another reviewer approves; CI passes; comments are resolved; partner finishes physical devices/accessibility checklist. Configure recommended main protection separately through authorized repository administration.
5. Before any merge/release, obtain explicit authorization, verify production backup and isolated hosted restore, review merchant decisions and hosting limits/costs, and schedule the migration-first deployment.
6. An authorized DB operator applies the reviewed migration set transactionally and verifies it. Deploy the reviewed application separately. Check health, scoped access, synthetic release smoke (in staging) and operational alert routing; never seed/test production. Use application rollback without dropping additive schema, or a separately authorized recovery plan if data recovery is necessary.

No PR is merged or production release authorized by this draft.
