import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import request from "supertest";
import { hostedPool, deliverHosted, readMember } from "../src/hosted-db.js";
import { createHostedApp } from "../src/hosted-app.js";
import { passwordHash } from "../src/auth.js";
import { initializeHosted } from "../src/hosted-runtime.js";
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
  await initializeHosted(db);
});
beforeEach(async () => {
  await db.query(
    "TRUNCATE coffee.members,coffee.operations,coffee.jobs,coffee.customer_enrollments,coffee.wallet_issuance,coffee.staff_accounts,coffee.sessions,coffee.request_limits,coffee.programme_changes CASCADE",
  );
  await db.query("UPDATE coffee.programme SET stamp_goal=8");
  await db.query("DELETE FROM coffee.shops WHERE id<>'default'");
  await db.query("UPDATE coffee.shops SET stamp_goal=8,name='Demo Coffee Shop',color='#41291d' WHERE id='default'");
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
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "test@example.com",
    private_key: generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey,
  });
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

test("cold-start initialization creates a missing schema and preserves existing members", async () => {
  await db.query("DROP SCHEMA coffee CASCADE");
  await Promise.all([initializeHosted(db), initializeHosted(db)]);
  assert.equal(Number((await db.query("SELECT count(*) FROM coffee.staff_accounts")).rows[0].count), 0);
  const m = await enroll();
  await initializeHosted(db);
  assert.equal((await readMember(db, m.id)).id, m.id);
});

test("owner registers a chosen account, then creates staff who can log in but cannot create accounts", async () => {
  delete process.env.PUBLIC_BASE_URL;
  const previous = process.env.STAFF_PASSWORD_HASH;
  const ownerPassword = "test-chosen-owner-password";
  delete process.env.STAFF_PASSWORD_HASH;
  try {
    const app = createHostedApp(db);
    const data = { username: "My.Owner", fullName: "Shop Owner", password: ownerPassword };
    await request(app).post("/api/setup/owner").send({ ...data, password: "short" }).expect(400);
    await request(app).post("/api/setup/owner").set("Origin", "https://wrong.example").send(data).expect(403);
    await request(app).post("/api/setup/owner").send(data).expect(201, { username: "my.owner", fullName: "Shop Owner", role: "owner", shopId: "default" });
    await request(app).post("/api/setup/owner").send(data).expect(409);
    const stored = (await db.query("SELECT * FROM coffee.staff_accounts WHERE username='my.owner'")).rows[0];
    assert.ok(stored.password_hash !== ownerPassword);
    assert.equal((await db.query("SELECT full_name FROM coffee.staff_profiles WHERE username='my.owner'")).rows[0].full_name, "Shop Owner");
    await request(app).post("/api/staff/accounts").send({}).expect(401);
    const owner = request.agent(app);
    await owner.post("/api/login").send({ username: "my.owner", password: ownerPassword }).expect(200);
    await owner.get("/api/staff/me").expect(200);
    const staffData = { username: "barista", fullName: "Coffee Staff", password: "test-chosen-staff-password", role: "owner" };
    await owner.post("/api/staff/accounts").send(staffData).expect(201, { username: "barista", fullName: "Coffee Staff", role: "staff", shopId: "default" });
    await owner.post("/api/staff/accounts").send(staffData).expect(409);
    const staff = request.agent(app);
    await staff.post("/api/login").send({ username: "barista", password: staffData.password }).expect(200);
    await staff.post("/api/staff/accounts").send({ ...staffData, username: "intruder" }).expect(403);
    await staff.post("/api/logout").send({}).expect(200);
    await staff.get("/api/staff/me").expect(401);
  } finally {
    if (previous === undefined) delete process.env.STAFF_PASSWORD_HASH;
    else process.env.STAFF_PASSWORD_HASH = previous;
  }
});

