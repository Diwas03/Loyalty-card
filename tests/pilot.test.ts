import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { enroll, member, transact, setGoal, type Member } from "../src/db.js";
import { setStaff, passwordHash } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { runOne } from "../src/queue.js";
import { memDb } from "./helpers.js";
delete process.env.PUBLIC_BASE_URL;
delete process.env.APPLE_WALLET_ENABLED;

// NOTE: The SQLite "legacy migration" test is removed — PostgreSQL has no
// legacy schema to migrate from. Schema is created fresh via migrate().

test("named staff enrollment, owner-only settings/retries, audit history, legacy revocation and account reset", async () => {
  const db = await memDb();
  process.env.STAFF_PASSWORD_HASH = passwordHash("old-legacy-password");
  const app = createApp(db);
  const legacy = request.agent(app);
  await legacy
    .post("/api/login")
    .send({ password: "old-legacy-password" })
    .expect(200).then(response => { legacy.set("Authorization", "Bearer " + response.body.token); });
  await setStaff(db, "owner", "owner-password-test", "owner");
  await setStaff(db, "barista", "barista-password-test");
  await legacy.get("/api/staff/me").expect(401);
  await request(app)
    .post("/api/login")
    .send({ password: "old-legacy-password" })
    .expect(401);
  const staff = request.agent(app);
  await staff
    .post("/api/login")
    .send({ username: "barista", password: "barista-password-test" })
    .expect(200).then(response => { staff.set("Authorization", "Bearer " + response.body.token); });
  await request(app)
    .post("/api/staff/enroll")
    .send({ name: "Ada" })
    .expect(401);
  await staff.post("/api/staff/enroll").send({ name: "Ada" }).expect(410);
  const id = (await enroll(db, "Ada")).id;
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
    .expect(200).then(response => { owner.set("Authorization", "Bearer " + response.body.token); });
  await owner.post("/api/staff/programme").send({ stampGoal: 10 }).expect(200);
  assert.equal(
    (await request(app).get("/api/members/" + id)).body.stampGoal,
    10,
  );
  await setStaff(db, "barista", "barista-new-password");
  await staff.get("/api/staff/me").expect(401);
  await db.end();
});

test("configurable reward goal retains progress/rewards, queues updates and rejects destructive reductions", async () => {
  const db = await memDb();
  const m = await enroll(db, "Coffee fan");
  await transact(db, m.id, "purchase", randomUUID());
  await setGoal(db, 3, "owner");
  for (let i = 0; i < 2; i++)
    await transact(db, m.id, "purchase", randomUUID());
  assert.equal((await member(db, m.id))!.rewards, 1);
  assert.equal((await member(db, m.id))!.stamps, 0);
  await transact(db, m.id, "purchase", randomUUID());
  await transact(db, m.id, "purchase", randomUUID());
  await assert.rejects(
    () => setGoal(db, 2, "owner"),
    /current customer progress/,
  );
  assert.equal((await member(db, m.id))!.stamp_goal, 3);
  assert.equal((await member(db, m.id))!.rewards, 1);
  const { rows } = await db.query(
    "SELECT COUNT(*) AS n FROM programme_changes",
  );
  assert.equal(Number(rows[0].n), 1);
  await assert.rejects(() => setGoal(db, 1, "owner"));
  await db.end();
});

test("Google 404 pauses until save instead of retrying forever; owner can recover a job", async () => {
  const db = await memDb();
  const m = await enroll(db, "Card not saved");
  await transact(db, m.id, "purchase", randomUUID());
  await runOne(db, async () => {
    throw new Error("Google Wallet PATCH HTTP 404");
  });
  const { rows: jobs } = await db.query("SELECT status FROM jobs");
  assert.equal(jobs[0].status, "waiting-save");
  assert.equal(
    await runOne(db, async () => assert.fail("must not retry")),
    false,
  );
  assert.equal((await member(db, m.id))!.stamps, 1);
  await setStaff(db, "owner", "owner-password-test", "owner");
  const app = createApp(db),
    owner = request.agent(app);
  await owner
    .post("/api/login")
    .send({ username: "owner", password: "owner-password-test" })
    .expect(200).then(response => { owner.set("Authorization", "Bearer " + response.body.token); });
  const { rows: jobRows } = await db.query("SELECT id FROM jobs");
  await owner
    .post("/api/staff/jobs/" + jobRows[0].id + "/retry")
    .send({})
    .expect(200);
  await runOne(db, async () => {});
  const { rows: jobs2 } = await db.query("SELECT status FROM jobs");
  assert.equal(jobs2[0].status, "delivered");
  await db.end();
});

test("retry budget is finite and per-member provider jobs cannot overtake an active delivery", async () => {
  const db = await memDb();
  const m = await enroll(db, "Retry");
  await transact(db, m.id, "purchase", randomUUID());
  await db.query("UPDATE jobs SET attempts = 11");
  await runOne(db, async () => {
    throw Error("Google Wallet PATCH HTTP 403");
  });
  const { rows: jobs } = await db.query("SELECT status FROM jobs");
  assert.equal(jobs[0].status, "failed");
  await db.query("UPDATE jobs SET status = 'working', next_at = $1", [
    Date.now() + 120000,
  ]);
  await transact(db, m.id, "purchase", randomUUID());
  assert.equal(
    await runOne(db, async () =>
      assert.fail("must not overtake active revision"),
    ),
    false,
  );
  await db.end();
});

test("wallet credential parsing errors cannot expose private material through staff delivery status", async () => {
  const db = await memDb();
  const m = await enroll(db, "Safe errors");
  await transact(db, m.id, "purchase", randomUUID());
  await runOne(db, async () => {
    throw new SyntaxError("fake-private-key-material");
  });
  const { rows } = await db.query("SELECT error FROM jobs");
  assert.ok(!String(rows[0].error).includes("fake-private-key-material"));
  assert.match(String(rows[0].error), /Check server credentials/);
  await db.end();
});
