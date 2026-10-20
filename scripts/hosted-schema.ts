import "dotenv/config";
import { hostedPool } from "../src/hosted-db.js";
import { initializeHosted } from "../src/hosted-runtime.js";
const db = hostedPool();
try {
  await initializeHosted(db);
  console.log("Hosted private schema installed.");
} finally {
  await db.end();
}
