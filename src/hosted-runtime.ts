import { requireLocalDatabase } from "./environment-safety.js";
import type { Pool } from "pg";
import { installHosted } from "./hosted-setup.js";

/** Public diagnostics contain a category only, never a raw driver message. */
export function startupFailure(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (code === "28P01" || code === "28000") return "DATABASE_AUTHENTICATION_FAILED";
  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") return "DATABASE_TRUST_CERTIFICATE_REQUIRED";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DATABASE_HOST_UNREACHABLE";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT") return "DATABASE_CONNECTION_FAILED";
  if (code === "42501") return "DATABASE_SETUP_PERMISSION_REQUIRED";
  if (code === "ENOENT") return "DATABASE_SCHEMA_FILE_MISSING";
  if (code === "42P01" || code === "42703" || code === "3F000") return "DATABASE_SCHEMA_INCOMPATIBLE";
  return "DATABASE_STARTUP_FAILED";
}

/** Prepare a new hosted database atomically before accepting API requests. */
export async function initializeHosted(db: Pool) {
  requireLocalDatabase((db as Pool & { options: { connectionString?: string } }).options.connectionString, "Schema initialization");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // All cold starts and manual setup share the same migration lock.
    await client.query("SELECT pg_advisory_xact_lock(7342101)");
    await client.query("SELECT pg_advisory_xact_lock(7342102)");
    await installHosted(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Vercel startup is read-only. Migrations are a separate reviewed release action. */
export async function verifyHostedSchema(db: Pool) {
  const required = ["shops","members","operations","ledger","issued_rewards","business_memberships","locations","location_grants","sessions","card_transfers","merchant_invites","pilot_readiness_versions"].map(name=>"coffee."+name);
  const result = await db.query("SELECT bool_and(to_regclass(name) IS NOT NULL) AND to_regprocedure('coffee.create_transfer(text,text)') IS NOT NULL AND to_regprocedure('coffee.staff_adjust(text,text,integer,text,text,text,text)') IS NOT NULL AS ready FROM unnest($1::text[]) AS name", [required]);
  if (!result.rows[0].ready || !(await db.query("SELECT 1 FROM coffee.pilot_readiness_versions WHERE version='20261102'")).rowCount)
    throw Object.assign(Error("Reviewed pilot migrations must be applied before startup"), { code: "42P01" });
}
