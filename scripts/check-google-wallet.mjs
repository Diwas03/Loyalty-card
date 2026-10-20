import "dotenv/config";
import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";

// Read-only credential verification. Never log tokens, assertions, private keys or raw responses.
const report = {};
try {
  const source = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    (process.env.GOOGLE_SERVICE_ACCOUNT_FILE ? readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8") : undefined);
  if (!source) report.status = "credentials_missing";
  else {
    const account = JSON.parse(source);
    const assertion = await new SignJWT({
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      aud: "https://oauth2.googleapis.com/token",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.client_email).setIssuedAt()
      .sign(await importPKCS8(account.private_key, "RS256"));
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(12000),
    });
    report.authentication = response.status;
    const token = await response.json();
    if (response.ok && token.access_token) {
      const list = await fetch("https://walletobjects.googleapis.com/walletobjects/v1/issuer", {
        headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(12000),
      });
      report.issuerLookup = list.status;
      const result = await list.json();
      if (list.ok) report.issuers = (result.resources || []).map(issuer => ({ id: String(issuer.issuerId), name: issuer.name }));
      else report.apiReasons = (result.error?.details || []).map(detail => detail.reason).filter(reason => typeof reason === "string" && /^[A-Z_]+$/.test(reason));
    } else if (typeof token.error === "string" && /^[a-z_]+$/.test(token.error)) report.oauthError = token.error;
  }
} catch {
  report.status = "verification_unavailable";
}
// Google setup is optional; a provider failure must not prevent browser cards from deploying.
console.log("GOOGLE_WALLET_CHECK " + JSON.stringify(report));
