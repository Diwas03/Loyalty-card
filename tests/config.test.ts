import { Client } from "pg";
import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseOptions, databaseUrl } from "../src/database-config.js";
import { publicBaseUrl } from "../src/config.js";
test("Supabase Vercel connection aliases work without disabling TLS verification", () => {
  const env = {
    POSTGRES_URL:
      "postgres://test:placeholder@db.example.com:6543/postgres?sslmode=require",
  };
  assert.equal(databaseUrl(env), env.POSTGRES_URL);
  const options = databaseOptions(env);
  assert.equal(
    (options.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized,
    true,
  );
  assert.ok(!String(options.connectionString).includes("sslmode"));
  const strict = databaseOptions({
    DATABASE_URL:
      "postgres://test:placeholder@db.example.com/postgres?ssl=0&sslmode=no-verify",
  });
  const client = new Client(strict) as unknown as {
    connectionParameters: { ssl: { rejectUnauthorized: boolean } };
  };
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(
    databaseOptions({
      DATABASE_URL: "postgres://test:placeholder@127.0.0.1/coffee_test",
    }).ssl,
    false,
  );
  assert.throws(() => databaseOptions({}), /connection missing/);
});
test("production Vercel origin is supported and never inferred from preview/request headers", () => {
  const before = {
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  };
  try {
    delete process.env.PUBLIC_BASE_URL;
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "loyalty-card-pi.vercel.app";
    assert.equal(publicBaseUrl(), "https://loyalty-card-pi.vercel.app");
    process.env.VERCEL_ENV = "preview";
    assert.equal(publicBaseUrl(), undefined);
    process.env.PUBLIC_BASE_URL = "https://coffee.example/path";
    assert.equal(publicBaseUrl(), undefined);
    process.env.PUBLIC_BASE_URL = "https://coffee.example/";
    assert.equal(publicBaseUrl(), "https://coffee.example");
  } finally {
    for (const [k, v] of Object.entries(before))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
