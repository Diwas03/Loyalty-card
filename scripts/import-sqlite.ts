import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { hostedPool } from "../src/hosted-db.js";
const source = process.env.DB_PATH || "data/coffee.sqlite";
if (!existsSync(source)) throw Error("Local database not found");
const local = new DatabaseSync(source, { readOnly: true });
const db = hostedPool();
const c = await db.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(7342101)");
  if (
    Number(
      (await c.query("SELECT count(*) FROM coffee.members")).rows[0].count,
    ) > 0
  )
    throw Error(
      "Import requires an empty hosted members table; refusing to overwrite live data",
    );
  const tables = new Set(
    local
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
  for (const m of local.prepare("SELECT * FROM members").all())
    await c.query("INSERT INTO coffee.members VALUES($1,$2,$3,$4,$5,$6)", [
      m.id,
      m.name,
      m.stamps,
      m.rewards,
      m.version,
      m.apple_token,
    ]);
  for (const op of local.prepare("SELECT * FROM operations").all())
    await c.query("INSERT INTO coffee.operations VALUES($1,$2,$3,$4,$5,$6)", [
      op.key,
      op.member_id,
      op.kind,
      op.result,
      op.actor || "legacy",
      op.created_at || 0,
    ]);
  if (tables.has("staff_accounts"))
    for (const a of local.prepare("SELECT * FROM staff_accounts").all())
      await c.query("INSERT INTO coffee.staff_accounts VALUES($1,$2,$3,$4)", [
        a.username,
        a.password_hash,
        a.role,
        !!a.enabled,
      ]);
  if (tables.has("programme")) {
    const p = local.prepare("SELECT stamp_goal FROM programme").get();
    if (p)
      await c.query("UPDATE coffee.programme SET stamp_goal=$1", [
        p.stamp_goal,
      ]);
  }
  if (tables.has("customer_enrollments"))
    for (const e of local.prepare("SELECT * FROM customer_enrollments").all())
      await c.query(
        "INSERT INTO coffee.customer_enrollments VALUES($1,$2,$3)",
        [e.token_hash, e.member_id, e.created_at],
      );
  await c.query(
    "SELECT setval('coffee.revision',GREATEST(COALESCE((SELECT max(version) FROM coffee.members),1),1),true)",
  );
  await c.query(
    "INSERT INTO coffee.jobs(member_id,version) SELECT id,version FROM coffee.members",
  );
  await c.query("COMMIT");
  console.log(
    "Imported memberships, balances, rewards, pass identities, ledger, programme and staff; queued fresh Google updates. Sessions were not copied.",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  local.close();
  c.release();
  await db.end();
}
