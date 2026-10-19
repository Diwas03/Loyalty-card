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
      enabled: !missing(googleKeys).length,
      missing: missing(googleKeys),
    },
    apple: { enabled: !missing(appleKeys).length, missing: missing(appleKeys) },
  };
}
export function baseUrl() {
  const u = new URL(process.env.PUBLIC_BASE_URL!);
  if (u.protocol !== "https:")
    throw new Error("PUBLIC_BASE_URL must use public HTTPS");
  return u.origin;
}
