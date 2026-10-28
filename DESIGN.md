# Loyalty Business design

Keep the forest green identity (#193d32) and soft neutral surfaces. Serif headlines belong on public storytelling and customer cards; operational copy, forms and data use readable system sans-serif. Avoid italic operational headings and oversized workspace headers as future screens are added.

Use an 8px spacing rhythm, 16px body text, short labelled groups, visible borders and compact report rows. Keep primary counter controls at least 44px high. Put current shop, customer, progress and reward eligibility ahead of decoration. Long shop names wrap without hiding sign-out.

Cards use the existing safe raster logo uploader and accessible foreground selection. Web previews must be labelled as web cards; native Wallet previews must not be implied. Public posters contain only signup URLs.

Forms preserve input on errors; use pending/disabled states during requests and live status text. Errors explain the next action. Do not replace genuine empty states with mock data. Confirm earning/redemption/corrections deliberately. Charts must be derived from recorded ledger events.

Use CSS for small transitions; respect prefers-reduced-motion. Do not animate QR pixels, move scanner targets or hijack scrolling. Focus must remain visible and tab navigation logical. Review at 360, 390, 768 and 1440px. New report screenshots and the scan/correction/session flow are exercised in tests/upgrade-browser.ts; other screens still require their own acceptance review.

The October 2026 review is implemented across the staff shell, counter, designer, team/reports, public pages and customer wallet. Use #customer-outcome for transaction announcements; #message remains workspace status. Keep corrections under #customer-secondary-actions and separate rule/region/validity saves in #settings-forms. Appearance previews always use savedGoal; unsaved target inputs must never alter the sample target.

Operational controls have 44px minimum hit areas (52px counter actions), strengthened #7D8B81 boundaries and #5E6D62 secondary text. Card goals above twelve use proportional progress rather than truncated stamp circles. Keep both card-label columns shrinkable, including nested brand text.

Acceptance evidence and limitations are in docs/design-implementation.md. The expanded upgrade browser suite covers 320/390/768/1024/1440px, long strings, goals 2/8/20/100, lookup ordering, cancellation, save boundaries, dialog/polling focus, recovery and poster readiness. Preserve native dialog behavior and browser chrome access; never add a custom keyboard trap just to defeat browser toolbar navigation.
