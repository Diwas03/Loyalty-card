import { domainToASCII } from "node:url";
import { createHash } from "node:crypto";
import { databaseAliases, databaseUrl } from "./database-config.js";

export function requireLocalDatabase(value: string | undefined, purpose: string): URL {
  let url: URL;
  try { url = new URL(value || ""); } catch { throw Error(`${purpose}: an explicit disposable local PostgreSQL database is required`); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !/^\/coffee_(?:test|dev|case_[a-f0-9]+|restore_[a-f0-9]+)$/.test(url.pathname) || url.search || url.hash)
    throw Error(`${purpose}: refusing a non-disposable or remote database; use loopback coffee_test, coffee_dev, coffee_case_* or coffee_restore_*`);
  return url;
}
function identity(value: string): string {
  const u = new URL(value);
  if (!["postgres:","postgresql:"].includes(u.protocol) || !u.hostname || !u.username) throw Error("Invalid PostgreSQL identity");
  if ([...u.searchParams.keys()].some(key => !["ssl","sslmode","sslcert","sslkey","sslrootcert","sslnegotiation","uselibpqcompat"].includes(key)) || u.hash) throw Error("Unsupported database identity parameters");
  const user = decodeURIComponent(u.username);
  const database = decodeURIComponent(u.pathname.slice(1)) || user;
  // PostgreSQL decodes URI credentials/database names; DNS names are case-insensitive.
  // Fingerprints must identify the destination, not a particular URL spelling.
  const hostname = domainToASCII(decodeURIComponent(u.hostname)).toLowerCase().replace(/\.$/, "");
  if (!hostname) throw Error("Invalid database host");
  return [hostname, u.port || "5432", database, user].join("|");
}
export function databaseIdentityHash(value: string) {
  try { return createHash("sha256").update(identity(value)).digest("hex"); }
  catch { throw Error("Database identity requires a valid PostgreSQL URI without connection overrides"); }
}
/** Must run before opening a connection, including during a preview cold start. */
export function runtimeEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.VERCEL_ENV !== "preview") return env;
  const staging = env.STAGING_DATABASE_URL;
  if (env.APP_ENV !== "staging" || !staging || env.EXTERNAL_DELIVERY_ENABLED !== "false" || !/^[a-f0-9]{64}$/.test(env.PRODUCTION_DATABASE_IDENTITY_SHA256 || ""))
    throw Error("Preview isolation is not configured; no database connection was attempted");
  let stagingIdentity: string;
  try {
    const parsed = new URL(staging);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.pathname.slice(1) || parsed.search || parsed.hash) throw Error();
    stagingIdentity = identity(staging);
    if (databaseIdentityHash(staging) === env.PRODUCTION_DATABASE_IDENTITY_SHA256) throw Error();
    if (databaseAliases.some(key => env[key] && identity(env[key]!) !== stagingIdentity)) throw Error();
    if (["GOOGLE_SERVICE_ACCOUNT_JSON","GOOGLE_SERVICE_ACCOUNT_FILE","GOOGLE_ISSUER_ID","APPLE_PASS_TYPE_ID","APPLE_TEAM_ID","APPLE_CERT_FILE","APPLE_KEY_FILE","APPLE_WWDR_FILE","APPLE_KEY_PASSPHRASE","STAFF_PASSWORD_HASH","CRON_SECRET"].some(key=>env[key])) throw Error();
  } catch { throw Error("Preview must use a distinct verified database identity and contain no production aliases or provider credentials"); }
  const result = { ...env };
  for (const key of databaseAliases) delete result[key];
  const explicit = new URL(staging);
  explicit.port ||= "5432"; // Do not let inherited PGPORT select a different destination.
  result.DATABASE_URL = explicit.toString();
  return result;
}
export function requireLocalOperator(purpose: string, env: NodeJS.ProcessEnv = process.env) {
  return requireLocalDatabase(databaseUrl(env), purpose);
}
export function externalDeliveryAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV !== "preview" && env.APP_ENV !== "staging" && env.EXTERNAL_DELIVERY_ENABLED !== "false";
}
