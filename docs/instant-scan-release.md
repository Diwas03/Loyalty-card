# Instant scan stamping release

Requested policy: one valid staff camera scan earns one stamp immediately. Restart the scanner and scan again for each additional stamp, without a cooldown. Manual lookup is read-only; no manual purchase button is available. Reward redemption and audited corrections remain confirmed.

Each scanner session stops after its first decoded QR. Repeated frames share that session; a lost response retains the same request key in sessionStorage, including after reload. The database returns the original result for retries. A pending request must be resolved before another customer is selected. Invalid and wrong-shop membership QRs are rejected.

## Production scope

The merchant explicitly approved live production deployment of this change. `release/instant-scan-stamps` starts at the existing production/main commit `997298a50072c150a2c9a0c0f42c06d570615122`. It excludes the broader backend pilot readiness work. Main is unchanged. Git preview deployments are disabled for this release branch only; production is an explicit Vercel API deployment.

The database change replaces only the scan function body in `supabase/schema.sql`, removing the five-second cooldown while retaining the transaction lock, request-key replay, cross-action key validation, existing purchase ledger/referral/reward behavior and job insertion. No table removal, data reset, seed, account change or credential change is required. The production baseline already runs the six reviewed SQL files transactionally during Vercel initialization; this release retains that path. Its health endpoint succeeds only after initialization completes. The workspace cannot directly resolve the database hostname, so no direct production SQL or production test records are used.

## Review and rollback

Compare this branch with main. Local checks use only disposable loopback PostgreSQL databases and synthetic records. Before releasing, run typecheck, build, unit/integration, hosted integration, browser, scanner, upgrade browser, UI and PWA checks.

To roll back application behavior, redeploy the previous production source commit `997298a50072c150a2c9a0c0f42c06d570615122`; its initialization reinstalls the previous cooldown function. No migration should remove customer history or earned stamps. Ask staff to reload the dashboard after release. Real-device camera acceptance remains a merchant check; automated scanner tests simulate repeated decoded frames against the real local API/database.

## Validation completed

All nine checks passed against this release source tree on 2026-11-02: typecheck, build, 32 unit/integration tests, 14 hosted integration tests, browser smoke, scanner regression, upgrade browser, UI smoke and PWA smoke. The scanner regression verifies two immediate intentional scans, duplicate decoded frames, wrong-shop/invalid rejection, lost-response retry after reload, and no purchase confirmation dialogs. UI/PWA harness fixes open the existing mobile navigation/disclosures and use the current accessible card name. Detailed logs remain in ignored `data/readiness-verification/`.

The broader feature branch separately passed all nine checks, with 47 unit/integration and 14 hosted integration tests. No production customer records were used for tests.

## Wallet dashboard follow-up

Customer wallet tiles now display a numeric count such as “3 of 8 stamps”, without a progress bar or stamp grid. Detailed card displays retain their existing progress visuals. The QR instruction now reflects automatic scan stamping. No database or API change is required. Typecheck, build, UI smoke and PWA smoke passed; a browser rendering check verified zero/partial/complete and 100-stamp targets without bars or overflow at 320, 390, 768 and 1440px.
