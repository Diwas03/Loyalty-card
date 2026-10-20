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
  return databaseAliases.map((key) => env[key]).find(Boolean);
}
export function databaseOptions(
  env: NodeJS.ProcessEnv = process.env,
): pg.PoolConfig {
  const value = databaseUrl(env);
  if (!value)
    throw Error(
      "Database connection missing: configure DATABASE_URL or the Supabase/Vercel POSTGRES_URL integration",
    );
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("Database URL must use postgres or postgresql");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
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
