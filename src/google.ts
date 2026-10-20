import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";
import type { Member } from "./db.js";
import { baseUrl } from "./config.js";
const api = "https://walletobjects.googleapis.com/walletobjects/v1";
function account() {
  return JSON.parse(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE!, "utf8"),
  );
}
async function signed(payload: Record<string, unknown>) {
  const a = account();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(a.client_email)
    .setIssuedAt()
    .sign(await importPKCS8(a.private_key, "RS256"));
}
let tokenCache: { key: string; token: string; expires: number } | undefined;
async function access() {
  const a = account();
  const cacheKey = createHash("sha256")
    .update(a.client_email + a.private_key)
    .digest("hex");
  if (tokenCache?.key === cacheKey && tokenCache.expires > Date.now())
    return tokenCache.token;
  const assertion = await signed({
    scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    aud: "https://oauth2.googleapis.com/token",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`Google authentication HTTP ${r.status}`);
  const result = (await r.json()) as {
    access_token: string;
    expires_in?: number;
  };
  tokenCache = {
    key: cacheKey,
    token: result.access_token,
    expires: Date.now() + (Number(result.expires_in || 3600) - 60) * 1000,
  };
  return result.access_token;
}
export function googleClassId(m: Member) {
  const suffix = !m.shop_id || m.shop_id === "default" ? "demo_coffee" : "shop_" + m.shop_id.replace(/-/g, "");
  return `${process.env.GOOGLE_ISSUER_ID}.${suffix}`;
}
export function object(m: Member) {
  return {
    id: `${process.env.GOOGLE_ISSUER_ID}.${m.id}`,
    classId: googleClassId(m),
    state: "ACTIVE",
    accountId: m.id,
    accountName: m.name,
    barcode: {
      type: "QR_CODE",
      value: m.id,
      alternateText: "Demo Coffee membership",
    },
    loyaltyPoints: {
      label: `Coffee stamps (${m.stamp_goal || 8} earns a reward)`,
      balance: { string: `${m.stamps}/${m.stamp_goal || 8}` },
    },
    secondaryLoyaltyPoints: {
      label: "Available free coffees",
      balance: { int: m.rewards },
    },
  };
}
async function call(path: string, method: string, body?: unknown) {
  const r = await fetch(api + path, {
    method,
    headers: {
      Authorization: `Bearer ${await access()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (r.status === 401) tokenCache = undefined;
  if (!r.ok) {
    const error = new Error(`Google Wallet ${method} HTTP ${r.status}`) as Error & { providerMessage?: string };
    try {
      const failure = await r.json();
      // Kept separate from the public/audit message; used only by explicit setup verification.
      error.providerMessage = String(failure.error?.message || "").slice(0, 500);
    } catch {}
    throw error;
  }
  return r;
}
export async function ensureGoogle(m: Member) {
  const cls = {
    id: googleClassId(m),
    issuerName: m.shop_name || "Demo Coffee Shop",
    programName: `${m.shop_name || "Demo Coffee Shop"} Rewards`,
    ...(m.shop_color ? { hexBackgroundColor: m.shop_color } : {}),
    programLogo: {
      sourceUri: { uri: baseUrl() + "/logo.png" },
      contentDescription: {
        defaultValue: { language: "en-US", value: "Demo Coffee Shop" },
      },
    },
    reviewStatus: "UNDER_REVIEW",
  };
  try {
    await call("/loyaltyClass", "POST", cls);
  } catch (e) {
    if (!String(e).includes("409")) throw e;
    const { id, reviewStatus, ...branding } = cls;
    await call(`/loyaltyClass/${id}`, "PATCH", branding);
  }
  try {
    await call("/loyaltyObject", "POST", object(m));
  } catch (e) {
    if (!String(e).includes("409")) throw e;
  }
}
export async function updateGoogle(m: Member) {
  await call(`/loyaltyObject/${object(m).id}`, "PATCH", object(m));
}
export async function saveGoogle(m: Member) {
  await ensureGoogle(m);
  return (
    "https://pay.google.com/gp/v/save/" +
    (await signed({
      aud: "google",
      typ: "savetowallet",
      origins: [new URL(baseUrl()).hostname],
      payload: {
        loyaltyObjects: [{ id: object(m).id, classId: object(m).classId }],
      },
    }))
  );
}
