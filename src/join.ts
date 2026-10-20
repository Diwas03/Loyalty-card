import { validJoinToken } from "./customer-token.js";
import { createHash } from "node:crypto";
import { type DB, enroll, member } from "./db.js";
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export { validJoinToken } from "./customer-token.js";
export function joinedMember(db: DB, token: unknown) {
  if (!validJoinToken(token)) return undefined;
  const row = db
    .prepare("SELECT member_id FROM customer_enrollments WHERE token_hash=?")
    .get(hash(token));
  return row ? member(db, String(row.member_id)) : undefined;
}
export function join(db: DB, token: string, name: string) {
  if (!validJoinToken(token))
    throw new Error("Refresh this page to start your membership");
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = joinedMember(db, token);
    if (existing) {
      db.exec("COMMIT");
      return existing;
    }
    const m = enroll(db, name);
    db.prepare("INSERT INTO customer_enrollments VALUES(?,?,?)").run(
      hash(token),
      m.id,
      Date.now(),
    );
    db.exec("COMMIT");
    return m;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
