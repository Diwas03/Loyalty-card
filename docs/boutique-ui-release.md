# Boutique wallet and owner workspace — 2026-11-13

## Delivered experience

This release applies the latest two-portal design brief directly to the existing semantic HTML, CSS and vanilla JavaScript application. It introduces no frontend framework, paid service, analytics tracker or new backend dependency. Customer and business navigation remain separate.

- `public/design-system.css` contains the shared visual layer and page-specific styles: alabaster `#FAFAF9`, white surfaces, obsidian `#0F172A`, slate secondary text, emerald actions, hairline borders, soft elevation, frosted dialogs and card surfaces. The existing `style.css` retains layout and compatibility rules.
- Inter, Plus Jakarta Sans and JetBrains Mono are self-hosted under `public/fonts/`, with their license files. Headings, UI and stamp/code values use their respective type families. No third-party font request is needed.
- The customer wallet has a sticky wordmark/header, a device-connectivity pill and Add Card trigger. An empty wallet shows a clearly labelled illustrative sample card, with Scan shop QR and Paste link actions. Real saved-card tiles retain numeric stamp counts without progress bars.
- Add Card uses a centered desktop dialog and mobile bottom sheet, with Scan/Paste tabs, camera framing guides, keyboard support, focus restoration, camera-denied paste recovery and the original same-origin link validation.
- Detailed real cards keep shop branding and live stamp balances, with a stamp grid/progress indicator and QR/member-code toggle. A short CSS entrance transition introduces the detail card without depending on experimental cross-document browser APIs. Reduced-motion users do not receive decorative animations. Real QR images remain untouched and serve the existing scanner.
- Private card utilities, installation guidance, card rules and referral sharing use progressive disclosure. Customers have a dedicated copy-private-link action plus existing share/transfer tools and a privacy notice.
- Business login and registration use a split form/showcase composition on desktop and a focused single-column form on phones. Password visibility is explicit, local and reversible; the existing authentication requests and session policy are unchanged. The showcase is labelled illustrative and contains no real customer or live business metrics.
- The owner dashboard has icon navigation, four compact KPIs backed by the existing API, a scan-focused counter action and the existing live card appearance/rules preview. Metrics are total members, active customers, qualifying visits over 24 hours and available rewards. No repeat-rate trend, points programme or untracked sales metric is invented.
- Rewards is deliberately minimal: eligible customer names, available reward counts and a Confirm reward button. History, diagnostics and correction utilities are outside that tab. A confirmation dialog remains required. A previous network-ambiguous redemption can be checked using its retained request key, including after reload; this conditional recovery control is not shown in the normal list.

## Compatibility and scope

Existing element IDs and API hooks are preserved. The scanner's member-result panel moves out of Rewards into the scanner section. Intentional QR scans still add one stamp automatically; no manual stamp issuance is reintroduced. The existing customer storage, shop isolation, customer self-registration through the owner's shop QR, public shop address/Maps publishing, role permissions, session expiry, vouchers, referrals and audit logic remain in use.

The application remains a PWA. Touch controls use at least 44px hit areas, safe-area padding is supported, private pages remain network-backed, and the service worker's offline fallback is unchanged. The actual device-connectivity pill does not claim the server is synchronized. Sample cards are clearly identified; real customer data is used only through existing authenticated/private APIs.

## Validation

Validation uses disposable loopback PostgreSQL and synthetic accounts/cards only. The release checks include typecheck, build, unit/integration, hosted integration, browser, scanner, upgrade-browser, UI and PWA checks. New browser coverage checks the simple Rewards list, cancel/confirm redemption, lost-response retry across reload without double spending, password visibility, empty-wallet actions, camera-denied paste recovery, modal tab visibility and QR/code toggling.

Screenshots cover 320/390/768/1024/1440px layouts, long text, stamp goals 2/8/20/100, 200% CSS zoom, reduced motion and forced colours. Desktop/mobile wallet, login and Rewards screenshots were reviewed and refined. Detailed logs/screenshots remain in ignored `data/` and `/tmp/loyalty-ui/`; illustrative test data should not be mistaken for production figures. Physical phone camera acceptance remains a device check; automated scanner tests use controlled decode callbacks.

No SQL migration, customer balance reset, production seed, credential change, billing change, main merge or main push is needed. Production rollout is an explicit deployment from the release branch; automatic previews remain disabled for that exact branch. The broader readiness branch receives the same product changes without shipping its unrelated backend work to production.

## Completed validation and compatibility detail

All nine checks passed on the release tree: typecheck, build, 32 unit/integration tests, 16 hosted tests, browser, scanner, upgrade browser, UI and PWA. The broader readiness branch separately passed all nine checks with 47 unit/integration and 16 hosted tests. UI and PWA checks were repeated after the final font, empty-wallet, password visibility and QR/code refinements. The final member-code response assertion and production build were also checked.

The backward-compatible `membershipCode` response field contains the same stable membership ID encoded in the staff-scanned QR, rather than the private card URL token. A test explicitly separates the private token and membership ID to verify this. No existing response field or customer link is removed.

## Verified production rollout

- Customer wallet: https://loyalty-card-pi.vercel.app/
- Owner/employee sign-in: https://loyalty-card-pi.vercel.app/business/login.html
- Deployed source: `6106b1fd974e496e7a18537ad51db9dc6effbbd8` on `release/instant-scan-stamps`.
- Vercel deployment `dpl_H5AtNEAjnRiVqYhRXwrbtFgpiDo5` was READY, production target, with the stable app alias.
- Production `/healthz?release=6106b1f` returned HTTP 200, `status=ok`, `schema=coffee`.
- Twelve live pages/assets, including customer wallet, business login/register/dashboard, scripts, design-system CSS and all three WOFF2 fonts, returned HTTP 200 and matched the source files by SHA-256.
- Unauthenticated `/api/staff/rewards` still returned HTTP 401. No production customer was created or redeemed for verification.
- The same product changes are on the readiness feature branch at `a3512f3`. Its final unit run passed 47/47; the release unit run passed 32/32. The membership-code/private-token assertion passed.
- Main remained `997298a50072c150a2c9a0c0f42c06d570615122`; neither branch was merged into main.
- A leftover synthetic fixture from an earlier interrupted browser test was removed from the task-owned loopback cluster. Remaining generated fixtures: zero. Temporary PostgreSQL was stopped.

Reload the installed web app/dashboard to pick up the new interface. Camera permission, real-phone camera performance and native PWA install gestures remain device-level acceptance checks. Browser coverage uses synthetic local records and controlled QR decode callbacks, with actual camera-denial recovery also checked.
