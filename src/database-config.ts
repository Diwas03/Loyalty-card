import pg from "pg";
pg.types.setTypeParser(20, Number);
export const databaseAliases = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;
export function databaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const values = databaseAliases.map((key) => env[key]).filter(Boolean);
  // A mistakenly copied Supabase HTTPS API URL must not hide a valid integration URI.
  return values.find((value) => {
    try { return ["postgres:", "postgresql:"].includes(new URL(value!).protocol); }
    catch { return false; }
  }) || values[0];
}
export function databaseOptions(
  env: NodeJS.ProcessEnv = process.env,
): pg.PoolConfig {
  const value = databaseUrl(env);
  if (!value)
    throw Error(
      "Database connection missing: configure DATABASE_URL or the Supabase/Vercel POSTGRES_URL integration",
    );
  let url: URL;
  try { url = new URL(value); } catch {
    throw Error("Invalid database connection: copy the PostgreSQL URI from Supabase Connect > Transaction pooler");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("Database URL is an API address, not a PostgreSQL connection. Copy the URI from Supabase Connect > Transaction pooler, including your database password");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!local && (!url.username || !url.password || /\[YOUR-PASSWORD\]/i.test(decodeURIComponent(url.password))))
    throw Error("Remote database URI requires the database username and actual password. Enter it through secure environment settings; never commit it");
  // pg's sslmode=require can silently replace verified TLS settings. Always configure trust explicitly.
  for (const key of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "sslnegotiation",
    "uselibpqcompat",
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    ssl: local
      ? false
      : {
          rejectUnauthorized: true,
          ...(env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT } : {}),
        },
  };
}
