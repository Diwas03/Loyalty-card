import { Pool, PoolClient } from "pg";
import { randomBytes, randomUUID } from "node:crypto";

export function openDb(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
}

export type DB = Pool;

export type Member = {
  id: string;
  name: string;
  stamps: number;
  rewards: number;
  version: number;
  apple_token: string;
  stamp_goal?: number;
};

/** Run the schema migrations and seed data on first start. */
export async function migrate(db: DB): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        stamps INTEGER NOT NULL DEFAULT 0 CHECK (stamps >= 0),
        rewards INTEGER NOT NULL DEFAULT 0 CHECK (rewards >= 0),
        version INTEGER NOT NULL DEFAULT 1,
        apple_token TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS operations (
        key TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        result TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'legacy',
        created_at BIGINT NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id BIGSERIAL PRIMARY KEY,
        member_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at BIGINT NOT NULL DEFAULT 0,
        error TEXT,
        UNIQUE (member_id, provider, version)
      );
      CREATE INDEX IF NOT EXISTS jobs_ready ON jobs (status, next_at);
      CREATE TABLE IF NOT EXISTS registrations (
        device TEXT NOT NULL,
        member_id TEXT NOT NULL,
        push_token TEXT NOT NULL,
        PRIMARY KEY (device, member_id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        expires BIGINT NOT NULL,
        username TEXT NOT NULL DEFAULT 'legacy'
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value BIGINT NOT NULL
      );
      INSERT INTO meta VALUES ('revision', 1) ON CONFLICT (key) DO NOTHING;
      CREATE TABLE IF NOT EXISTS staff_accounts (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('staff', 'owner')),
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS wallet_issuance (
        member_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (member_id, provider)
      );
      CREATE TABLE IF NOT EXISTS programme (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        stamp_goal INTEGER NOT NULL CHECK (stamp_goal BETWEEN 2 AND 100)
      );
      INSERT INTO programme VALUES (1, 8) ON CONFLICT (id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS programme_changes (
        id BIGSERIAL PRIMARY KEY,
        actor TEXT NOT NULL,
        old_goal INTEGER NOT NULL,
        new_goal INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS customer_enrollments (
        token_hash TEXT PRIMARY KEY,
        member_id TEXT NOT NULL REFERENCES members (id),
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS operations_member ON operations (member_id, created_at);
    `);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // Seed a demo member if none exist
  const { rows } = await db.query("SELECT id FROM members LIMIT 1");
  if (!rows.length) {
    await db.query(
      "INSERT INTO members (id, name, apple_token) VALUES ($1, $2, $3)",
      [randomUUID(), "Test Coffee Customer", randomBytes(32).toString("hex")],
    );
  }
}

export async function member(
  db: DB,
  id: string,
): Promise<Member | undefined> {
  const { rows } = await db.query<Member>(
    "SELECT members.*, programme.stamp_goal FROM members CROSS JOIN programme WHERE members.id = $1",
    [id],
  );
  return rows[0];
}

export async function transact(
  db: DB,
  id: string,
  kind: string,
  key: string,
  actor = "legacy",
) {
  if (!["purchase", "redeem"].includes(kind))
    throw new Error("Unsupported loyalty action");

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      "SELECT * FROM operations WHERE key = $1",
      [key],
    );
    if (existing.length) {
      const old = existing[0];
      if (old.member_id !== id || old.kind !== kind)
        throw new Error("Idempotency key already used for another action");
      await client.query("COMMIT");
      return JSON.parse(old.result as string);
    }

    const { rows: mRows } = await client.query<Member>(
      "SELECT members.*, programme.stamp_goal FROM members CROSS JOIN programme WHERE members.id = $1 FOR UPDATE",
      [id],
    );
    const m = mRows[0];
    if (!m) throw new Error("Membership not found");
    if (kind === "redeem" && m.rewards < 1) throw new Error("No reward available");

    const goal = m.stamp_goal || 8;
    const stamps = kind === "purchase" ? (m.stamps + 1) % goal : m.stamps;
    const rewards =
      kind === "purchase"
        ? m.rewards + (m.stamps === goal - 1 ? 1 : 0)
        : m.rewards - 1;

    const { rows: vRows } = await client.query<{ value: string }>(
      "UPDATE meta SET value = value + 1 WHERE key = 'revision' RETURNING value",
    );
    const version = Number(vRows[0].value);

    await client.query(
      "UPDATE members SET stamps = $1, rewards = $2, version = $3 WHERE id = $4",
      [stamps, rewards, version, id],
    );

    const providers =
      process.env.APPLE_WALLET_ENABLED === "true"
        ? ["google", "apple"]
        : ["google"];
    for (const provider of providers) {
      await client.query(
        "INSERT INTO jobs (member_id, provider, version) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [id, provider, version],
      );
    }

    const result = { id, stamps, rewards, version, stampGoal: goal };
    await client.query(
      "INSERT INTO operations (key, member_id, kind, result, actor, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [key, id, kind, JSON.stringify(result), actor, Date.now()],
    );

    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function enroll(db: DB, name: string): Promise<Member> {
  if (
    typeof name !== "string" ||
    name.trim().length < 1 ||
    name.trim().length > 80
  )
    throw new Error("Customer name must contain 1–80 characters");

  const id = randomUUID();
  await db.query(
    "INSERT INTO members (id, name, apple_token) VALUES ($1, $2, $3)",
    [id, name.trim(), randomBytes(32).toString("hex")],
  );
  return (await member(db, id))!;
}

export async function setGoal(
  db: DB,
  goal: number,
  actor: string,
): Promise<{ stampGoal: number }> {
  if (!Number.isInteger(goal) || goal < 2 || goal > 100)
    throw new Error("Choose a whole number between 2 and 100");

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: progRows } = await client.query<{ stamp_goal: string }>(
      "SELECT stamp_goal FROM programme FOR UPDATE",
    );
    const old = Number(progRows[0].stamp_goal);

    const { rows: blocking } = await client.query(
      "SELECT 1 FROM members WHERE stamps >= $1 LIMIT 1",
      [goal],
    );
    if (blocking.length)
      throw new Error(
        "Cannot lower the goal below current customer progress. Finish those stamp cycles first.",
      );

    if (old !== goal) {
      await client.query("UPDATE programme SET stamp_goal = $1 WHERE id = 1", [
        goal,
      ]);
      await client.query(
        "INSERT INTO programme_changes (actor, old_goal, new_goal, created_at) VALUES ($1, $2, $3, $4)",
        [actor, old, goal, Date.now()],
      );
      const { rows: vRows } = await client.query<{ value: string }>(
        "UPDATE meta SET value = value + 1 WHERE key = 'revision' RETURNING value",
      );
      const version = Number(vRows[0].value);
      await client.query("UPDATE members SET version = $1", [version]);

      const providers =
        process.env.APPLE_WALLET_ENABLED === "true"
          ? ["google", "apple"]
          : ["google"];
      for (const provider of providers) {
        await client.query(
          "INSERT INTO jobs (member_id, provider, version) SELECT id, $1, $2 FROM members ON CONFLICT DO NOTHING",
          [provider, version],
        );
      }
    }

    await client.query("COMMIT");
    return { stampGoal: goal };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Acquire a client for manual transaction use (worker/scripts). */
export async function withClient<T>(
  db: DB,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
