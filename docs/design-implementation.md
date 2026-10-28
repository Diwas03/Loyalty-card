# Design review implementation

Specification: Loyalty-Business-Design-Review.md and the accompanying pasted guidance, read in full on 27 October 2026. This is frontend work on the existing Express/TypeScript/plain HTML/CSS/JavaScript application. Production data and deployment are outside this change.

## Baseline and guardrails

- Existing owner/manager/cashier membership and location checks, short-lived refresh-safe staff sessions, explicit purchase confirmation, idempotency keys, redemption, private-link replacement and single-use transfer are implemented. Preserve their contracts.
- The prior design-review capture contains 48 real-UI screenshots with disposable fixtures. It is retained as the before evidence; generated review PDFs in output/ are unrelated user artifacts and must be preserved.
- Legacy staff.html/login.html/register.html redirect to canonical business pages. Preserve these aliases.
- Shared frontend IDs and form names are bound directly by staff.js/customer.js. Keep existing IDs; coordinate new layout wrappers and injected panels.
- Current defects confirmed in source: global and local camera errors, generic fallback labelling unknown events as redemptions, no lookup response ordering guard, unsaved target used in appearance preview, every team editor expanded, expired recovery re-enables an unusable action, and poster printing enabled before configuration/QR readiness.

## Ordered work

- [x] P0: compact role-filtered navigation, focused customer result, contextual confirmation, lookup ordering, local scanner feedback, distinct customer error/recovery/poster readiness states.
- [x] P1: shared operational typography/controls, explicit appearance/rules save scopes, preview layout, customer QR/reward hierarchy, compact wallet, bounded history and focus-safe polling.
- [x] P2: team summaries/edit disclosures, report/referral hierarchy, concise public/auth/enrollment pages and labelled sample web card.
- [x] Verification: existing suites plus targeted confirmation/cancel/retry, navigation/focus, save boundaries, dialog/recovery/poster and stress fixtures; responsive screenshots at 320/390/768/1024/1440; long names and goals 2/8/20/100.

## Selector map

Existing tab/panel, form, customer, scanner, preview, wallet, recovery and poster IDs remain stable. New explicit wrappers: #workspace-content (includes the dynamic report panel), #section-navigation/#section-toggle (mobile section chooser), #section-heading (task focus), #customer-result/#customer-actions/#customer-secondary-actions (counter view), #customer-outcome (single transaction announcement), and #settings-forms/#preview-disclosure (separate save scopes and sample preview). Detailed completed changes and actual test results will be recorded here.

## Implemented

P0, P1 and P2 frontend work is implemented. Existing API endpoints, transaction semantics, permission checks, private tokens and database schemas remain in place.

- Staff shell: role-filtered vertical tabs on desktop, labelled mobile disclosure, simple cashier navigation, directional keyboard handling and preserved hashes/scanner teardown.
- Counter: focused mobile result with Back to results, deliberate customer/shop/location confirmations, locally announced transaction outcomes, out-of-order lookup protection, controls disabled during verification, and secondary correction/private-link tools. Selecting another member clears the old outcome and correction inputs.
- Scanner: one local camera error, manual fallback, identification without credit.
- Designer: editor and labelled sample preview alongside each other; mobile preview disclosure; saved target in preview; independent appearance/rules/region/validity saves, dirty states and retained failed inputs. Regional defaults cannot be submitted before their actual values load.
- Customer: QR/progress and available rewards first; five initial activity entries; past rewards, tools and installation under disclosures; specific failed-card/retry state; distinct shop/member names on wallet shortcuts. Goals above twelve use proportional native progress. Long labels wrap without colliding. QR image nodes are reused on refresh.
- Focus: stable tools/history controls during polling; wallet storage updates refresh in place; unchanged shortcuts are not rewritten every poll; modal handlers are ready before the first data request resolves. Native modal semantics, title focus, Escape and return focus are preserved.
- Team: summary rows with one editor open, labelled location checkboxes preserving the API array payload, locations separated, existing-account invitations distinct from new account creation.
- Reports/referrals: grouped recorded counts with honest scopes, methodology disclosure, Sales Not tracked, customer CSV naming and explicit referral qualification/recipient copy.
- Public/auth/join: shorter introductions and a labelled illustrative web card. No fabricated counts, native passes or integrations.
- Recovery/poster: terminal failures stay disabled; retryable network failures remain retryable; printing requires a valid public HTTPS join URL and successfully loaded QR.

## Verification evidence

Executed against disposable loopback PostgreSQL fixtures, never the development membership data:

- `npm test`: 31 passed, 0 failed.
- `npm run test:hosted`: 14 passed, 0 failed. Covers tenant/location/role isolation, refresh sessions, ledger/idempotency, rewards, transfer, referral snapshot promises and provider credential blocking.
- `npm run test:browser`: passed. Legacy sign-in, enrollment, lost-response retry, earning/rollover, rejected/atomic redemption, saved goal and live customer refresh/history.
- `npm run test:scanner`: passed. Invalid/wrong-shop codes, duplicate credit/retry protection, owner appearance/logo publish, referrals/first paid purchase, two-shop wallet and refresh-safe sessions.
- `npm run test:upgrade-browser`: passed; final result recorded in `data/design-upgrade-final.log`. Expanded suite covers delayed lookup ordering, disabled verification controls, contextual cancellation without credit, failed appearance retention/save boundaries, native modal background exclusion/Escape/return focus, cross-tab and polling focus, terminal/retry recovery, print readiness, keyboard section navigation and layout stress.
- `npm run typecheck` and `npm run build`: passed.

Layout fixtures cover 320, 390, 768, 1024 and 1440 pixels; 80-character unbroken shop/card/member names, 120-character tagline, goals 2/8/20/100. Long-card stress screenshots directly exercise CardUI with synthetic values; their surrounding live fixture rule/reward context intentionally remains unchanged. They are rendering tests, not evidence of a saved 100-stamp programme. Screenshots and gallery are under `data/upgrade-screenshots/`. Prior before-review evidence remains under `data/design-review-2026-10-27/`.

## Limits and next checks

No production publishing, real customer mutations or credential setup was performed. Physical camera hardware, mobile operating-system keyboard behavior, screen readers and actual browser-toolbar 200% zoom still require device review. Automated enlarged-layout coverage uses CSS zoom; forced-colors coverage uses browser emulation. Native dialogs may move focus to browser chrome at the boundary; background page controls remain excluded.

Apple/Google native wallet delivery and external providers retain their existing credential/setup requirements. The local pilot explicitly disables external delivery. Sales remain untracked. No new spend programmes, refunds, campaigns, billing, imports or POS integrations are presented as working features.

Open the local preview at `http://127.0.0.1:3000/business/`; sign in with the existing local account, then hard-refresh the workspace. Review desktop/mobile counter and card screenshots, and perform a real-phone scan plus screen-reader pass before publishing.
