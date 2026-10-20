import "dotenv/config";
import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
const source = process.env.DB_PATH || "data/coffee.sqlite";
const dest = resolve(
  process.argv[2] ||
    `data/backups/coffee-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
if (!existsSync(source))
  throw new Error("Database does not exist; start the app once first.");
if (existsSync(dest))
  throw new Error(
    "Destination already exists; refusing to overwrite a backup.",
  );
mkdirSync(dirname(dest), { recursive: true });
const db = new DatabaseSync(source);
try {
  await backup(db, dest);
  console.log("Consistent database backup saved: " + dest);
} finally {
  db.close();
}
