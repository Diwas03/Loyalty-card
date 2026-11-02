# Instant scan production deployment — 2026-11-02

The merchant explicitly approved live production deployment after previously restricting work to the feature branch. Only the requested scan change was released; the wider readiness branch remains separate.

- Live app: https://loyalty-card-pi.vercel.app
- Production Vercel deployment: `dpl_6tvRYES4F8UGdh3nxCFsqs5DVzwB`, confirmed READY, production target and stable alias.
- Deployed release source: `1868aebd24e1df8d1ff578cfd56b09a539d6dd90`, branch `release/instant-scan-stamps`, based on production/main `997298a50072c150a2c9a0c0f42c06d570615122`.
- Feature implementation: `14e5973b43f4f59c82c14d8290ea8d48939fb584` on `feature/backend-pilot-readiness`.
- Main was verified unchanged at `997298a50072c150a2c9a0c0f42c06d570615122`. Neither branch was merged into main.

Each valid staff camera scan adds one stamp without confirmation. Starting the scanner again permits another immediate stamp. Repeated frames and retried requests cannot duplicate credit; pending requests retain their key across reloads. Lookup remains read-only. Redemption/corrections still require confirmation. The release changes the existing scan function body to remove cooldown; it does not reset balances or add test records to production.

## Actual validation

All nine checks passed against the release source: typecheck, build, 32 unit/integration tests, 14 hosted integration tests, browser smoke, scanner, upgrade browser, UI and PWA. The feature source separately passed all nine checks with 47 unit/integration and 14 hosted tests. Scanner tests use synthetic customers and repeated decoded frames with a real isolated PostgreSQL/API, covering immediate rescans, lost responses/reload/retry, invalid and wrong-shop QRs, and absence of purchase dialogs. The release includes only small UI/PWA harness repairs for current mobile navigation/disclosures and accessible names.

Production checks after deployment:

- `/healthz?release=1868aeb`: HTTP 200, `status=ok`, `schema=coffee`. The release retains the production baseline’s transactional initializer, so this confirms initialization completed against the production database.
- Live `/staff.js` and `/business/dashboard.html` returned HTTP 200 and matched the release files by SHA-256; the manual purchase button is absent.
- An unauthenticated scan request returned HTTP 401. No authenticated production stamping, synthetic customer insertion, seed or test reset was performed.

The workspace database hostname lookup failed (`EAI_AGAIN`); it was not retried or bypassed. Vercel already had working database access and completed its existing initialization path. No production credential or project environment setting was changed. Git previews are disabled for the exact release branch in its configuration; production deployment was explicitly requested through the Vercel API. Feature previews remain disabled separately.

Local test fixture databases remaining at cleanup: zero. The temporary PostgreSQL server was stopped. Ignored detailed verification logs remain in each worktree’s `data/readiness-verification/`. Physical camera/device acceptance still requires a real phone; automated scanner tests simulate decode callbacks.

## Operator handoff

Reload the staff dashboard before testing. Scan once for one stamp; start the scanner and scan again for each extra stamp. On a network failure, resolve the retained request for that customer before starting another transaction. To restore the prior confirmation/cooldown behavior, redeploy the previous production source `997298a`; do not delete or reverse legitimately earned customer records. Release review notes are in `docs/instant-scan-release.md` on the release branch.

## Wallet count follow-up — 2026-11-02

Deployed release `4eb64d3fe145f2aa9c19fd48f624bf5cd6475da2` through production deployment `dpl_8WmdpmyeXa7G2wtrsYtsz8g58nxs` (READY, stable app alias). Wallet dashboard tiles now show counts such as “3 of 8 stamps” without bars; detailed cards retain their existing progress visuals. The live card renderer returned HTTP 200 and its SHA-256 matched the release. Typecheck, build, UI smoke and PWA smoke passed. A synthetic browser rendering check covered 320/390/768/1440px and zero/partial/complete/100-stamp goals with no bars or overflow. No API or database source changes were required. The same renderer change is committed on the feature branch as `5267354`. Main remains unchanged.
