import "dotenv/config";
import { openDb } from "../src/db.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
const dest = resolve(
  process.argv[2] ||
    `data/backups/coffee-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const db = openDb();
const c = await db.connect();
try {
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let schema = process.env.BACKUP_SCHEMA;
  if (!schema) {
    const r = (
      await c.query(
        "SELECT to_regclass('coffee.members') IS NOT NULL AS coffee,to_regclass('public.members') IS NOT NULL AS legacy",
      )
    ).rows[0];
    if (r.coffee && r.legacy)
      throw Error(
        "Both schemas exist. Set BACKUP_SCHEMA=coffee or public explicitly.",
      );
    schema = r.coffee ? "coffee" : "public";
  }
  if (!["coffee", "public"].includes(schema))
    throw Error("BACKUP_SCHEMA must be coffee or public");
  const backup: {
    schema: string;
    createdAt: string;
    tables: Record<string, unknown[]>;
  } = { schema, createdAt: new Date().toISOString(), tables: {} };
  const tables = (
    await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
      [schema],
    )
  ).rows;
  for (const t of tables) {
    const name = String(t.table_name);
    backup.tables[name] = (
      await c.query(`SELECT * FROM "${schema}"."${name.replaceAll('"', '""')}"`)
    ).rows;
  }
  await c.query("COMMIT");
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  writeFileSync(dest, JSON.stringify(backup, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log("Consistent private database backup saved: " + dest);
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await db.end();
}
