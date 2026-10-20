# Real wallet setup and protocol notes

Pilot update: Google Wallet is the default. Apple endpoints are retained, but issuance and new Apple jobs require `APPLE_WALLET_ENABLED=true`. Google object-not-found now pauses a job as `waiting-save`; reopening the original save link wakes it. The original Google Wallet test was reported successful by the owner; this is not independent verification of the new pilot or native iOS support.

## Documentation evidence

Reviewed 2026-10-19:

- [Official Google Wallet REST samples, loyalty implementation](https://github.com/google-wallet/rest-samples/blob/main/nodejs/demo-loyalty.js): retrieved via HTTPS Git at commit `5dd2268839290f9aaac91fd04f50047ab0573d87` (2026-09-09). Checked class/object creation, `UNDER_REVIEW`, required logo example, RS256 service-account signing, stable object references including class ID, and save-link form. This is Google-maintained source code, not a successful API call.
- [Google loyalty overview](https://developers.google.com/wallet/retail/loyalty-cards/overview), [web prerequisites](https://developers.google.com/wallet/retail/loyalty-cards/web/prerequisites), [issuer onboarding](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding), [LoyaltyClass REST reference](https://developers.google.com/wallet/retail/loyalty-cards/rest/v1/loyaltyclass), [LoyaltyObject REST reference](https://developers.google.com/wallet/retail/loyalty-cards/rest/v1/loyaltyobject), [JWT reference](https://developers.google.com/wallet/retail/loyalty-cards/reference/s2w-reference).
- [Apple Wallet passes](https://developer.apple.com/documentation/walletpasses), [PassKit package creation](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Creating.html), [updating a pass and web-service protocol](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Updating.html), [APNs provider API](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), [Apple PKI certificate downloads](https://www.apple.com/certificateauthority/), [Pass Type ID registration](https://developer.apple.com/help/account/identifiers/register-a-pass-type-id/).

**Access limitation:** direct requests to developers.google.com and developer.apple.com returned proxy HTTP 403, including after permission requests and a saved network allowlist draft. The Google official source repository was accessible through the platform Git proxy. The links above are the authoritative documentation to recheck, not pages claimed to have been read successfully in this session. Apple protocol implementation follows the documented PassKit v1 contract, but current Apple requirements, console wording, APNs acceptance and device compatibility remain **not yet verified** against live official pages. Do not interpret passing local signature tests as satisfying Apple account/certificate requirements. Recheck the official pages when network access is available before device testing.

## Google Wallet account steps

1. Sign into the [Google Pay & Wallet Console](https://pay.google.com/business/console) with the business Google account. Create a Wallet issuer account, complete its business profile and note its numeric issuer ID. Use this for `GOOGLE_ISSUER_ID`.
2. In Google Cloud Console, select/create a project and enable **Google Wallet API** (`walletobjects.googleapis.com`). Create a service account for this proof. Do not grant broad project Owner/Editor permissions just to issue Wallet cards.
3. In the Wallet issuer console, add that service account's email to the issuer's user permissions with the **Developer** role (or the least role the current console requires for class/object writes). Cloud project IAM alone does not give issuer access.
4. Obtain a service account RSA JSON key through your organization's supported secure process. Store it in a protected directory outside the repository, or ignored `secrets/` with restrictive permissions. Set `GOOGLE_SERVICE_ACCOUNT_FILE` to that path. Keep the JSON and private key server-side; never send them to the browser, paste them into chat, or commit them. Prefer managed signing/workload identity for a production deployment; this PoC uses a key file to keep infrastructure minimal.
5. The issuer initially operates in **Demo Mode**. Configure the issuer's test accounts in the Wallet console, including the Google account actually signed into Wallet on the Android phone. Demo passes are restricted to authorized test users and may show a demo/test indication. An ordinary public user is not a valid demo issuance test.
6. Provide a stable public HTTPS origin as `PUBLIC_BASE_URL`. Google must be able to fetch `/logo.png` without authentication. The save JWT restricts origins to the hostname. This implementation uses a server-generated save link, not the JavaScript save widget. Recheck current official branding/button requirements before external distribution; these are plain development buttons.
7. Restart the server and worker. Open the private membership page and select Add to Google Wallet. The server creates `${issuerId}.demo_coffee` with `reviewStatus: UNDER_REVIEW`, then `${issuerId}.${membershipUUID}` as an ACTIVE LoyaltyObject. Existing IDs are reused; it does not create a new membership on each save. Verify the API accepts the class/object and the Android test account can save the card.
8. Before public issuance, request **publishing access** in the issuer console and satisfy its current review/business requirements. Class review status and issuer publishing access are separate gates. Demo success does not establish publishing approval.

The server signs RS256 JWTs with `iss` = service account email, `aud` = `google`, `typ` = `savetowallet`, and a loyalty object reference; the resulting URL is `https://pay.google.com/gp/v/save/<jwt>`. It obtains OAuth access with the `wallet_object.issuer` scope and PATCHes the same object after balance changes. There is no wallet credential in frontend code. Reopening a link preserves the object ID, barcode and backend membership. Progress can lag because delivery and device refresh are asynchronous.

Required outbound HTTPS destinations: `oauth2.googleapis.com`, `walletobjects.googleapis.com`. The customer's browser also needs Google sign-in/Wallet destinations such as `pay.google.com`. The server does not need customer Google OAuth access.

## Apple Wallet account and signing steps

1. Use an active **Apple Developer Program** membership with access to Certificates, Identifiers & Profiles. Enrollment can require payment and business verification; this project has not enrolled or created any paid service.
2. Register a **Pass Type ID**, for example `pass.com.yourcompany.democoffee`. Set `APPLE_PASS_TYPE_ID` to that exact identifier and `APPLE_TEAM_ID` to your Apple Developer team ID.
3. Generate a CSR and private key securely (Keychain Access or your organization's key management procedure). Issue a **Pass Type ID certificate** for that identifier in the Apple developer account. This is not an Apple Pay payment-processing certificate or a website TLS certificate.
4. Export the certificate and its matching private key securely (often a `.p12`). Convert to PEM if necessary. Example commands prompt locally for export/import passwords; do not supply passwords in shell command arguments:

   ```sh
   openssl pkcs12 -in pass.p12 -clcerts -nokeys -out pass-cert.pem
   openssl pkcs12 -in pass.p12 -nocerts -out pass-key.pem
   # For a DER .cer downloaded directly from Apple:
   openssl x509 -inform DER -in pass.cer -out pass-cert.pem
   ```

5. Download the **current matching Apple Worldwide Developer Relations intermediate certificate** from Apple's PKI page; convert DER to PEM if required. Select the intermediate matching the signing certificate's issuer; do not assume an arbitrary old WWDR intermediate works. Check expiry and chain against Apple's published root certificate with OpenSSL:

   ```sh
   openssl x509 -in pass-cert.pem -noout -issuer -subject -dates
   openssl verify -CAfile apple-root.pem -untrusted wwdr.pem pass-cert.pem
   ```

   Preserve normal TLS and signature verification. Never solve signing failures by trusting a self-signed test CA on a real customer phone.
6. Set `APPLE_CERT_FILE`, `APPLE_KEY_FILE`, `APPLE_WWDR_FILE` to PEM paths and, for an encrypted key, configure `APPLE_KEY_PASSPHRASE` securely in the local environment. Restrict directory and file permissions. Do not put private material in `public/`, in source, in database backups distributed to others, or into chat. Test-generated keys are unrelated disposable fixtures.
7. Set a stable `PUBLIC_BASE_URL=https://your-authorized-test-origin` with a publicly trusted TLS certificate. The iPhone must reach `/apple/v1/...` callbacks. Do not put a login page, basic-auth prompt or tunnel interstitial in front of Apple's callback paths. Staff routes retain their own authentication. Restart server and worker after configuration changes.
8. Verify outbound HTTP/2 with client-certificate authentication to **production** `api.push.apple.com:443` from the test host. Pass update pushes use the Pass Type ID certificate/key, the pass type as APNs topic, and `{}` payload. This PoC uses certificate authentication, not an invented APNs bearer token. A development web server does not imply use of a sandbox pass certificate. Test the actual endpoint and inspect provider responses before claiming push support.
9. In Safari on an iPhone, open the private customer link, select Add to Apple Wallet and complete Wallet's Add flow. The response must be a signed `.pkpass`, not HTML renamed to that extension. Confirm registration in the backend, then run the **remote update** checklist. Downloading a second pass manually does not test pushes.

### Signing identity, renewal and secure storage

The pass's `passTypeIdentifier` and `serialNumber` together identify it. This PoC keeps the Pass Type ID and membership UUID stable and stores a separate random authentication token in SQLite. Do not change the team/pass ID, replace the database, rotate the token blindly, or generate a new serial number when updating progress. The archive contains `pass.json`, original placeholder icons, a SHA-1 file manifest (PassKit format) and a detached CMS signature containing the WWDR chain. HTTPS still uses modern TLS; the manifest algorithm is part of the pass package protocol.

Monitor signing certificate expiry and renew the certificate for the **same Pass Type ID**, with the matching private key and current chain. Update the protected files, restart server/worker and verify a newly signed update on an already installed card. Certificate expiry/revocation can break new issuance and pushes; do not wait for expiry. Retain a tested recovery plan for installed passes. For production, use a secret manager/encrypted signing service with restricted access and rotation, not world-readable PEM files. A cloud proxy's HTTPS secret substitution is not a substitute for local private-key material needed by CMS and HTTP/2 TLS signing.

### Implemented Apple v1 routes

| Method and route (under `/apple`) | Behavior |
| --- | --- |
| POST `/v1/devices/:device/registrations/:type/:serial` | `Authorization: ApplePass <per-pass-token>`, validates `pushToken`, returns 201 for new registration or 200 for existing |
| DELETE same registration route | Same authorization, removes registration, returns 200 |
| GET `/v1/devices/:device/registrations/:type?passesUpdatedSince=revision` | Protocol discovery by opaque device ID; no staff/pass authorization header required by this protocol; serial list and monotonic `lastUpdated`, or 204 when none changed |
| GET `/v1/passes/:type/:serial` | Requires ApplePass authorization; returns freshly signed current pass, correct MIME and Last-Modified; always 200 rather than conditional-cache optimization |
| POST `/v1/log` | Accepts diagnostic requests; intentionally discards their bodies |

The worker commits no loyalty operations. It only sends Google updates or Apple push hints. On Apple, the phone registers, receives a hint, asks which serials changed, and fetches the authenticated current pass. APNs accepting a push does not establish any of the phone steps completed. Invalid pass authentication is rejected, and expired APNs device registrations (HTTP 410) are removed.

## Public HTTPS test hosting

No deployment or tunnel was created. When you authorize a test host or existing tunnel, bind this app to its assigned port, route HTTPS to it, point PUBLIC_BASE_URL to that stable origin and preserve its database volume. Keep Apple callback routes reachable and allow the required outbound domains/protocols. Use the same origin when logging in as staff so origin checks and Secure cookies work. If using a tunnel, review its access policy and avoid exposing the seed lookup. Do not use a throwaway origin for cards you expect to keep updating after the tunnel expires.

A cloud environment configuration **draft** was saved with Google/Apple documentation and runtime destination domains. It does not apply runtime networking or publish anything by itself. Review and save the changes in environment settings, then publish the prepared environment if desired. Recheck documentation access after the networking change is actually applied; no automatic deployment is implied.
