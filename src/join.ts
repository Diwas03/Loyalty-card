import { validJoinToken } from "./customer-token.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type DB, member, type Member } from "./db.js";
export { validJoinToken } from "./customer-token.js";
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function joinedMember(db: DB, token: unknown) {
  if (!validJoinToken(token)) return undefined;
  const { rows } = await db.query(
    "SELECT member_id,token_hash FROM customer_enrollments WHERE token_hash=$1 OR token_hash=$2 ORDER BY CASE WHEN token_hash=$1 THEN 0 ELSE 1 END LIMIT 1",
    [hash(token), token],
  );
  if (!rows[0]) return undefined;
  if (rows[0].token_hash === token)
    await db.query(
      "UPDATE customer_enrollments SET token_hash=$1 WHERE token_hash=$2",
      [hash(token), token],
    );
  return member(db, rows[0].member_id);
}
export async function join(db: DB, token: string, name: string) {
  if (!validJoinToken(token))
    throw Error("Refresh this page to start your membership");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7342102)");
    const { rows } = await client.query(
      "SELECT member_id,token_hash FROM customer_enrollments WHERE token_hash=$1 OR token_hash=$2 ORDER BY CASE WHEN token_hash=$1 THEN 0 ELSE 1 END LIMIT 1",
      [hash(token), token],
    );
    let id = rows[0]?.member_id;
    if (id) {
      if (rows[0].token_hash === token)
        await client.query(
          "UPDATE customer_enrollments SET token_hash=$1 WHERE token_hash=$2",
          [hash(token), token],
        );
    } else {
      if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
        throw Error("Customer name must contain 1–80 characters");
      id = randomUUID();
      await client.query(
        "INSERT INTO members(id,name,apple_token) VALUES($1,$2,$3)",
        [id, name.trim(), randomBytes(32).toString("hex")],
      );
      await client.query("INSERT INTO customer_enrollments VALUES($1,$2,$3)", [
        hash(token),
        id,
        Date.now(),
      ]);
    }
    const m = (
      await client.query(
        "SELECT m.*,p.stamp_goal FROM members m JOIN programme p ON p.id=1 WHERE m.id=$1",
        [id],
      )
    ).rows[0] as Member;
    await client.query("COMMIT");
    return m;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
