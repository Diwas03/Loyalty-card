import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb,
  enroll,
  member,
  transact,
  setGoal,
  type Member,
} from "../src/db.js";
import { setStaff, passwordHash } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { runOne } from "../src/queue.js";
delete process.env.PUBLIC_BASE_URL;
delete process.env.APPLE_WALLET_ENABLED;
test("legacy database migration is repeatable and preserves installed membership, balance, pass token, old sessions and ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "coffee-migration-"));
  const path = join(dir, "old.sqlite");
  let old = new DatabaseSync(path);
  old.exec(
    `CREATE TABLE members(id TEXT PRIMARY KEY,name TEXT NOT NULL,stamps INTEGER NOT NULL DEFAULT 0 CHECK(stamps BETWEEN 0 AND 7),rewards INTEGER NOT NULL DEFAULT 0 CHECK(rewards>=0),version INTEGER NOT NULL DEFAULT 1,apple_token TEXT NOT NULL);INSERT INTO members VALUES('existing-id','Existing',7,2,5,'existing-token');CREATE TABLE sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);INSERT INTO sessions VALUES('old-session',9999999999999);CREATE TABLE operations(key TEXT PRIMARY KEY,member_id TEXT NOT NULL,kind TEXT NOT NULL,result TEXT NOT NULL);INSERT INTO operations VALUES('old-key','existing-id','purchase','{}');`,
  );
  old.close();
  let db = openDb(path);
  assert.equal(member(db, "existing-id")!.apple_token, "existing-token");
  assert.equal(member(db, "existing-id")!.stamps, 7);
  assert.equal(
    db.prepare("SELECT username FROM sessions").get()!.username,
    "legacy",
  );
  assert.equal(
    db.prepare("SELECT actor FROM operations").get()!.actor,
    "legacy",
  );
  db.close();
  db = openDb(path);
  assert.equal(member(db, "existing-id")!.rewards, 2);
  setGoal(db, 10, "owner");
  for (let i = 0; i < 3; i++)
    transact(db, "existing-id", "purchase", randomUUID());
  assert.equal(member(db, "existing-id")!.rewards, 3);
  assert.equal(member(db, "existing-id")!.stamps, 0);
  db.close();
  rmSync(dir, { recursive: true });
});
test("named staff enrollment, owner-only settings/retries, audit history, legacy revocation and account reset", async () => {
  const db = openDb(":memory:");
  process.env.STAFF_PASSWORD_HASH = passwordHash("old-legacy-password");
  const app = createApp(db);
  const legacy = request.agent(app);
  await legacy
    .post("/api/login")
    .send({ password: "old-legacy-password" })
    .expect(200);
  setStaff(db, "owner", "owner-password-test", "owner");
  setStaff(db, "barista", "barista-password-test");
  await legacy.get("/api/staff/me").expect(401);
  await request(app)
    .post("/api/login")
    .send({ password: "old-legacy-password" })
    .expect(401);
  const staff = request.agent(app);
  await staff
    .post("/api/login")
    .send({ username: "barista", password: "barista-password-test" })
    .expect(200);
  await request(app)
    .post("/api/staff/enroll")
    .send({ name: "Ada" })
    .expect(401);
  const created = await staff
    .post("/api/staff/enroll")
    .send({ name: "Ada" })
    .expect(201);
  const id = created.body.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(created.body.apple_token, undefined);
  await staff
    .post("/api/staff/enroll")
    .send({ name: " ".repeat(3) })
    .expect(400);
  const result = await staff.get("/api/staff/members?q=Ada").expect(200);
  assert.equal(result.body[0].id, id);
  await staff.post("/api/staff/programme").send({ stampGoal: 10 }).expect(403);
  await staff.post("/api/staff/jobs/1/retry").send({}).expect(403);
  const key = randomUUID();
  for (let i = 0; i < 2; i++)
    await staff
      .post(`/api/staff/members/${id}/purchase`)
      .set("Idempotency-Key", key)
      .send({ confirm: true })
      .expect(200);
  const details = await staff.get("/api/staff/members/" + id).expect(200);
  assert.equal(details.body.history.length, 1);
  assert.equal(details.body.history[0].actor, "barista");
  assert.ok(details.body.history[0].created_at > 0);
  assert.equal(details.body.deliveries.length, 1);
  const owner = request.agent(app);
  await owner
    .post("/api/login")
    .send({ username: "owner", password: "owner-password-test" })
    .expect(200);
  await owner.post("/api/staff/programme").send({ stampGoal: 10 }).expect(200);
  assert.equal((await staff.get("/api/members/" + id)).body.stampGoal, 10);
  setStaff(db, "barista", "barista-new-password");
  await staff.get("/api/staff/me").expect(401);
  db.close();
});
test("configurable reward goal retains progress/rewards, queues updates and rejects destructive reductions", () => {
  const db = openDb(":memory:");
  const m = enroll(db, "Coffee fan");
  transact(db, m.id, "purchase", randomUUID());
  setGoal(db, 3, "owner");
  for (let i = 0; i < 2; i++) transact(db, m.id, "purchase", randomUUID());
  assert.equal(member(db, m.id)!.rewards, 1);
  assert.equal(member(db, m.id)!.stamps, 0);
  transact(db, m.id, "purchase", randomUUID());
  transact(db, m.id, "purchase", randomUUID());
  assert.throws(() => setGoal(db, 2, "owner"), /current customer progress/);
  assert.equal(member(db, m.id)!.stamp_goal, 3);
  assert.equal(member(db, m.id)!.rewards, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM programme_changes").get()!.n,
    1,
  );
  assert.throws(() => setGoal(db, 1, "owner"));
  db.close();
});
test("Google 404 pauses until save instead of retrying forever; owner can recover a job", async () => {
  const db = openDb(":memory:");
  const m = enroll(db, "Card not saved");
  transact(db, m.id, "purchase", randomUUID());
  await runOne(db, async () => {
    throw new Error("Google Wallet PATCH HTTP 404");
  });
  assert.equal(
    db.prepare("SELECT status FROM jobs").get()!.status,
    "waiting-save",
  );
  assert.equal(
    await runOne(db, async () => assert.fail("must not retry")),
    false,
  );
  assert.equal(member(db, m.id)!.stamps, 1);
  setStaff(db, "owner", "owner-password-test", "owner");
  const app = createApp(db),
    owner = request.agent(app);
  await owner
    .post("/api/login")
    .send({ username: "owner", password: "owner-password-test" })
    .expect(200);
  const job = db.prepare("SELECT id FROM jobs").get()!;
  await owner
    .post("/api/staff/jobs/" + job.id + "/retry")
    .send({})
    .expect(200);
  await runOne(db, async () => {});
  assert.equal(
    db.prepare("SELECT status FROM jobs").get()!.status,
    "delivered",
  );
  db.close();
});
test("retry budget is finite and per-member provider jobs cannot overtake an active delivery", async () => {
  const db = openDb(":memory:");
  const m = enroll(db, "Retry");
  transact(db, m.id, "purchase", randomUUID());
  db.prepare("UPDATE jobs SET attempts=11").run();
  await runOne(db, async () => {
    throw Error("Google Wallet PATCH HTTP 403");
  });
  assert.equal(db.prepare("SELECT status FROM jobs").get()!.status, "failed");
  db.prepare("UPDATE jobs SET status='working',next_at=?").run(
    Date.now() + 120000,
  );
  transact(db, m.id, "purchase", randomUUID());
  assert.equal(
    await runOne(db, async () =>
      assert.fail("must not overtake active revision"),
    ),
    false,
  );
  db.close();
});

test("wallet credential parsing errors cannot expose private material through staff delivery status", async () => {
  const db = openDb(":memory:");
  const m = enroll(db, "Safe errors");
  transact(db, m.id, "purchase", randomUUID());
  await runOne(db, async () => {
    throw new SyntaxError("fake-private-key-material");
  });
  const job = db.prepare("SELECT error FROM jobs").get()!;
  assert.ok(!String(job.error).includes("fake-private-key-material"));
  assert.match(String(job.error), /Check server credentials/);
  db.close();
});
