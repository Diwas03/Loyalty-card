import "dotenv/config";
import { readFileSync } from "node:fs";
import { hostedPool } from "../src/hosted-db.js";
const db = hostedPool();
try {
  await db.query(readFileSync("supabase/schema.sql", "utf8"));
  console.log("Hosted private schema installed.");
} finally {
  await db.end();
}
