# Pilot operations and release gates

This runbook is repository-side preparation, not authorization to run production commands. The feature branch must not be pushed until preview isolation is verified. No hosted staging database or alert integration was identified in this exercise.

## Environment model

- Local: disposable loopback `coffee_test`, `coffee_dev`, `coffee_case_*`, `coffee_restore_*`; synthetic data and separate credentials only.
- Preview: `VERCEL_ENV=preview`, branch-scoped `APP_ENV=staging`, **dedicated** `STAGING_DATABASE_URL`, `EXTERNAL_DELIVERY_ENABLED=false`, and an independently verified `PRODUCTION_DATABASE_IDENTITY_SHA256`. The runtime refuses to connect if this is incomplete or the staging identity matches that production fingerprint, an inherited database alias points anywhere other than staging, or provider/legacy-login credentials remain in the preview environment. Identity means host, port, database and username; passwords are never logged. All aliases are removed before choosing the explicit staging URI. Use exported `databaseIdentityHash` to compute the non-secret production fingerprint locally from secure settings without connecting or printing its URI. An operator must verify the real production/staging identities; an arbitrary fingerprint is not verification.
- Production secrets must also be absent from preview **builds**; runtime checks cannot protect against arbitrary build scripts that already received a secret. Override/remove preview entries with branch-specific staging values without changing production targets, and audit build environment inheritance before pushing.
- Do not make a production URL look different by changing only its password. Shared Supabase pooler hosts require verifying the username/project reference and actual project ownership, not just a different host string.
- Production: existing settings unchanged during development. Before an authorized release, review the real target, backup and schema; apply migrations separately, then deploy code. Vercel startup only checks the readiness marker and never installs schemas.
- Local operator scripts refuse remote DBs and arbitrary database names. They cannot be used to apply production migrations or restore production. This deliberate boundary requires an authorized database operator for real releases.
- Provider delivery is disabled in staging/previews and local standalone processes, even if credentials accidentally exist. Tests remove inherited DB/provider/deployment settings before execution and use local stubs. No external messages are sent by test fixtures.

### Explicit local use

Node 24, PostgreSQL 17+ and Chromium are required. Set `TEST_DATABASE_URL` to an isolated loopback `/coffee_test` using secure local settings; do not put real secrets in commands or documentation. `npm ci`, `npm run verify:pilot` (set `CHROMIUM_PATH` if needed). Each DB fixture gets a generated database and is removed; hosted tests no longer reset the shared test parent database.

For manual hosted-parity development, set `DEV_DATABASE_URL` to a loopback `/coffee_dev` and use `npm run pilot`. `npm run seed:development` only admits that explicit local database and refuses non-seed data. Never copy a production .env into this worktree.

## Migration ordering and compatibility

1. Review all files in `src/hosted-setup.ts`: `schema`, `shops`, `referrals`, `pilot`, `rewards`, `tenancy`, `readiness`. Vercel packages **all seven** files; the packaging regression initializes a temporary DB from an emulated bundle.
2. Review existing main and these migrations on a fresh isolated database and a representative synthetic old schema. `initializeHosted` permits local targets only; it locks and executes transactionally. `installHosted` uses a dedicated connection when passed a pool, preserving its original search path. Failure rolls back the caller's transaction or owned transaction.
3. Before an authorized hosted migration, a DB operator must execute the reviewed files in one dedicated transaction with both advisory locks (7342101 then 7342102). Use the same migration order, do not cherry-pick only the marker statement, and keep `search_path` session-local or restore it after the transaction. Operators must verify the exact connection identity independently; repository local CLI safeguards are not permission to run remotely.
4. The new readiness migration is additive: invites, a version marker, transaction wrappers and functions. No existing IDs, balances, voucher labels or expiries are rewritten. Old main remains compatible with the additional objects.
5. Verify schema objects and tests before deploying the new application. Cloud startup requires marker `20261102`; merely deploying code against an old schema returns a controlled 503 instead of migrating it.
6. Roll back application code if needed; **do not drop migrations to roll back**. Existing rewards/ledger records must remain. A database restore is a separate approved recovery event with data-loss/RPO implications, not an application rollback.

## Backup and isolated recovery rehearsal

`backup:pilot` and `restore:pilot` intentionally support only local rehearsal. Set `PILOT_BACKUP_DATABASE_URL` securely; `npm run backup:pilot -- data/backups/synthetic.json` writes a consistent JSON snapshot of every private-schema table plus sequence state (0600 file, ignored directory). It refuses overwrite.

