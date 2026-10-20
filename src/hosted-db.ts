import pg from "pg";
import { databaseOptions } from "./database-config.js";
import { createHash } from "node:crypto";
import { updateGoogle } from "./google.js";
import { readiness } from "./config.js";
pg.types.setTypeParser(20, Number);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function hostedPool() {
  return new pg.Pool(databaseOptions());
}
export type HostedDB = Pick<pg.Pool, "query">;
export async function readMember(db: HostedDB, id: string) {
  return (
    await db.query(
      "SELECT m.*,p.stamp_goal FROM coffee.members m CROSS JOIN coffee.programme p WHERE m.id=$1",
      [id],
    )
  ).rows[0];
}
export async function goal(db: HostedDB) {
  return Number(
    (await db.query("SELECT stamp_goal FROM coffee.programme WHERE id=1"))
      .rows[0].stamp_goal,
  );
}
export const publicMember = (m: any) => ({
  id: m.id,
  name: m.name,
  stamps: m.stamps,
  rewards: m.rewards,
  version: m.version,
  stampGoal: m.stamp_goal || 8,
});
export async function deliverHosted(
  db: HostedDB,
  id?: string,
  deliver = updateGoogle,
) {
  const j = (await db.query("SELECT coffee.claim_job($1) AS job", [id || null]))
    .rows[0].job;
  if (!j) return false;
  try {
    if (!readiness().google.enabled) {
      await db.query(
        "UPDATE coffee.jobs SET status='blocked',error='Google credentials missing',next_at=$1 WHERE id=$2",
        [Date.now() + 60000, j.id],
      );
      return true;
    }
    const m = await readMember(db, j.member_id);
    await deliver(m);
    await db.query(
      "UPDATE coffee.jobs SET status='delivered',error=NULL WHERE member_id=$1 AND version<=$2 AND (id=$3 OR status<>'working')",
      [m.id, m.version, j.id],
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : "";
    const attempts = j.attempts + 1;
    const message =
      /^Google (Wallet [A-Z]+|authentication) HTTP [0-9]{3}$/.test(reason)
        ? reason
        : "Wallet delivery failed. Check server configuration and connectivity.";
    await db.query(
      "UPDATE coffee.jobs SET status=$1,attempts=$2,next_at=$3,error=$4 WHERE id=$5",
      [
        reason === "Google Wallet PATCH HTTP 404"
          ? "waiting-save"
          : attempts >= 12
            ? "failed"
            : "retry",
        attempts,
        Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)),
        message,
        j.id,
      ],
    );
  }
  return true;
}
