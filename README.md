# Demo Coffee Shop · Wallet proof of concept

A single-shop, single-seeded-member TypeScript app. The backend is authoritative: one paid coffee earns one stamp; stamp eight issues one free-coffee reward and resets stamps to zero. Unused rewards remain when the next cycle starts. Redemption consumes one reward and never earns stamps. The membership UUID, Google object ID, and Apple serial number remain stable.

**Working locally:** browser membership card/QR, protected staff UI/API, persisted transactions and idempotency, atomic redemption, durable background delivery/retries, Apple registration/discovery authentication, signed pass generation with synthetic certificates, and Google JWT/REST contract tests. **Not verified:** live issuance, push delivery, or any physical phone. No mock wallet button claims success. The actual wallet buttons are disabled until their server configuration is present; a configured button is not proof of valid credentials or approval.

## Run locally

Requirements: Node **24.x**, npm; OpenSSL and Python 3 for signing-integrity tests. No database service, Docker, cloud service, SMS or payment setup is needed.

```sh
npm ci --cache /tmp/npm-cache
cp .env.example .env  # only if .env does not already exist
npm run staff-password
npm run typecheck
npm test
npm start
```

In another terminal, from the repository root:

```sh
npm run worker
```

Open the local server on port 3000. The customer page seeds and displays one test member. Keep its private `/?member=...` link. `/staff.html` redirects to staff sign-in. Look up the membership UUID (printed below the QR), or scan with the camera, then explicitly confirm a purchase or redemption. Browser camera access requires HTTPS or localhost and user permission. The staff page shows the official backend balance separately from delivery jobs; re-run lookup to refresh status. Refresh the customer page to update its browser card.

Run `npm run dev` for server watch mode. Restart the worker after changing its code or `.env`. Commands resolve files relative to the repository root. Both processes **must use the same DB_PATH**. Keep **one worker** for this PoC; it serializes deliveries. Do not run multiple independent app deployments with separate copies of the database.

Without a password hash, staff login fails closed. There is no built-in password. The local helper prompts without displaying input and saves a salted scrypt hash in ignored `.env`; it does not save the plaintext password. Never put any password, service account JSON, certificate private key or passphrase into chat or Git.

## Infrastructure and data

Express serves a small static UI and REST endpoints. Node's SQLite driver provides a disk-backed WAL database (default `data/coffee.sqlite`). SQLite transactions contain the balance change, idempotency result, and two outbox jobs, so wallet failures cannot roll back a paid coffee. `BEGIN IMMEDIATE` serializes competing mutations across SQLite connections. No Redis or external database is needed for one-shop testing. Back up the database and its WAL consistently (stop both processes first, or use SQLite's backup mechanism). Deleting the database creates a different member and invalidates old cards.

The random UUID in all three QRs contains no contact info, balance or staff secret. It is a bearer identifier for the customer card; treat its link as private. It authorizes **no** purchases or redemptions. Customer details are a placeholder display name only. Staff uses an eight-hour, server-side session, HttpOnly/SameSite cookies, secure cookies on HTTPS, login rate limiting, JSON-only mutations and origin checks. Every staff mutation also requires an explicit confirmation and a stable `Idempotency-Key`. A network retry of the same action in the same tab reuses its key, retained across reloads in sessionStorage until success. Resolve an ambiguous action before choosing another action or switching tabs; a separate tab has a separate key. Check the balance before starting a new request after losing that tab's state. For this PoC there is one shared staff account, no account management or audit UI.

`operations` is an immutable request/result ledger. It prevents duplicate submission of the **same request key**, not two distinct staff confirmations of the same physical coffee. An eventual POS integration should use its sale ID as the durable idempotency key.

## Wallet integration and configuration

See [account setup and official references](docs/WALLETS.md) and [test checklist](docs/TESTING.md). `.env.example` contains blank credential placeholders only. Credentials are loaded exclusively by the server/worker. Browser responses never contain Apple's pass authentication token or signing keys. The authentication token is necessarily embedded in the signed Apple pass and is used only by Wallet's web-service protocol.

Google uses one LoyaltyClass and one LoyaltyObject per member, an RS256 server-signed save URL, and PATCH on the existing object. Apple serves a CMS-signed store-card archive with QR/stamps/rewards and `application/vnd.apple.pkpass`; its device registration, update discovery, authenticated pass retrieval and deregistration endpoints are implemented. The worker sends empty-payload HTTP/2 APNs pushes with the pass certificate; Wallet then discovers and fetches current pass data. Saving/downloading another archive is **not** an automatic-update test.

The public HTTPS origin and signing identity must remain stable once a pass is installed. On HTTPS the anonymous seed-discovery API is disabled by default: get the seed's private URL locally before setting PUBLIC_BASE_URL, or read only its ID using the command in the checklist. `DEMO_PUBLIC_CUSTOMER=true` deliberately exposes this demo membership to everyone with the test origin; do not enable it on a public deployment. Do not deploy or buy a service as part of these instructions without making that decision yourself.

## Queue semantics

Run `npm run worker` alongside the server. Failed attempts retry exponentially from 2 seconds up to one hour, indefinitely. Missing credentials are marked `blocked` and checked every minute. `working` jobs carry a two-minute crash-recovery lease. Pending/retry state persists across process restarts. Deliveries read the latest backend balance rather than replaying old balance snapshots. Google may return 404/retry before the object has first been issued; opening its real save link creates it and allows later retries to succeed.

`delivered` means Google accepted a REST update or APNs accepted the push requests, **not that a phone refreshed**. `no-device` means no Apple device was registered, so nothing was pushed; the latest balance is included on initial save. APNs 410 removes expired device registrations. Repeated pushes are harmless update hints. After a partial Apple push failure, all remaining registered devices can receive another hint on retry. Apple update discovery uses a monotonic global database revision, not a timestamp; initial registration discovers the current revision. Pass retrieval always returns a freshly signed current archive (HTTP 200, including on conditional requests) rather than risking a stale 304 during rapid same-second purchases. `/apple/v1/log` accepts and discards diagnostics to avoid retaining sensitive device data.

## Validation and limitations

`npm test` currently executes 10 meaningful tests: duplicate earning; rollover/reward retention; concurrent redemption through separate worker-thread connections using the real transaction function; staff authorization/confirmation/origin enforcement; durable failure/retry after reopening SQLite; Apple registration/discovery/removal; explicit disabled wallet routes and QR output; Apple archive hashes/CMS signature and stable identity; Google signed JWT and update payloads; blocked jobs with missing credentials.

Synthetic Apple CA/signing certificates and a stubbed Google HTTP provider exist only inside tests and temporary directories. They do **not** create usable phone wallet passes. Test files remove those temporary keys. No Apple Developer membership, Google issuer approval, credentials, public callback origin or physical device was supplied, so live end-to-end behavior is unverified.

Official Google-maintained REST sample code was retrieved and reviewed. Direct Google/Apple documentation requests were denied by the cloud proxy; current console steps and Apple's current documentation could not be independently verified here. Exact source links, inspected revision and verification limitations are in `docs/WALLETS.md`.

No deployment was performed. Real-device callbacks require a user-provided public HTTPS test origin with a valid TLS certificate. APNs additionally needs outbound HTTP/2 connectivity and certificate authentication. A proxy supporting only ordinary fetch/HTTP/1.1 may not support this APNs client: verify from your intended test host. This is a one-member integration experiment, not a production loyalty platform.
