import { validJoinToken } from "./customer-token.js";
import { createHash } from "node:crypto";
import { type DB, enroll, member } from "./db.js";

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export { validJoinToken } from "./customer-token.js";

export async function joinedMember(db: DB, token: unknown) {
  if (!validJoinToken(token)) return undefined;
  const { rows } = await db.query(
    "SELECT member_id FROM customer_enrollments WHERE token_hash = $1",
    [hash(token as string)],
  );
  return rows[0] ? member(db, String(rows[0].member_id)) : undefined;
}

export async function join(db: DB, token: string, name: string) {
  if (!validJoinToken(token))
    throw new Error("Refresh this page to start your membership");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT member_id FROM customer_enrollments WHERE token_hash = $1",
      [hash(token)],
    );
    if (rows[0]) {
      await client.query("COMMIT");
      return member(db, String(rows[0].member_id));
    }
    const m = await enroll(db, name);
    await client.query(
      "INSERT INTO customer_enrollments VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [hash(token), m.id, Date.now()],
    );
    await client.query("COMMIT");
    return m;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
