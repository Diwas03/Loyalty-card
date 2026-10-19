import type { DB } from "./db.js";
import { member } from "./db.js";
import { readiness } from "./config.js";
import { updateGoogle } from "./google.js";
import { pushApple } from "./apple.js";
export async function runOne(
  db: DB,
  deliver?: (provider: string, id: string) => Promise<void>,
) {
  // Single worker, durable lease permits recovery after a crash. BEGIN IMMEDIATE also prevents competing workers claiming the same row.
  db.exec("BEGIN IMMEDIATE");
  const job = db
    .prepare(
      "SELECT * FROM jobs WHERE (status IN ('pending','retry','blocked') OR status='working') AND next_at<=? ORDER BY id LIMIT 1",
    )
    .get(Date.now());
  if (!job) {
    db.exec("COMMIT");
    return false;
  }
  db.prepare("UPDATE jobs SET status='working',next_at=? WHERE id=?").run(
    Date.now() + 120000,
    job.id as number,
  );
  db.exec("COMMIT");
  try {
    const provider = String(job.provider),
      id = String(job.member_id);
    if (deliver) await deliver(provider, id);
    else {
      if (!readiness()[provider as "google" | "apple"].enabled) {
        db.prepare(
          "UPDATE jobs SET status='blocked',error='Credentials missing; no wallet delivery attempted',next_at=? WHERE id=?",
        ).run(Date.now() + 60000, job.id as number);
        return true;
      }
      const m = member(db, id)!;
      if (provider === "google") await updateGoogle(m);
      else {
        const registrations = db
          .prepare(
            "SELECT DISTINCT push_token FROM registrations WHERE member_id=?",
          )
          .all(id);
        if (!registrations.length) {
          db.prepare(
            "UPDATE jobs SET status='no-device',error='No Apple device registered; current balance will be included when saved' WHERE id=?",
          ).run(job.id as number);
          return true;
        }
        for (const r of registrations) {
          const status = await pushApple(String(r.push_token));
          if (status === 410)
            db.prepare("DELETE FROM registrations WHERE push_token=?").run(
              String(r.push_token),
            );
        }
      }
    }
    db.prepare("UPDATE jobs SET status='delivered',error=NULL WHERE id=?").run(
      job.id as number,
    );
  } catch (e) {
    const attempts = Number(job.attempts) + 1;
    db.prepare(
      "UPDATE jobs SET status='retry',attempts=?,next_at=?,error=? WHERE id=?",
    ).run(
      attempts,
      Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)),
      e instanceof Error ? e.message.slice(0, 200) : "Wallet delivery failed",
      job.id as number,
    );
  }
  return true;
}
