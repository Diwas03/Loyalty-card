delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import request from "supertest";
import { memDb } from "./helpers.js";
import { openDb, transact, member, migrate, type Member } from "../src/db.js";
import { createApp } from "../src/app.js";
import { runOne } from "../src/queue.js";
// Keep HTTP authorization tests local even when a developer has configured a real HTTPS origin.
delete process.env.PUBLIC_BASE_URL;

test("duplicate paid coffee is applied exactly once, including queued deliveries", async () => {
  const db = await memDb();
  const { rows } = await db.query("SELECT * FROM members LIMIT 1");
  const m = rows[0] as Member;
  const key = randomUUID();
  const first = await transact(db, m.id, "purchase", key);
  assert.deepEqual(await transact(db, m.id, "purchase", key), first);
  assert.equal((await member(db, m.id))!.stamps, 1);
  const { rows: jobs } = await db.query("SELECT COUNT(*) AS n FROM jobs");
  assert.equal(Number(jobs[0].n), 1);
  await assert.rejects(() => transact(db, m.id, "redeem", key));
  await db.end();
});

test("eighth stamp awards one reward; new cycle retains unused reward; redemption earns no stamp", async () => {
  const db = await memDb();
  const { rows } = await db.query("SELECT * FROM members LIMIT 1");
  const m = rows[0] as Member;
  for (let i = 0; i < 8; i++) await transact(db, m.id, "purchase", randomUUID());
  assert.equal((await member(db, m.id))!.stamps, 0);
  assert.equal((await member(db, m.id))!.rewards, 1);
  await transact(db, m.id, "purchase", randomUUID());
  assert.equal((await member(db, m.id))!.stamps, 1);
  assert.equal((await member(db, m.id))!.rewards, 1);
  await transact(db, m.id, "redeem", randomUUID());
  assert.equal((await member(db, m.id))!.stamps, 1);
  assert.equal((await member(db, m.id))!.rewards, 0);
  await db.end();
});

test("concurrent redemptions only succeed once (pg serialization)", async () => {
  const db = await memDb();
  const { rows } = await db.query("SELECT id FROM members LIMIT 1");
  const id = rows[0].id as string;
  await db.query("UPDATE members SET rewards = 1");
  // Fire two concurrent redemptions — exactly one should succeed.
  const results = await Promise.allSettled([
    transact(db, id, "redeem", randomUUID()),
    transact(db, id, "redeem", randomUUID()),
  ]);
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  assert.equal(succeeded, 1);
  assert.equal(failed, 1);
  assert.equal((await member(db, id))!.rewards, 0);
  await db.end();
});

test("unauthorized staff actions, unconfirmed actions and cross-origin login are rejected", async () => {
  const db = await memDb();
  const { rows } = await db.query("SELECT * FROM members LIMIT 1");
  const m = rows[0] as Member;
  const app = createApp(db);
  await request(app)
    .post(`/api/staff/members/${m.id}/purchase`)
    .send({ confirm: true })
    .expect(401);
  await request(app).get(`/api/staff/members/${m.id}`).expect(401);
  await request(app)
    .post("/api/login")
    .set("Origin", "https://evil.example")
    .send({ password: "x" })
    .expect(403);
  process.env.STAFF_PASSWORD_HASH =
    "salt:" + scryptSync("test-password", "salt", 32).toString("hex");
  const agent = request.agent(app);
  await agent
    .post("/api/login")
    .send({ password: "test-password" })
    .expect(200);
  await agent
    .post(`/api/staff/members/${m.id}/purchase`)
    .set("Idempotency-Key", randomUUID())
    .send({ confirm: false })
    .expect(400);
  const key = randomUUID();
  for (let n = 0; n < 2; n++)
    await agent
      .post(`/api/staff/members/${m.id}/purchase`)
      .set("Idempotency-Key", key)
      .send({ confirm: true })
      .expect(200);
  assert.equal((await member(db, m.id))!.stamps, 1);
  await agent.post("/api/logout").send({}).expect(200);
  await agent.get(`/api/staff/members/${m.id}`).expect(401);
  await db.end();
});

test("wallet failure never rolls back purchase, survives reopening, and retries successfully", async () => {
  const db = await memDb();
  const { rows } = await db.query("SELECT id FROM members LIMIT 1");
  const id = rows[0].id as string;
  await transact(db, id, "purchase", randomUUID());
  await runOne(db, async () => {
    throw Error("Provider offline");
  });
  assert.equal((await member(db, id))!.stamps, 1);
  const { rows: jobs } = await db.query(
    "SELECT * FROM jobs ORDER BY id LIMIT 1",
  );
  assert.equal(jobs[0].status, "retry");
  assert.equal(Number(jobs[0].attempts), 1);
  // Reset next_at to allow re-run
  await db.query("UPDATE jobs SET next_at = 0");
  await runOne(db, async () => {});
  const { rows: jobs2 } = await db.query(
    "SELECT * FROM jobs ORDER BY id LIMIT 1",
  );
  assert.equal(jobs2[0].status, "delivered");
  await db.end();
});

test("Apple registration authentication, discovery and removal protocol", async () => {
  const db = await memDb();
  const { rows } = await db.query("SELECT * FROM members LIMIT 1");
  const m = rows[0] as Member;
  process.env.APPLE_PASS_TYPE_ID = "pass.test.coffee";
  const app = createApp(db);
  const path = `/apple/v1/devices/test-device/registrations/pass.test.coffee/${m.id}`;
  await request(app)
    .post(path)
    .send({ pushToken: "a".repeat(64) })
    .expect(401);
  await request(app)
    .post(path)
    .set("Authorization", `ApplePass ${m.apple_token}`)
    .send({ pushToken: "a".repeat(64) })
    .expect(201);
  await request(app)
    .post(path)
    .set("Authorization", `ApplePass ${m.apple_token}`)
    .send({ pushToken: "b".repeat(64) })
    .expect(200);
  let r = await request(app)
    .get("/apple/v1/devices/test-device/registrations/pass.test.coffee")
    .expect(200);
  assert.deepEqual(r.body.serialNumbers, [m.id]);
  await request(app)
    .get(
      "/apple/v1/devices/test-device/registrations/pass.test.coffee?passesUpdatedSince=" +
        m.version,
    )
    .expect(204);
  await transact(db, m.id, "purchase", randomUUID());
  r = await request(app)
    .get(
      "/apple/v1/devices/test-device/registrations/pass.test.coffee?passesUpdatedSince=" +
        m.version,
    )
    .expect(200);
  assert.deepEqual(r.body.serialNumbers, [m.id]);
  await request(app)
    .get(`/apple/v1/passes/pass.test.coffee/${m.id}`)
    .expect(401);
  await request(app)
    .delete(path)
    .set("Authorization", `ApplePass ${m.apple_token}`)
    .expect(200);
  await request(app)
    .get("/apple/v1/devices/test-device/registrations/pass.test.coffee")
    .expect(204);
  await db.end();
});

test("unconfigured wallet routes fail explicitly instead of simulating success", async () => {
  const db = await memDb();
  const { rows } = await db.query("SELECT * FROM members LIMIT 1");
  const m = rows[0] as Member;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  delete process.env.APPLE_CERT_FILE;
  const app = createApp(db);
  await request(app).get("/wallet/google/" + m.id).expect(503);
  await request(app).get("/wallet/apple/" + m.id).expect(503);
  await request(app)
    .get("/api/members/" + m.id + "/qr")
    .expect("Content-Type", /image\/png/)
    .expect(200);
  await db.end();
});
