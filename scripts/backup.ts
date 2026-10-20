import "dotenv/config";
import { openDb } from "../src/db.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// PostgreSQL backup: dump all tables as JSON to a timestamped file.
const dest = resolve(
  process.argv[2] ||
    `data/backups/coffee-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);

const db = openDb();
try {
  const tables = [
    "members",
    "operations",
    "jobs",
    "registrations",
    "sessions",
    "meta",
    "staff_accounts",
    "wallet_issuance",
    "programme",
    "programme_changes",
    "customer_enrollments",
  ];
  const backup: Record<string, unknown[]> = {};
  for (const table of tables) {
    const { rows } = await db.query(`SELECT * FROM ${table}`);
    backup[table] = rows;
  }
  writeFileSync(dest, JSON.stringify(backup, null, 2));
  console.log("Database backup saved: " + dest);
} finally {
  await db.end();
}
