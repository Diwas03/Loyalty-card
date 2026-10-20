import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export function openDb(path = process.env.DB_PATH || "data/coffee.sqlite") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,name TEXT NOT NULL,stamps INTEGER NOT NULL DEFAULT 0 CHECK(stamps>=0),rewards INTEGER NOT NULL DEFAULT 0 CHECK(rewards>=0),version INTEGER NOT NULL DEFAULT 1,apple_token TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operations(key TEXT PRIMARY KEY,member_id TEXT NOT NULL,kind TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,member_id TEXT NOT NULL,provider TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT,UNIQUE(member_id,provider,version));
 CREATE TABLE IF NOT EXISTS registrations(device TEXT NOT NULL,member_id TEXT NOT NULL,push_token TEXT NOT NULL,PRIMARY KEY(device,member_id));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
 INSERT OR IGNORE INTO meta VALUES('revision',1);`);
  db.exec("BEGIN IMMEDIATE");
  try {
    // Migrations preserve installed membership IDs, balances and pass tokens.
    const addColumn = (table: string, name: string, definition: string) => {
      if (
        !db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((c) => c.name === name)
      )
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    addColumn("sessions", "username", "TEXT NOT NULL DEFAULT 'legacy'");
    addColumn("operations", "actor", "TEXT NOT NULL DEFAULT 'legacy'");
    addColumn("operations", "created_at", "INTEGER NOT NULL DEFAULT 0");
    db.exec(`CREATE TABLE IF NOT EXISTS staff_accounts(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('staff','owner')),enabled INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS wallet_issuance(member_id TEXT NOT NULL,provider TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(member_id,provider));
  CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,next_at);
  CREATE INDEX IF NOT EXISTS operations_member ON operations(member_id,created_at);`);
    db.exec(`CREATE TABLE IF NOT EXISTS programme(id INTEGER PRIMARY KEY CHECK(id=1),stamp_goal INTEGER NOT NULL CHECK(stamp_goal BETWEEN 2 AND 100));INSERT OR IGNORE INTO programme VALUES(1,8);
  CREATE TABLE IF NOT EXISTS programme_changes(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,old_goal INTEGER NOT NULL,new_goal INTEGER NOT NULL,created_at INTEGER NOT NULL);`);
    if (
      String(
        db.prepare("SELECT sql FROM sqlite_master WHERE name='members'").get()!
          .sql,
      ).includes("BETWEEN 0 AND 7")
    )
      db.exec(`CREATE TABLE members_migrated(id TEXT PRIMARY KEY,name TEXT NOT NULL,stamps INTEGER NOT NULL DEFAULT 0 CHECK(stamps>=0),rewards INTEGER NOT NULL DEFAULT 0 CHECK(rewards>=0),version INTEGER NOT NULL DEFAULT 1,apple_token TEXT NOT NULL);
  INSERT INTO members_migrated SELECT * FROM members; DROP TABLE members; ALTER TABLE members_migrated RENAME TO members;`);
    db.exec(
      "CREATE TABLE IF NOT EXISTS customer_enrollments(token_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),created_at INTEGER NOT NULL)",
    );
    db.exec(
      "UPDATE meta SET value=MAX(value,COALESCE((SELECT MAX(version) FROM members),1)) WHERE key='revision'",
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.close();
    throw e;
  }
  if (!db.prepare("SELECT id FROM members LIMIT 1").get())
    db.prepare("INSERT INTO members(id,name,apple_token) VALUES(?,?,?)").run(
      randomUUID(),
      "Test Coffee Customer",
      randomBytes(32).toString("hex"),
    );
  return db;
}
export type DB = ReturnType<typeof openDb>;
export type Member = {
  id: string;
  name: string;
  stamps: number;
  rewards: number;
  version: number;
  apple_token: string;
  stamp_goal?: number;
};
export const member = (db: DB, id: string) =>
  db
    .prepare(
      "SELECT members.*,programme.stamp_goal FROM members CROSS JOIN programme WHERE members.id=?",
    )
    .get(id) as Member | undefined;
export function transact(
  db: DB,
  id: string,
  kind: string,
  key: string,
  actor = "legacy",
) {
  if (!["purchase", "redeem"].includes(kind))
    throw new Error("Unsupported loyalty action");
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = db.prepare("SELECT * FROM operations WHERE key=?").get(key);
    if (old) {
      if (old.member_id !== id || old.kind !== kind)
        throw new Error("Idempotency key already used for another action");
      db.exec("COMMIT");
      return JSON.parse(old.result as string);
    }
    const m = member(db, id);
    if (!m) throw new Error("Membership not found");
    if (kind === "redeem" && m.rewards < 1)
      throw new Error("No reward available");
    const goal = m.stamp_goal || 8;
    const stamps = kind === "purchase" ? (m.stamps + 1) % goal : m.stamps;
    const rewards =
      kind === "purchase"
        ? m.rewards + (m.stamps === goal - 1 ? 1 : 0)
        : m.rewards - 1;
    db.prepare("UPDATE meta SET value=value+1 WHERE key='revision'").run();
    const version = Number(
      db.prepare("SELECT value FROM meta WHERE key='revision'").get()!.value,
    );
    db.prepare(
      "UPDATE members SET stamps=?,rewards=?,version=? WHERE id=?",
    ).run(stamps, rewards, version, id);
    for (const provider of process.env.APPLE_WALLET_ENABLED === "true"
      ? ["google", "apple"]
      : ["google"])
      db.prepare(
        "INSERT INTO jobs(member_id,provider,version) VALUES(?,?,?)",
      ).run(id, provider, version);
    const result = { id, stamps, rewards, version, stampGoal: goal };
    db.prepare(
      "INSERT INTO operations(key,member_id,kind,result,actor,created_at) VALUES(?,?,?,?,?,?)",
    ).run(key, id, kind, JSON.stringify(result), actor, Date.now());
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function enroll(db: DB, name: string) {
  if (
    typeof name !== "string" ||
    name.trim().length < 1 ||
    name.trim().length > 80
  )
    throw new Error("Customer name must contain 1–80 characters");
  const id = randomUUID();
  db.prepare("INSERT INTO members(id,name,apple_token) VALUES(?,?,?)").run(
    id,
    name.trim(),
    randomBytes(32).toString("hex"),
  );
  return member(db, id)!;
}

export function setGoal(db: DB, goal: number, actor: string) {
  if (!Number.isInteger(goal) || goal < 2 || goal > 100)
    throw new Error("Choose a whole number between 2 and 100");
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = Number(
      db.prepare("SELECT stamp_goal FROM programme").get()!.stamp_goal,
    );
    if (db.prepare("SELECT 1 FROM members WHERE stamps>=? LIMIT 1").get(goal))
      throw new Error(
        "Cannot lower the goal below current customer progress. Finish those stamp cycles first.",
      );
    if (old !== goal) {
      db.prepare("UPDATE programme SET stamp_goal=? WHERE id=1").run(goal);
      db.prepare(
        "INSERT INTO programme_changes(actor,old_goal,new_goal,created_at) VALUES(?,?,?,?)",
      ).run(actor, old, goal, Date.now());
      db.prepare("UPDATE meta SET value=value+1 WHERE key='revision'").run();
      const version = Number(
        db.prepare("SELECT value FROM meta WHERE key='revision'").get()!.value,
      );
      db.prepare("UPDATE members SET version=?").run(version);
      for (const provider of process.env.APPLE_WALLET_ENABLED === "true"
        ? ["google", "apple"]
        : ["google"])
        db.prepare(
          "INSERT INTO jobs(member_id,provider,version) SELECT id,?,? FROM members",
        ).run(provider, version);
    }
    db.exec("COMMIT");
    return { stampGoal: goal };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
