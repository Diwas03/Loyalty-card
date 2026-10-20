import "dotenv/config";
export const googleKeys = [
  "GOOGLE_ISSUER_ID",
  "GOOGLE_SERVICE_ACCOUNT_FILE",
  "PUBLIC_BASE_URL",
];
export const appleKeys = [
  "APPLE_PASS_TYPE_ID",
  "APPLE_TEAM_ID",
  "APPLE_CERT_FILE",
  "APPLE_KEY_FILE",
  "APPLE_WWDR_FILE",
  "PUBLIC_BASE_URL",
];
export function publicBaseUrl(): string | undefined {
  const configured =
    process.env.PUBLIC_BASE_URL?.trim() ||
    (process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
      : undefined);
  if (!configured) return undefined;
  try {
    const u = new URL(configured);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}
export function missing(keys: string[]) {
  return keys.filter((k) =>
    k === "PUBLIC_BASE_URL" ? !publicBaseUrl() : !process.env[k],
  );
}
export function readiness() {
  const googleMissing = missing(
    googleKeys.filter(
      (k) =>
        k !== "GOOGLE_SERVICE_ACCOUNT_FILE" ||
        !process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    ),
  );
  return {
    google: { enabled: !googleMissing.length, missing: googleMissing },
    apple: {
      enabled:
        process.env.APPLE_WALLET_ENABLED === "true" &&
        !missing(appleKeys).length,
      missing:
        process.env.APPLE_WALLET_ENABLED === "true"
          ? missing(appleKeys)
          : ["Apple Wallet is optional and disabled"],
    },
  };
}
export function baseUrl() {
  const origin = publicBaseUrl();
  if (!origin)
    throw Error("Configure PUBLIC_BASE_URL as a public HTTPS origin");
  return origin;
}