test("simultaneous registrations cannot claim the same username", async () => {
  delete process.env.PUBLIC_BASE_URL;
  const previous = process.env.STAFF_PASSWORD_HASH;
  delete process.env.STAFF_PASSWORD_HASH;
  try {
    const app = createHostedApp(db);
    const create = (username: string) => request(app).post("/api/setup/owner").send({ username, fullName: username, password: "test-chosen-password" });
    const results = await Promise.all([create("same-owner"), create("same-owner")]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(Number((await db.query("SELECT count(*) FROM coffee.staff_accounts")).rows[0].count), 1);
  } finally {
    if (previous === undefined) delete process.env.STAFF_PASSWORD_HASH;
    else process.env.STAFF_PASSWORD_HASH = previous;
  }
});

test("authenticated QR scanning awards one stamp, deduplicates frames and retries, and queues one wallet update", async () => {
  delete process.env.PUBLIC_BASE_URL;
  const m = await enroll();
  const app = createHostedApp(db);
  const url = `/api/staff/members/${m.id}/scan`;
  await request(app).post(url).send({}).expect(401);
  await db.query("INSERT INTO coffee.staff_accounts VALUES($1,$2,$3,true)", ["scanner", passwordHash("scanner-test-password"), "staff"]);
  const staff = request.agent(app);
  await staff.post("/api/login").send({ username: "scanner", password: "scanner-test-password" }).expect(200);
  await staff.post(url).send({}).expect(400);
  await staff.post(url).set("Origin", "https://wrong.example").set("Idempotency-Key", randomUUID()).send({}).expect(403);
  const keys = [randomUUID(), randomUUID()];
  const results = await Promise.all(keys.map(key => staff.post(url).set("Idempotency-Key", key).send({}).expect(200)));
  assert.equal(results.filter(r => r.body.awarded).length, 1);
  assert.equal((await readMember(db, m.id)).stamps, 1);
  assert.equal(Number((await db.query("SELECT count(*) FROM coffee.operations WHERE member_id=$1", [m.id])).rows[0].count), 1);
  assert.equal(Number((await db.query("SELECT count(*) FROM coffee.jobs WHERE member_id=$1", [m.id])).rows[0].count), 1);
  const ignored = results.findIndex(r => !r.body.awarded);
  // Simulate time passing: a retry of an ignored frame still cannot become a new purchase.
  await db.query("UPDATE coffee.scan_requests SET created_at=created_at-6000 WHERE member_id=$1", [m.id]);
  const replay = await staff.post(url).set("Idempotency-Key", keys[ignored]).send({}).expect(200);
  assert.equal(replay.body.awarded, false);
  assert.equal((await readMember(db, m.id)).stamps, 1);
  const next = await staff.post(url).set("Idempotency-Key", randomUUID()).send({}).expect(200);
  assert.equal(next.body.awarded, true);
  assert.equal((await readMember(db, m.id)).stamps, 2);
  const another = await enroll();
  await staff.post(`/api/staff/members/${another.id}/scan`).set("Idempotency-Key", keys[0]).send({}).expect(409);
  await staff.post(`/api/staff/members/${randomUUID()}/scan`).set("Idempotency-Key", randomUUID()).send({}).expect(404);
});

test("shops isolate enrollment cookies, staff, scans, purchases, settings and Wallet classes", async () => {
  delete process.env.PUBLIC_BASE_URL;
  const tasks: Promise<unknown>[] = [];
  const app = createHostedApp(db, promise => tasks.push(promise));
  const account = (username: string, shopName: string) => ({ username, shopName, fullName: username, password: "multi-shop-test-password" });
  const a = account("alpha-owner", "Alpha Coffee"), b = account("beta-owner", "Beta Coffee");
  const shopA = (await request(app).post("/api/setup/owner").send(a).expect(201)).body.shopId;
  const shopB = (await request(app).post("/api/setup/owner").send(b).expect(201)).body.shopId;
  assert.notEqual(shopA, shopB);
  const ownerA = request.agent(app), ownerB = request.agent(app);
  await ownerA.post("/api/login").send(a).expect(200);
  await ownerB.post("/api/login").send(b).expect(200);
  const staffCreated = (await ownerA.post("/api/staff/accounts").send({ username: "alpha-staff", fullName: "Alpha Staff", password: "multi-shop-staff-password", shopId: shopB, role: "owner" }).expect(201)).body;
  assert.equal(staffCreated.shopId, shopA);
  assert.equal(staffCreated.role, "staff");
  const staffA = request.agent(app);
  await staffA.post("/api/login").send({ username: "alpha-staff", password: "multi-shop-staff-password" }).expect(200);
  const customer = request.agent(app);
  await customer.get(`/api/customer-session?shop=${shopA}`).expect(200);
  const memberA = (await customer.post("/api/join").send({ name: "Shared browser", accept: true, shopId: shopA }).expect(200)).body.member;
  const memberB = (await customer.post("/api/join").send({ name: "Shared browser", accept: true, shopId: shopB }).expect(200)).body.member;
  assert.notEqual(memberA.id, memberB.id);
  assert.equal(memberA.shopName, "Alpha Coffee");
  assert.equal(memberB.shopName, "Beta Coffee");
  const sessionA = (await customer.get(`/api/customer-session?shop=${shopA}`).expect(200)).body;
  const sessionB = (await customer.get(`/api/customer-session?shop=${shopB}`).expect(200)).body;
  assert.equal(sessionA.member.id, memberA.id);
  assert.equal(sessionB.member.id, memberB.id);
  const listed = (await staffA.get("/api/staff/members").expect(200)).body;
  assert.deepEqual(listed.map((m: any) => m.id), [memberA.id]);
  await staffA.get(`/api/staff/members/${memberB.id}`).expect(404);
  await staffA.post(`/api/staff/members/${memberB.id}/purchase`).set("Idempotency-Key", randomUUID()).send({ confirm: true }).expect(404);
  await staffA.post(`/api/staff/members/${memberB.id}/scan`).set("Idempotency-Key", randomUUID()).send({}).expect(404);
  await ownerA.post("/api/staff/programme").send({ stampGoal: 6 }).expect(200);
  assert.equal((await ownerB.get("/api/staff/programme").expect(200)).body.stampGoal, 8);
  assert.equal((await readMember(db, memberB.id)).stamps, 0);
  await staffA.post("/api/staff/shop").send({ name: "Wrong", color: "#123456" }).expect(403);
  await ownerA.post("/api/staff/shop").send({ name: "Alpha Roasters", color: "#224466", shopId: shopB }).expect(200);
  assert.equal((await request(app).get(`/api/shop?shop=${shopB}`).expect(200)).body.name, "Beta Coffee");
  assert.equal((await request(app).get(`/api/shop?shop=${shopA}`).expect(200)).body.name, "Alpha Roasters");
  await ownerB.post(`/api/staff/members/${memberB.id}/scan`).set("Idempotency-Key", randomUUID()).send({}).expect(200);
  await Promise.all(tasks);
  const job = (await db.query("SELECT id,status FROM coffee.jobs WHERE member_id=$1 ORDER BY id DESC LIMIT 1", [memberB.id])).rows[0];
  await ownerA.post(`/api/staff/jobs/${job.id}/retry`).send({}).expect(409);
  assert.equal((await db.query("SELECT status FROM coffee.jobs WHERE id=$1", [job.id])).rows[0].status, job.status);
  const { object } = await import("../src/google.js");
  const walletA = object(await readMember(db, memberA.id)), walletB = object(await readMember(db, memberB.id));
  assert.notEqual(walletA.classId, walletB.classId);
  assert.notEqual(walletA.id, walletB.id);
  assert.equal(walletA.barcode.value, memberA.id);
  assert.equal(walletB.barcode.value, memberB.id);
});