Restore into a **fresh** loopback database named `coffee_restore_<hex>`: set the dedicated target, then `npm run restore:pilot -- data/backups/synthetic.json`. The CLI refuses an existing application schema. The restore routine requires local superuser privileges to suspend data triggers during replay; check/unique constraints remain enforced, every FK relationship is explicitly checked, and triggers are re-enabled before commit. This prevents replaying rewards/referrals/immutable-audit triggers. Sequences are restored. Staff sessions, transfer links, team/merchant invitations and rate-limit state are revoked; undelivered jobs are quarantined. Test fresh login, card balance, voucher terms, redemption and immutable audit afterwards. The automated rehearsal serializes to a 0600 file, restores into a generated DB, verifies those behaviors, and removes the file/DB.

A real production backup and an **authorized** hosted recovery rehearsal remain release prerequisites. A DB operator should use provider backups or version-compatible `pg_dump --format=custom --schema=coffee` through a secure libpq service profile, not a URI on the command line. Include schema definitions, all private tables, sequences, routines, triggers, RLS and extension dependencies (including pgcrypto's actual schema). Verify backup encryption, permissions, retention, off-site accessibility, checksum, recovery point and restore time. A JSON data snapshot alone is not a complete disaster-recovery strategy.

Restore such a dump into a new authorized isolated database first, with the same required extension schemas. Use reviewed `pg_restore` ordering; never restore over live data as a routine test. Revoke sessions/invites, quarantine delivery and verify counts/ledger/vouchers/FKs/sequence values/application flows. Decide how to handle private links that may have been revoked after the backup recovery point. Do not claim this production prerequisite is complete based on local synthetic tests.

## Health, monitoring and alert drill

- Monitor `GET /healthz`: expect 200 with `status: ok`. The DB query plus read-only cold-start schema check expose missing DB/schema as failure without credentials.
- Provider-neutral recommended checks are in `ops/monitoring.example.yml`; this is a specification, not a deployed alert integration. Configure an already approved monitor to alert after consecutive failures, route to the designated operator, and document acknowledgement/escalation.
- Track function 5xx/latency, DB connections/storage, job retry/failed/blocked counts and verified backups. Never export customer records, private-link URLs, cookies, Authorization headers or request bodies to telemetry.
- Responses include random `X-Request-ID`; unexpected error JSON includes the same `requestId`. Server errors log only fixed event/category and correlation ID. Investigate using that ID and time, then inspect authorized business audit records separately.
- Staging alert test: configure a random 32+ character `STAGING_ALERT_TEST_TOKEN` only in an isolated staging environment. Authorized `GET /api/ops/alert-test` with its bearer token intentionally returns 503 and a correlation ID. The route is hidden without valid auth, outside APP_ENV=staging, or on Vercel production. Use a secure monitoring header setting; do not put the token in a URL or terminal command. Verify an actual alert is received and acknowledged, then remove the temporary drill check/token. This branch tested the route locally, **not** a real monitor notification.

## Incident handling

1. Record time, request ID and affected shop/location; never collect customer private URLs or passwords in an issue.
2. Confirm DB/hosting health read-only. A transient UI timeout is not evidence a purchase failed: retry the **same** idempotency key, not a new purchase.
3. Check ledger events, account/location permissions, voucher state and durable jobs using approved access. Do not edit ledger rows.
4. For mistaken progress awards use the bounded, audited adjustment flow. It cannot cross the reward threshold, retract issued vouchers, undo redeemed rewards or reverse referral bonuses. Do not substitute monetary refunds.
5. Disable compromised membership through authorized team controls; this revokes sessions. Rotating a card link also revokes browser recovery mappings and outstanding transfers. Transfers are short-lived and single-use.
6. Separate provider-delivery failures from balance commits. Do not replay quarantined jobs until target/provider credentials and intent have been reviewed.
7. Any hotfix, production migration, restore or release requires fresh authorization and the review gates below.

## Commercial launch checks — owner action

Verify current Vercel and Supabase plan eligibility for commercial use, function duration/concurrency, bandwidth, DB storage/connections/pooler limits, backup/PITR availability, restore access, cron frequency, logs/retention, domains/TLS and any provider costs. Record expected usage, soft/hard limits, budget alerts and an accountable operator. No billing, plan or account settings were inspected or changed here. Do not assume a free preview plan is suitable for commercial production.

## Main protection recommendation (settings not changed)

Require PRs, another person's approval, passing isolated checks, resolved review comments, and restricted direct/force pushes. Use no production secrets in PR workflows or untrusted branches; avoid `pull_request_target`. CI has read-only repository permission and no deployment steps. Review reusable workflow/action versions and external service access before enabling required checks.
