# Draft PR: harden backend pilot workflows and isolate development/release tooling

## Problem and resulting behavior

Main already includes confirmed purchases, vouchers, an immutable ledger, transfers and tenancy. The audit found that shared preview database settings could point initialization at production, private-link rotation left a cookie recovery path, transfers were consumed before enrollment completed, and some reads/corrections missed location checks. This branch closes those gaps while preserving the pilot's stamp-only business rules.

- Preview startup fails before connection unless independently verified staging identity, clean preview credentials and disabled providers are configured. Cloud startup is read-only; migrations are explicit release work.
- Transactions protect recovery/rotation/invitation flows. Unassigned locations cannot read or mutate staff data; corrections include authorized location. Unexpected error logs expose only a correlation ID/fixed category.
- Private links are owner-only in staff detail responses; rotation invalidates prior cookies/transfers. CSV safely quotes formula-like names and reports settled expiry balances.
- Isolated local tooling, CI, preserved SQL-packaging regression, synthetic migration/restore rehearsal, operations and manual acceptance guides are included. No native-wallet, financial-refund, spend-programme or unrelated UI redesign is added.

## Validation

Latest validated source commit `ed4bac1d14da21f26539eb3c5b0d76181b470f5e`: all nine checks pass—typecheck, build, **47** unit/integration tests, **14** hosted tests, browser, scanner, upgrade-browser, UI and PWA. This follow-up closes equivalent-URI fingerprint and destructive restore-cascade gaps, and strengthens correction audit/bounds tests. Synthetic serialized restore, upstream migration preservation and prior local seed/startup are verified. Tests use disposable loopback PG18.4/Node24/Chromium; CI is configured for isolated PG17, but no remote CI result is claimed. See `backend-pilot-readiness.md` for current and historical evidence.

## Publication without a preview

The user authorized disabling Vercel previews for `feature/backend-pilot-readiness` only, pushing that branch, and opening this draft PR. The exact branch rule in `vercel.json` disables its Git-triggered deployments; no wildcard or main rule is changed. This uses Vercel's documented `git.deploymentEnabled` behavior: unspecified branches default to enabled. See https://vercel.com/docs/project-configuration/git-configuration .

Preview database settings still share production configuration and are **not safe to use**. This PR must have no Vercel preview. Do not manually deploy it or remove the branch exclusion until staging isolation is verified. No project-wide Vercel settings or production deployment were changed to publish the code. The schema safeguards and all prior release gates remain in force.

## Policy and compatibility

Merchant-requested update: valid scans award one stamp immediately, each intentional rescan adds another, and retries/repeated frames cannot duplicate credit; manual lookup earns nothing, supported progress corrections without monetary/voucher/referral reversal, snapshot reward terms, and existing manager shop-wide aggregate reporting. Merchant signoff on these policies is still needed before launch. Invitation-only merchant onboarding is opt-in and doesn't block existing authorized merchants. Cashier private-card links are removed from the API/UI; see the API contract. Apply reviewed migrations before the new application; reverting app code does not reverse migrations.

## Later review and release steps

1. Review the local branch/worktree against base `997298a`; review SQL and all privacy/contract changes first.
2. This branch may be published only with its exact Vercel deployment exclusion in place. Before enabling any preview, an operator must verify isolated staging DB/provider/build settings and the identity fingerprint, without changing production targets. Re-run isolated staging migration/alert tests.
3. Keep this PR as a draft for review. Do not merge or manually deploy it under the publication-only authorization.
4. Another reviewer approves; CI passes; comments are resolved; partner finishes physical devices/accessibility checklist. Configure recommended main protection separately through authorized repository administration.
5. Before any merge/release, obtain explicit authorization, verify production backup and isolated hosted restore, review merchant decisions and hosting limits/costs, and schedule the migration-first deployment.
6. An authorized DB operator applies the reviewed migration set transactionally and verifies it. Deploy the reviewed application separately. Check health, scoped access, synthetic release smoke (in staging) and operational alert routing; never seed/test production. Use application rollback without dropping additive schema, or a separately authorized recovery plan if data recovery is necessary.

No PR is merged or production release authorized by this draft.


## Publication result

The branch was pushed with its exact Vercel preview exclusion enabled. A read-only post-push check found no feature-branch Vercel deployments and an unchanged production deployment. The branch-rule regression, typecheck and build pass. Automatic draft PR creation was attempted, but GitHub GraphQL returned `Forbidden`; no draft PR was created by that attempt. Use the GitHub PR creation form and choose **Create draft pull request**, or restore authorized API access. Do not merge or deploy.
