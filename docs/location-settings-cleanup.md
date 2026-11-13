# Consolidated location settings

Shop location configuration is in one place: **Programs & cards → Shop location**. The existing address and Google Maps form remains there. Optional operating counters are now in an **Advanced: service counters** disclosure within that same section, rather than a separate management control in Team.

The sidebar label is now **Team**. Staff assignment fields use **Counter access**. The scanner's **Current counter** selector changes only where the active session records transactions; it is not another address editor. Existing locations, grants, staff access, shop address data and customer-card display are preserved. No database/API migration or data deletion is involved.

The location list refreshes when the owner opens Programs & cards, and loading failures are displayed there. Existing backend authorization remains unchanged.

Validation: production build, UI smoke across phone/tablet/desktop layouts, and the full upgrade-browser flow passed. The latter publishes the address, creates an operating counter from the consolidated section, switches the session to it and verifies its recorded context. No new tests mirroring the layout were added; the existing flow was updated for its new navigation path. All data used for validation was synthetic and local.
