import "dotenv/config";
import { hostedPool } from "../src/hosted-db.js";
import {
  installHosted,
  hostedStatus,
  importLegacyPublic,
  configureHostedCron,
} from "../src/hosted-setup.js";
import { baseUrl } from "../src/config.js";
// Run with the private provider connection in your local environment. Never supply secrets as CLI arguments.
const db = hostedPool();
try {
  await installHosted(db);
  console.log("Private coffee schema installed.");
  if (process.argv.includes("--import-public")) {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(7342101)");
      await c.query("SELECT pg_advisory_xact_lock(7342102)");
      console.log(await importLegacyPublic(c));
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  if (process.argv.includes("--cron")) {
    if (!process.env.CRON_SECRET)
      throw Error("Set CRON_SECRET securely before enabling retries");
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await configureHostedCron(c, baseUrl(), process.env.CRON_SECRET);
      await c.query("COMMIT");
      console.log(
        "One-minute retry schedule configured; existing app-specific schedule replaced.",
      );
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  const status = await hostedStatus(db);
  console.log(JSON.stringify(status, null, 2));
  if (!status.owners)
    console.log(
      "Owner still required: run npm run hosted:staff -- owner owner in an interactive terminal.",
    );
  if (status.legacyPublicTables && !process.argv.includes("--import-public"))
    console.log(
      "Legacy public tables detected. Stop the legacy server and back up before explicitly importing.",
    );
} catch {
  console.error(
    "Hosted configuration could not complete. Check the verified database connection, schema ownership, migration conflicts and optional extension availability. No credentials were logged.",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
