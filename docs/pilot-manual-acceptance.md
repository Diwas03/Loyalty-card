# Partner acceptance checklist — isolated staging and synthetic customers only

Record device/OS/browser, build commit, shop/location, date and observed result. Desktop automation is not proof of physical camera or real-phone usability. Do not paste credentials, private links or customer documents into bug reports.

## End-to-end and devices

- [ ] iPhone Safari browser and installed PWA; Android Chrome browser and installed PWA.
- [ ] Owner creates/uses an approved pilot business; individual cashier signs in to an assigned location. Customer joins via the public **shop** QR (not another person's card).
- [ ] Scan shows customer details; balance remains unchanged until explicit qualifying-purchase confirmation.
- [ ] Cancel purchase: no stamp, no purchase audit, no referral payout. Confirm once: exactly one credit.
- [ ] Scan an unrelated QR, signup QR, unknown membership and another shop's card: clear invalid message, no changes.
- [ ] Simulate lost connection after confirmation; retry the pending action, do not create a new purchase; earn once.
- [ ] Reach target, see the promised reward and expiry; redeem once, refresh the customer's committed balance. Two staff devices attempting the same last reward cannot both redeem.
- [ ] Referral friend joins from public invite and makes the first confirmed paid visit: original customer earns the configured bonus once. Signup/cancel/retry alone earns none.

## Camera and accessible navigation

- [ ] Grant permission; rear/front selection if available, portrait/landscape, dim light and long shop names.
- [ ] Deny/revoke camera permission, retry, cancel scanner, background/reopen app: camera releases and a clear error explains the next step. Manual lookup identifies a member without earning credit.
- [ ] Keyboard-only: skip link, tabs/section navigation, forms, dialogs, confirmation/cancel, focus return and readable error announcements.
- [ ] 200% zoom and narrow phone width: no lost buttons/text, no clipped navigation, horizontal scrolling only where intentionally provided.
- [ ] Screen reader: labels, balances/rewards, scan status, dialog names and error messages. Color is not the sole signal.

## Access, sessions, corrections and recovery

- [ ] Cashier cannot configure rewards, export CSV, correct progress, rotate private links or manage team through UI or direct API.
- [ ] Owner/manager/cashier location grants work; disabled membership/account and inactive/unassigned location deny access. Switching to an authorized location works.
- [ ] Refresh restores only an unexpired authorized workspace; logout/expiry/revocation prevents restoration. Customer PWA never authenticates staff endpoints via cookie.
- [ ] Unsaved design warning is usable before navigation; owner publishes a card without changing existing earned reward terms.
- [ ] Bounded correction records actor, reason, location and resulting progress; cannot cross the target or reverse a voucher. Cashier correction denied.
- [ ] Rotate private link: old URL, old QR-image URL, old browser recovery and outstanding transfer fail. New owner-issued link preserves balance.
- [ ] Transfer link works once on another device, expires after 10 minutes, rejects reuse. A browser with a different same-shop card gets a conflict without losing the token.
- [ ] Reports/CSV match fixture ledger and shop permissions. Formula-like names open as text. Use synthetic data; destroy the exported file after checking.

## Operational release gates (not completed by phone testing)

- [ ] Independent reviewer verifies preview DB/provider isolation before branch push.
- [ ] Authorized production backup and isolated hosted restore rehearsal verified; sessions revoked and delivery quarantined after restore.
- [ ] Staging monitor alert drill received/acknowledged by the intended operator; production alert endpoint remains unavailable.
- [ ] Hosting commercial eligibility, limits/costs, backup retention and incident ownership recorded.
- [ ] Another person reviews PR, all CI checks pass, comments resolved; explicitly authorize migration and production deployment separately.
