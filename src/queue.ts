import type { DB } from "./db.js";
import { member } from "./db.js";
import { readiness } from "./config.js";
import { updateGoogle } from "./google.js";
import { pushApple } from "./apple.js";

export async function runOne(
  db: DB,
  deliver?: (provider: string, id: string) => Promise<void>,
): Promise<boolean> {
  // Claim one ready job atomically using a CTE with FOR UPDATE SKIP LOCKED.
  const client = await db.connect();
  let rows: {
    id: string;
    member_id: string;
    provider: string;
    attempts: string;
  }[];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7342102)");
    const { rows: claimedRows } = await client.query<{
      id: string;
      member_id: string;
      provider: string;
      attempts: string;
    }>(
      `
    WITH claimed AS (
      SELECT j.id FROM jobs j
      WHERE j.status IN ('pending', 'retry', 'blocked', 'working')
        AND j.next_at <= $1
        AND NOT EXISTS (
          SELECT 1 FROM jobs active
          WHERE active.member_id = j.member_id
            AND active.provider = j.provider
            AND active.status = 'working'
            AND active.next_at > $1
        )
      ORDER BY j.id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs SET status = 'working', next_at = $2
    FROM claimed WHERE jobs.id = claimed.id
    RETURNING jobs.id, jobs.member_id, jobs.provider, jobs.attempts
  `,
      [Date.now(), Date.now() + 120000],
    );

    rows = claimedRows;
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  if (!rows.length) return false;

  const job = rows[0];

  try {
    const provider = job.provider;
    const id = job.member_id;

    if (deliver) {
      await deliver(provider, id);
    } else {
      if (provider === "apple" && process.env.APPLE_WALLET_ENABLED !== "true") {
        await db.query(
          "UPDATE jobs SET status = 'disabled', error = $1 WHERE id = $2",
          ["Apple Wallet is optional and disabled", job.id],
        );
        return true;
      }

      if (!readiness()[provider as "google" | "apple"].enabled) {
        await db.query(
          "UPDATE jobs SET status = 'blocked', error = $1, next_at = $2 WHERE id = $3",
          [
            "Credentials missing; no wallet delivery attempted",
            Date.now() + 60000,
            job.id,
          ],
        );
        return true;
      }

      const m = (await member(db, id))!;
      if (provider === "google") {
        await updateGoogle(m);
      } else {
        const { rows: registrations } = await db.query<{ push_token: string }>(
          "SELECT DISTINCT push_token FROM registrations WHERE member_id = $1",
          [id],
        );
        if (!registrations.length) {
          await db.query(
            "UPDATE jobs SET status = 'no-device', error = $1 WHERE id = $2",
            [
              "No Apple device registered; current balance will be included when saved",
              job.id,
            ],
          );
          return true;
        }
        for (const r of registrations) {
          const status = await pushApple(r.push_token);
          if (status === 410)
            await db.query("DELETE FROM registrations WHERE push_token = $1", [
              r.push_token,
            ]);
        }
      }
    }

    await db.query(
      "UPDATE jobs SET status = 'delivered', error = NULL WHERE id = $1",
      [job.id],
    );
  } catch (e) {
    const attempts = Number(job.attempts) + 1;
    const reason = e instanceof Error ? e.message : "";
    const message =
      /^(Google (Wallet [A-Z]+|authentication) HTTP [0-9]{3}|APNs (HTTP [0-9]{3}|timeout))$/.test(
        reason,
      )
        ? reason
        : "Wallet delivery failed. Check server credentials, network and provider configuration.";

    if (job.provider === "google" && message.includes("PATCH HTTP 404")) {
      await db.query(
        "UPDATE jobs SET status = 'waiting-save', error = $1, attempts = $2 WHERE id = $3",
        [
          "Open Add to Google Wallet for this membership to create or repair its card",
          attempts,
          job.id,
        ],
      );
      return true;
    }

    await db.query(
      "UPDATE jobs SET status = $1, attempts = $2, next_at = $3, error = $4 WHERE id = $5",
      [
        attempts >= 12 ? "failed" : "retry",
        attempts,
        Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)),
        message,
        job.id,
      ],
    );
  }

  return true;
}
