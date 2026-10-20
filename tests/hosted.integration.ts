import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { hostedPool, deliverHosted, readMember } from "../src/hosted-db.js";
import { createHostedApp } from "../src/hosted-app.js";
import { passwordHash } from "../src/auth.js";
const url = new URL(process.env.TEST_DATABASE_URL || "");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/coffee_test"
)
  throw Error("Use a disposable loopback coffee_test database only");
process.env.DATABASE_URL = url.toString();
delete process.env.PUBLIC_BASE_URL;
delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const db = hostedPool();
before(async () => {
  await db.query("DROP SCHEMA IF EXISTS coffee CASCADE");
  await db.query(readFileSync("supabase/schema.sql", "utf8"));
});
beforeEach(async () => {
  await db.query(
    "TRUNCATE coffee.members,coffee.operations,coffee.jobs,coffee.customer_enrollments,coffee.wallet_issuance,coffee.staff_accounts,coffee.sessions,coffee.request_limits,coffee.programme_changes CASCADE",
  );
  await db.query("UPDATE coffee.programme SET stamp_goal=8");
});
after(() => db.end());
const enroll = async () =>
  (await db.query("SELECT coffee.enroll_customer('Test customer') AS m"))
    .rows[0].m;
test("Postgres RPC duplicate earning, eighth reward, retention and concurrent double redemption", async () => {
  const m = await enroll();
  const key = randomUUID();
  const mutate = (kind: string, k = randomUUID()) =>
    db.query("SELECT coffee.mutate_member($1,$2,$3,$4) AS result", [
      m.id,
      kind,
      k,
      "test-staff",
    ]);
  await Promise.all([mutate("purchase", key), mutate("purchase", key)]);
  assert.equal((await readMember(db, m.id)).stamps, 1);
  for (let i = 0; i < 7; i++) await mutate("purchase");
  let balance = await readMember(db, m.id);
  assert.equal(balance.stamps, 0);
  assert.equal(balance.rewards, 1);
  await mutate("purchase");
  assert.equal((await readMember(db, m.id)).rewards, 1);
  const results = await Promise.allSettled([
    mutate("redeem"),
    mutate("redeem"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  balance = await readMember(db, m.id);
  assert.equal(balance.stamps, 1);
  assert.equal(balance.rewards, 0);
  assert.equal(
    (await db.query("SELECT count(*) FROM coffee.operations")).rows[0].count,
    10,
  );
});
test("hosted enrollment retries, distinct browsers, named staff authorization and history", async () => {
  const tasks: Promise<unknown>[] = [];
  const app = createHostedApp(db, (p) => tasks.push(p));
  const c = request.agent(app);
  await c.get("/api/customer-session").expect(200);
  await c.post("/api/join").send({ accept: false, name: "Ada" }).expect(400);
  const first = (
    await c.post("/api/join").send({ accept: true, name: "Ada" }).expect(200)
  ).body;
  const again = (
    await c.post("/api/join").send({ accept: true, name: "Ada" }).expect(200)
  ).body;
  assert.equal(first.member.id, again.member.id);
  assert.equal(first.member.apple_token, undefined);
  const other = request.agent(app);
  await other.get("/api/customer-session");
  assert.notEqual(
    (await other.post("/api/join").send({ accept: true, name: "Ada" })).body
      .member.id,
    first.member.id,
  );
  await request(app)
    .post("/api/staff/members/" + first.member.id + "/purchase")
    .send({ confirm: true })
    .expect(401);
  await db.query("INSERT INTO coffee.staff_accounts VALUES($1,$2,$3,true)", [
    "barista",
    passwordHash("temporary-staff-test"),
    "staff",
  ]);
  const staff = request.agent(app);
  await staff
    .post("/api/login")
    .send({ username: "barista", password: "temporary-staff-test" })
    .expect(200);
  await staff.post("/api/staff/programme").send({ stampGoal: 10 }).expect(403);
  for (let i = 0; i < 2; i++)
    await staff
      .post("/api/staff/members/" + first.member.id + "/purchase")
      .set("Idempotency-Key", "hosted-purchase-request-key")
      .send({ confirm: true })
      .expect(200);
  await Promise.all(tasks);
  const details = (
    await staff.get("/api/staff/members/" + first.member.id).expect(200)
  ).body;
  assert.equal(details.stamps, 1);
  assert.equal(details.history.length, 1);
  assert.equal(details.history[0].actor, "barista");
  assert.ok(["blocked", "working"].includes(details.deliveries[0].status));
});
test("hosted wallet failure preserves committed purchase; retry succeeds and claim serializes one membership", async () => {
  const m = await enroll();
  await db.query("SELECT coffee.mutate_member($1,$2,$3,$4)", [
    m.id,
    "purchase",
    randomUUID(),
    "staff",
  ]);
  process.env.GOOGLE_ISSUER_ID = "test";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "test";
  process.env.PUBLIC_BASE_URL = "https://coffee.example";
  await deliverHosted(db, m.id, async () => {
    throw Error("Google Wallet PATCH HTTP 500");
  });
  assert.equal((await readMember(db, m.id)).stamps, 1);
  assert.equal(
    (await db.query("SELECT status FROM coffee.jobs")).rows[0].status,
    "retry",
  );
  await db.query("UPDATE coffee.jobs SET next_at=0");
  await deliverHosted(db, m.id, async () => {});
  assert.equal(
    (await db.query("SELECT status FROM coffee.jobs")).rows[0].status,
    "delivered",
  );
  await db.query("SELECT coffee.mutate_member($1,$2,$3,$4)", [
    m.id,
    "purchase",
    randomUUID(),
    "staff",
  ]);
  await db.query("SELECT coffee.mutate_member($1,$2,$3,$4)", [
    m.id,
    "purchase",
    randomUUID(),
    "staff",
  ]);
  const claimed = await Promise.all([
    db.query("SELECT coffee.claim_job($1) AS job", [m.id]),
    db.query("SELECT coffee.claim_job($1) AS job", [m.id]),
  ]);
  assert.equal(claimed.filter((r) => r.rows[0].job).length, 1);
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.PUBLIC_BASE_URL;
});
test("hosted goal mutation queues updates, protects progress, and cron endpoint requires bearer authorization", async () => {
  const m = await enroll();
  await db.query("SELECT coffee.mutate_member($1,$2,$3,$4)", [
    m.id,
    "purchase",
    randomUUID(),
    "staff",
  ]);
  await db.query("SELECT coffee.change_goal(10,'owner')");
  assert.equal((await readMember(db, m.id)).stamp_goal, 10);
  await assert.rejects(db.query("SELECT coffee.change_goal(1,'owner')"));
  const app = createHostedApp(db);
  process.env.CRON_SECRET = "temporary-cron-test-not-production";
  await request(app).get("/api/cron/wallet-updates").expect(401);
  await request(app)
    .post("/api/cron/wallet-updates")
    .set("Authorization", "Bearer " + process.env.CRON_SECRET)
    .send({})
    .expect(200);
  delete process.env.CRON_SECRET;
});
test("private Postgres schema denies untrusted database roles", async () => {
  await db.query("CREATE ROLE coffee_test_visitor NOLOGIN");
  const c = await db.connect();
  try {
    await c.query("SET ROLE coffee_test_visitor");
    await assert.rejects(
      c.query("SELECT * FROM coffee.members"),
      /permission denied/,
    );
  } finally {
    await c.query("RESET ROLE");
    c.release();
    await db.query("DROP ROLE coffee_test_visitor");
  }
});

test("hosted configuration is repeatable and legacy public import preserves identities, balance and ledger", async () => {
  const { migrate, transact } = await import("../src/db.js");
  const { installHosted, importLegacyPublic, hostedStatus } =
    await import("../src/hosted-setup.js");
  await installHosted(db);
  await migrate(db);
  assert.equal(
    (
      await db.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='public.members'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
  );
  const original = (await db.query("SELECT * FROM public.members LIMIT 1"))
    .rows[0];
  await transact(db, original.id, "purchase", randomUUID(), "legacy-staff");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7342101)");
    await c.query("SELECT pg_advisory_xact_lock(7342102)");
    const imported = await importLegacyPublic(c);
    assert.equal(imported.imported, true);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  const m = await readMember(db, original.id);
  assert.equal(m.stamps, 1);
  assert.equal(m.apple_token, original.apple_token);
  assert.equal(
    (await db.query("SELECT actor FROM coffee.operations")).rows[0].actor,
    "legacy-staff",
  );
  await assert.rejects(importLegacyPublic(db), /Refusing to overwrite/);
  assert.equal((await hostedStatus(db)).legacyPublicTables, true);
});
