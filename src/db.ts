import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export function openDb(path = process.env.DB_PATH || "data/coffee.sqlite") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,name TEXT NOT NULL,stamps INTEGER NOT NULL DEFAULT 0 CHECK(stamps BETWEEN 0 AND 7),rewards INTEGER NOT NULL DEFAULT 0 CHECK(rewards>=0),version INTEGER NOT NULL DEFAULT 1,apple_token TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operations(key TEXT PRIMARY KEY,member_id TEXT NOT NULL,kind TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,member_id TEXT NOT NULL,provider TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT,UNIQUE(member_id,provider,version));
 CREATE TABLE IF NOT EXISTS registrations(device TEXT NOT NULL,member_id TEXT NOT NULL,push_token TEXT NOT NULL,PRIMARY KEY(device,member_id));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
 INSERT OR IGNORE INTO meta VALUES('revision',1);`);
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
};
export const member = (db: DB, id: string) =>
  db.prepare("SELECT * FROM members WHERE id=?").get(id) as Member | undefined;
export function transact(db: DB, id: string, kind: string, key: string) {
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
    const stamps = kind === "purchase" ? (m.stamps + 1) % 8 : m.stamps;
    const rewards =
      kind === "purchase"
        ? m.rewards + (m.stamps === 7 ? 1 : 0)
        : m.rewards - 1;
    db.prepare("UPDATE meta SET value=value+1 WHERE key='revision'").run();
    const version = Number(
      db.prepare("SELECT value FROM meta WHERE key='revision'").get()!.value,
    );
    db.prepare(
      "UPDATE members SET stamps=?,rewards=?,version=? WHERE id=?",
    ).run(stamps, rewards, version, id);
    for (const provider of ["google", "apple"])
      db.prepare(
        "INSERT INTO jobs(member_id,provider,version) VALUES(?,?,?)",
      ).run(id, provider, version);
    const result = { id, stamps, rewards, version };
    db.prepare("INSERT INTO operations VALUES(?,?,?,?)").run(
      key,
      id,
      kind,
      JSON.stringify(result),
    );
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
