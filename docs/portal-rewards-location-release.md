# Customer and business experience release — 2026-11-13

This release follows the merchant's requests to separate the customer and business journeys, replace customer search with a reward queue, publish shop locations on cards, and refresh the visual design. It builds on production release `4eb64d3` on `release/instant-scan-stamps`; main is not merged or pushed. Git previews remain disabled for this exact release branch; production deployment is explicit.

## Behaviour

- Customer wallet: `/`. Shop owners and employees: `/business/login.html`. Customer pages have no business/sign-in links; business landing/login/dashboard have no customer-wallet or customer-signup shortcut. The owner displays or prints the shop QR; customers scan it to open the shop-specific self-registration page.
- Staff member details no longer expose `privateCardToken`; the private-card link and link-replacement UI are removed. The former staff link-rotation endpoint returns authenticated HTTP 410. Customer private-card saving and transfer remain customer functions. Existing private links remain valid: this change separates navigation and removes staff viewing features, without introducing separate domains or a new customer authentication model.
- The Rewards tab replaces Find a customer. It lists customers with available rewards, in pages of 50. Refresh and load-more controls show loading, empty and failure states. Hosted reads expire vouchers only for the active shop before building its queue. Staff select a customer, check their current balance and confirm redemption when providing the reward. Cancellation earns/redeems nothing; the existing request key protects retries and the database prevents double redemption. Scanning still automatically adds one stamp; a membership-ID fallback remains in the scanner for camera-access problems and never adds credit.
- Owners publish a public shop address/landmark and optional HTTPS Google Maps place/share link in Programs & cards. The form opens Google Maps externally so the owner can select a place/drop a pin and copy its Share link; an embedded Google Maps picker/geocoder is not claimed or required. An address can be entered without a map link. Both can be cleared. No API key, paid service or automatic geolocation is required. Only approved Google Maps URL forms are accepted; arbitrary/credential-bearing/script URLs are rejected.
- The address appears in wallet tiles and detailed customer cards; detailed cards include an Open in Google Maps link. Compact tiles do not contain nested links. Previously saved cards pick up updates when their existing refresh runs. Each shop's address stays separate.
- Operational location grants remain intact. The selector moves from the top bar into Scan → Work location, and is hidden when there is only one available workspace. Public shop location and the operating location recorded in the audit ledger are separate concepts.
- Shared visual refresh: neutral surfaces, teal navigation, indigo actions, reward accents, clearer section descriptions, card/metric hierarchy, focus/hover states and responsive layouts. Reduced-motion and forced-colour support remain. No made-up operational metrics, customer identities or shop addresses are introduced into production.

## Database and release safety

`supabase/shops.sql` adds only `shop_address` and `shop_maps_url`, non-null text with empty defaults and length limits. Existing data is preserved. The existing production transactional initializer installs the additive columns before serving the new API. No test record, seed, restore, balance reset, production credential or environment-setting change is needed. The broader readiness feature branch receives the same product changes separately; its read-only startup still requires reviewed operator migrations.

Application rollback can redeploy `4eb64d3`; the added columns may remain and must not be dropped to roll back the UI. Older code will not display the new address fields. Do not reset or reverse valid reward redemptions to roll back the application.

## Actual validation

All nine release checks passed locally with synthetic data and disposable loopback PostgreSQL: typecheck, build, 32 unit/integration tests, 16 hosted integration tests, browser smoke, scanner regression, upgrade browser, UI smoke and PWA smoke. After tightening cursor validation, build and hosted integration were repeated successfully.

New API assertions cover queue authentication, shop isolation (including no expiration of another shop's vouchers), voucher expiry, pagination without duplicates, explicit confirmation, replay-safe redemption, removal after redemption, owner-only address publication, invalid/script/spoofed Maps URLs, short Google Maps links, address-only settings and clearing. Owner and cashier details no longer contain private link fields.

Browser assertions cover absent cross-navigation, absent customer finder/private-link buttons, actual queue selection, cancel/confirm redemption, refreshed eligibility, owner location publication and its appearance on the real customer card, moved workspace switching, phone/tablet/desktop overflow checks, 200% zoom, reduced motion, forced colours and session/logout handling. Screenshots were generated and reviewed; artifacts/logs remain ignored under `data/` and `/tmp/loyalty-ui/`. No real production customer was used for validation. A physical phone camera and Google Maps place selection are operator acceptance checks; automated scanner tests simulate decode callbacks.

## Verified production deployment

- Live customer wallet: https://loyalty-card-pi.vercel.app/
- Owner/employee sign-in: https://loyalty-card-pi.vercel.app/business/login.html
- Production source: `87d58fd7b19890122b9c30fd64b40de01a6a3003` on `release/instant-scan-stamps`.
- Vercel deployment `dpl_H4MeUXBaTev15xgsfkggZMkseuhF` confirmed READY with the stable app alias.
- `/healthz?release=87d58fd` returned HTTP 200 with `status=ok`, `schema=coffee`, confirming transactional initialization completed. Public shop data exposes the new address/map fields without populating a fictional address.
- Eight live pages/assets (wallet, join, business landing/login/dashboard, staff script, card renderer and stylesheet) returned HTTP 200 and matched release source by SHA-256.
- Unauthenticated Rewards and staff shop requests returned HTTP 401. No real customer's card or reward was changed for live verification.
- The feature implementation is committed separately at `c5cd0a5`; all nine feature checks passed with 47 unit/integration and 16 hosted tests. Its backup guard was updated for the two new empty shop fields; operator SQL revocation tests remain intact without reintroducing staff link viewing.
- Remote main remained `997298a50072c150a2c9a0c0f42c06d570615122`. Both development branches were pushed; main was not merged or pushed.
- Remaining generated local fixture databases at cleanup: zero. Temporary PostgreSQL was stopped; browser/server checks closed their processes.

Owners should reload the dashboard, publish their real address under Programs & cards → Shop location, and use Print shop QR to display/print their shop-specific signup QR. Customers scan that QR and register themselves. The location form supports external Google Maps place selection and pasted Share links; it does not embed the paid Maps picker. Reload installed web apps to pick up the refreshed interface.
