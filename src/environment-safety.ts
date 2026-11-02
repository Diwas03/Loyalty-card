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
  return [u.hostname, u.port || "5432", u.pathname, u.username].join("|");
}
/** Must run before opening a connection, including during a preview cold start. */
export function runtimeEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.VERCEL_ENV !== "preview") return env;
  const staging = env.STAGING_DATABASE_URL;
  if (env.APP_ENV !== "staging" || !staging || env.EXTERNAL_DELIVERY_ENABLED !== "false")
    throw Error("Preview isolation is not configured; no database connection was attempted");
  let stagingIdentity: string;
  try {
    const parsed = new URL(staging);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw Error();
    stagingIdentity = identity(staging);
    if (databaseAliases.some(key => env[key] && identity(env[key]!) === stagingIdentity)) throw Error();
  } catch { throw Error("Preview database must be explicit and distinct from inherited database identities"); }
  const result = { ...env };
  for (const key of databaseAliases) delete result[key];
  result.DATABASE_URL = staging;
  return result;
}
export function requireLocalOperator(purpose: string, env: NodeJS.ProcessEnv = process.env) {
  return requireLocalDatabase(databaseUrl(env), purpose);
}
export function externalDeliveryAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV !== "preview" && env.APP_ENV !== "staging" && env.EXTERNAL_DELIVERY_ENABLED !== "false";
}
