# Verification record

Verified 27 October 2026 against an isolated loopback PostgreSQL 17 cluster. No production customers or hosted database were used. Node 24, installed OpenSSL and the bundled Python runtime were used. Headless Microsoft Edge ran through the existing Playwright dependency.

| Command/check | Actual result |
|---|---|
| npm test | 31 tests passed, zero failures; includes real database fixtures, five upgrade workflows and two pure program-arithmetic tests |
| npm run test:hosted | 14 tests passed, zero failures; cold-start/repeat migration, legacy import, schema permissions, tenant separation, referral qualification and atomic redemption |
| npm run test:upgrade-browser | Passed refresh/logout, scan without automatic credit, explicit purchase, owner correction, report, camera-denied lookup, one-use transfer on a separate browser context, location creation and workspace switching |
| npm run test:browser | Passed legacy sign-in/enrollment/purchases/reward rollover/redemption/settings/live refresh/history |
| npm run test:scanner | Passed invalid/wrong-shop codes, repeated frames/retry safety, refresh-safe sessions, card branding/logo, first-purchase referral and two-shop wallet |
| npm run typecheck | Passed |
| npm run build | Passed |
| git diff --check | Passed after removing a trailing blank line |
| Development seed, repeated | Two independent businesses, each one membership with one stamp; no duplicate credit |
| npm run pilot + GET /healthz | Started on loopback with external wallet delivery disabled; returned status ok, schema coffee |

Local preview follow-up: fixed missing static-file middleware in pilot-server.ts (Vercel normally serves public files outside Express). Verified HTTP 200 for /business/, login, registration, dashboard, customer root, staff.js, style.css and the scanner bundle on the actual running pilot. Headless Edge confirmed the business page title and unauthenticated dashboard-to-login navigation with no script errors. Typecheck and production build passed after the fix.

No lint script is configured. Synthetic signing verifies the pass archive/signature mechanics; it is not an Apple-issued pass. Google tests use a local HTTP stub, not live issuer authorization. Scanner decoded frames are emulated; a physical camera/device permission test remains necessary.

Screenshots use synthetic fixture data. [360px report](screenshots/reports-360.png), [390px report](screenshots/reports-390.png), [tablet report](screenshots/reports-768.png), [desktop report](screenshots/reports-1440.png), [390px customer card](screenshots/customer-390.png). These are after-change captures; no pre-change screenshot was captured. The mobile report was visually reviewed as well as checked for horizontal overflow. Reduced-motion mode was enabled in the upgrade browser workflow.

The scanner regression exposed a real settings-loading race: the referral amount could be edited before the initial settings response arrived, which then replaced the edit. Referral fields now remain disabled during loading; the browser test exercises the saved amount through a first-paid-visit award.

Passing these suites does not establish completion of the full upgrade prompt. Spend programs, financial refunds, full program versioning, imports, growth modules and configured external integrations remain explicitly unchecked in implementation-plan.md.
