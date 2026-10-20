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
export function missing(keys: string[]) {
  return keys.filter((k) => !process.env[k]);
}
export function readiness() {
  return {
    google: {
      enabled: !missing(
        googleKeys.filter(
          (k) =>
            k !== "GOOGLE_SERVICE_ACCOUNT_FILE" ||
            !process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
        ),
      ).length,
      missing: missing(
        googleKeys.filter(
          (k) =>
            k !== "GOOGLE_SERVICE_ACCOUNT_FILE" ||
            !process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
        ),
      ),
    },
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
  const u = new URL(process.env.PUBLIC_BASE_URL!);
  if (u.protocol !== "https:")
    throw new Error("PUBLIC_BASE_URL must use public HTTPS");
  return u.origin;
}
