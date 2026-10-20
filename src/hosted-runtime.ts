import type { Pool } from "pg";
import { installHosted } from "./hosted-setup.js";

/** Prepare a new hosted database atomically before accepting API requests. */
export async function initializeHosted(db: Pool) {
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
