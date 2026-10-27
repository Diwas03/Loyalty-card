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
  await db.query("TRUNCATE coffee.locations,coffee.access_audit,coffee.team_invites CASCADE");
  await db.query("INSERT INTO coffee.locations(id,shop_id,name) VALUES('default:main','default','Main location')");
  await db.query("DELETE FROM coffee.shops WHERE id<>'default'");
  await db.query("UPDATE coffee.shops SET referrals_enabled=true,referral_reward_kind='stamps',referral_reward_amount=1,stamp_goal=8,name='Demo Coffee Shop',color='#41291d' WHERE id='default'");
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
    .expect(200).then(response => { staff.set("Authorization", "Bearer " + response.body.token); });
  await staff.post("/api/staff/programme").send({ stampGoal: 10 }).expect(403);
  for (let i = 0; i < 2; i++)
    await staff
      .post("/api/staff/members/" + first.member.id + "/scan")
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
  process.env.GOOGLE_ISSUER_ID = "123456";
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
  assert.equal(m.stamps, (original.stamps + 1) % 8);
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
    await owner.post("/api/login").send({ username: "my.owner", password: ownerPassword }).expect(200).then(response => { owner.set("Authorization", "Bearer " + response.body.token); });
    await owner.get("/api/staff/me").expect(200);
    const staffData = { username: "barista", fullName: "Coffee Staff", password: "test-chosen-staff-password", role: "owner" };
    await owner.post("/api/staff/accounts").send(staffData).expect(201, { username: "barista", fullName: "Coffee Staff", role: "staff", shopId: "default" });
    await owner.post("/api/staff/accounts").send(staffData).expect(409);
    const staff = request.agent(app);
    await staff.post("/api/login").send({ username: "barista", password: staffData.password }).expect(200).then(response => { staff.set("Authorization", "Bearer " + response.body.token); });
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
  await request(app).post(url).send({ confirm: true }).expect(401);
  await db.query("INSERT INTO coffee.staff_accounts VALUES($1,$2,$3,true)", ["scanner", passwordHash("scanner-test-password"), "staff"]);
  const staff = request.agent(app);
  await staff.post("/api/login").send({ username: "scanner", password: "scanner-test-password" }).expect(200).then(response => { staff.set("Authorization", "Bearer " + response.body.token); });
  await staff.post(`/api/staff/members/${m.id}/purchase`).set("Idempotency-Key", randomUUID()).send({ confirm: true }).expect(410);
  await staff.post(url).send({ confirm: true }).expect(400);
  await staff.post(url).set("Origin", "https://wrong.example").set("Idempotency-Key", randomUUID()).send({ confirm: true }).expect(403);
  const keys = [randomUUID(), randomUUID()];
  const results = await Promise.all(keys.map(key => staff.post(url).set("Idempotency-Key", key).send({ confirm: true }).expect(200)));
  assert.equal(results.filter(r => r.body.awarded).length, 1);
  assert.equal((await readMember(db, m.id)).stamps, 1);
  assert.equal(Number((await db.query("SELECT count(*) FROM coffee.operations WHERE member_id=$1", [m.id])).rows[0].count), 1);
  assert.equal(Number((await db.query("SELECT count(*) FROM coffee.jobs WHERE member_id=$1", [m.id])).rows[0].count), 1);
  const ignored = results.findIndex(r => !r.body.awarded);
  // Simulate time passing: a retry of an ignored frame still cannot become a new purchase.
  await db.query("UPDATE coffee.scan_requests SET created_at=created_at-6000 WHERE member_id=$1", [m.id]);
  const replay = await staff.post(url).set("Idempotency-Key", keys[ignored]).send({ confirm: true }).expect(200);
  assert.equal(replay.body.awarded, false);
  assert.equal((await readMember(db, m.id)).stamps, 1);
  const next = await staff.post(url).set("Idempotency-Key", randomUUID()).send({ confirm: true }).expect(200);
  assert.equal(next.body.awarded, true);
  assert.equal((await readMember(db, m.id)).stamps, 2);
  const another = await enroll();
  await staff.post(`/api/staff/members/${another.id}/scan`).set("Idempotency-Key", keys[0]).send({ confirm: true }).expect(409);
  await staff.post(`/api/staff/members/${randomUUID()}/scan`).set("Idempotency-Key", randomUUID()).send({ confirm: true }).expect(404);
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
  await ownerA.post("/api/login").send(a).expect(200).then(response => { ownerA.set("Authorization", "Bearer " + response.body.token); });
  await ownerB.post("/api/login").send(b).expect(200).then(response => { ownerB.set("Authorization", "Bearer " + response.body.token); });
  const staffCreated = (await ownerA.post("/api/staff/accounts").send({ username: "alpha-staff", fullName: "Alpha Staff", password: "multi-shop-staff-password", shopId: shopB, role: "owner" }).expect(201)).body;
  assert.equal(staffCreated.shopId, shopA);
  assert.equal(staffCreated.role, "staff");
  const staffA = request.agent(app);
  await staffA.post("/api/login").send({ username: "alpha-staff", password: "multi-shop-staff-password" }).expect(200).then(response => { staffA.set("Authorization", "Bearer " + response.body.token); });
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
  await staffA.post(`/api/staff/members/${memberB.id}/scan`).set("Idempotency-Key", randomUUID()).send({ confirm: true }).expect(404);
  await ownerA.post("/api/staff/programme").send({ stampGoal: 6 }).expect(200);
  assert.equal((await ownerB.get("/api/staff/programme").expect(200)).body.stampGoal, 8);
  assert.equal((await readMember(db, memberB.id)).stamps, 0);
  await staffA.post("/api/staff/shop").send({ name: "Wrong", color: "#123456" }).expect(403);
  await ownerA.post("/api/staff/shop").send({ name: "Alpha Roasters", color: "#224466", shopId: shopB }).expect(200);
  assert.equal((await request(app).get(`/api/shop?shop=${shopB}`).expect(200)).body.name, "Beta Coffee");
  assert.equal((await request(app).get(`/api/shop?shop=${shopA}`).expect(200)).body.name, "Alpha Roasters");
  await ownerB.post(`/api/staff/members/${memberB.id}/scan`).set("Idempotency-Key", randomUUID()).send({ confirm: true }).expect(200);
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

test("staff mutations require bearer tokens; refresh cookies are scoped; shop design is owner-only, validated and visible on customer cards", async () => {
  const app = createHostedApp(db);
  const password = "design-owner-test-password";
  await request(app).post("/api/setup/owner").send({ username: "designer", fullName: "Design Owner", shopName: "Design Shop", password }).expect(201);
  const login = await request(app).post("/api/login").send({ username: "designer", password }).expect(200);
  assert.match(login.body.token, /^[a-f0-9]{64}$/);
  assert.equal(login.body.expiresIn, 1800);
  assert.match(JSON.stringify(login.headers["set-cookie"] || []), /HttpOnly/);
  assert.match(JSON.stringify(login.headers["set-cookie"] || []), /Path=\/api\/staff\/session/);
  await request(app).get("/api/staff/me").set("Cookie", "staff=" + login.body.token).expect(401);
  const owner = request.agent(app).set("Authorization", "Bearer " + login.body.token);
  await owner.post("/api/staff/enroll").send({ name: "Removed feature" }).expect(410);
  const customer = request.agent(app);
  await customer.get("/api/customer-session").expect(200);
  const joined = (await customer.post("/api/join").send({ name: "Own signup", accept: true }).expect(200)).body.member;
  const design = { name: "Design Shop", color: "#eedd99", cardTitle: "Regulars club", tagline: "Thanks for stopping by.", rewardLabel: "Free latte", stampIcon: "heart", cardStyle: "minimal", logoData: "" };
  await owner.post("/api/staff/shop").send({ ...design, logoData: "data:image/svg+xml;base64,PHN2Zz4=" }).expect(400);
  await owner.post("/api/staff/shop").send({ ...design, stampIcon: "invalid" }).expect(400);
  await owner.post("/api/staff/shop").send(design).expect(200);
  const card = (await request(app).get("/api/members/" + joined.id).expect(200)).body;
  assert.equal(card.cardTitle, design.cardTitle);
  assert.equal(card.rewardLabel, design.rewardLabel);
  assert.equal(card.stampIcon, "heart");
  assert.equal(card.cardStyle, "minimal");
  assert.equal(card.shopColor, design.color);
  assert.equal(card.stamps, 0);
  await db.query("UPDATE coffee.sessions SET expires=$1 WHERE token_hash=$2", [Date.now() - 1, (await import("../src/hosted-db.js")).digest(login.body.token)]);
  await owner.get("/api/staff/me").expect(401);
});

test("referrals credit the sponsor exactly once on a first paid visit, preserve snapshot terms and roll stamps into rewards", async () => {
  const app = createHostedApp(db);
  const sponsorBrowser = request.agent(app);
  await sponsorBrowser.get("/api/customer-session").expect(200);
  const sponsor = (await sponsorBrowser.post("/api/join").send({ name: "Referrer", accept: true }).expect(200)).body.member;
  assert.match(sponsor.referral.code, /^[a-f0-9]{32}$/);
  assert.notEqual(sponsor.referral.code, sponsor.id.replaceAll("-", ""));
  const self = await sponsorBrowser.post("/api/join").send({ name: "Self", accept: true, referralCode: sponsor.referral.code }).expect(200);
  assert.equal(self.body.member.id, sponsor.id);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.referrals")).rows[0].n, 0);
  await db.query("UPDATE coffee.shops SET referral_reward_amount=3 WHERE id='default'");
  await db.query("UPDATE coffee.members SET stamps=7 WHERE id=$1", [sponsor.id]);
  const friend = request.agent(app);
  await friend.get("/api/customer-session").expect(200);
  const invited = (await friend.post("/api/join").send({ name: "Friend", accept: true, referralCode: sponsor.referral.code }).expect(200)).body.member;
  await friend.post("/api/join").send({ name: "Retry", accept: true, referralCode: sponsor.referral.code }).expect(200);
  assert.equal((await readMember(db, sponsor.id)).rewards, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.referrals")).rows[0].n, 1);
  // An owner can pause future referrals; the pending promise still qualifies for 3 stamps.
  await db.query("UPDATE coffee.shops SET referrals_enabled=false,referral_reward_amount=1 WHERE id='default'");
  const key = randomUUID();
  await Promise.all([1, 2].map(() => db.query("SELECT coffee.mutate_member($1,'purchase',$2,'staff')", [invited.id, key])));
  await db.query("SELECT coffee.mutate_member($1,'purchase',$2,'staff')", [invited.id, randomUUID()]);
  const paid = await readMember(db, sponsor.id);
  assert.equal(paid.stamps, 2);
  assert.equal(paid.rewards, 1);
  assert.equal(Number(paid.credited_count), 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.operations WHERE kind='referral'")).rows[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.jobs WHERE member_id=$1", [sponsor.id])).rows[0].n, 1);
  const disabledFriend = request.agent(app);
  await disabledFriend.get("/api/customer-session").expect(200);
  await disabledFriend.post("/api/join").send({ name: "After pause", accept: true, referralCode: sponsor.referral.code }).expect(200);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.referrals")).rows[0].n, 1);
});

test("owner dashboard and referral settings stay inside their shop; reward payouts work through QR scans", async () => {
  const app = createHostedApp(db);
  const a = { username: "ref-owner-a", fullName: "Owner A", shopName: "Shop A", password: "referral-owner-password" };
  const b = { ...a, username: "ref-owner-b", shopName: "Shop B" };
  const shopA = (await request(app).post("/api/setup/owner").send(a).expect(201)).body.shopId;
  const shopB = (await request(app).post("/api/setup/owner").send(b).expect(201)).body.shopId;
  const ownerA = request.agent(app).set("Authorization", "Bearer " + (await request(app).post("/api/login").send(a).expect(200)).body.token);
  const ownerB = request.agent(app).set("Authorization", "Bearer " + (await request(app).post("/api/login").send(b).expect(200)).body.token);
  await ownerA.post("/api/staff/referrals").send({ enabled: true, rewardKind: "rewards", rewardAmount: 2, shopId: shopB }).expect(200);
  await ownerA.post("/api/staff/referrals").send({ enabled: true, rewardKind: "rewards", rewardAmount: 100 }).expect(400);
  await request(app).get("/api/staff/overview").expect(401);
  const signup = async (shopId: string, referralCode?: string) => {
    const customer = request.agent(app); await customer.get("/api/customer-session").expect(200);
    return (await customer.post("/api/join").send({ name: "New customer", accept: true, shopId, referralCode }).expect(200)).body.member;
  };
  const sponsor = await signup(shopA);
  assert.equal((await request(app).get(`/api/referral?shop=${shopB}&ref=${sponsor.referral.code}`).expect(200)).body.valid, false);
  const otherShop = await signup(shopB, sponsor.referral.code);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.referrals")).rows[0].n, 0);
  const first = await signup(shopA, sponsor.referral.code);
  await ownerB.post(`/api/staff/members/${first.id}/scan`).set("Idempotency-Key", randomUUID()).send({ confirm: true }).expect(404);
  const key = randomUUID();
  for (let i = 0; i < 2; i++) await ownerA.post(`/api/staff/members/${first.id}/scan`).set("Idempotency-Key", key).send({ confirm: true }).expect(200);
  assert.equal((await readMember(db, sponsor.id)).rewards, 2);
  assert.equal((await readMember(db, otherShop.id)).rewards, 0);
  const overviewA = (await ownerA.get("/api/staff/overview").expect(200)).body;
  const overviewB = (await ownerB.get("/api/staff/overview").expect(200)).body;
  assert.equal(overviewA.metrics.customers, 2);
  assert.equal(overviewA.metrics.purchases_24h, 1);
  assert.equal(overviewA.metrics.available_rewards, 2);
  assert.equal(overviewA.metrics.credited_referrals, 1);
  assert.equal(overviewB.metrics.customers, 1);
  assert.equal(overviewB.metrics.purchases_24h, 0);
  assert.equal((await ownerA.get("/api/staff/referrals").expect(200)).body.referrals.length, 1);
  assert.equal((await ownerB.get("/api/staff/referrals").expect(200)).body.referrals.length, 0);
  await ownerA.post("/api/staff/accounts").send({ username: "ref-staff", fullName: "Staff", password: "referral-staff-password" }).expect(201);
  const staff = request.agent(app).set("Authorization", "Bearer " + (await request(app).post("/api/login").send({ username: "ref-staff", password: "referral-staff-password" }).expect(200)).body.token);
  await staff.get("/api/staff/overview").expect(403);
  await staff.get("/api/staff/referrals").expect(403);
  await staff.post("/api/staff/referrals").send({ enabled: false, rewardKind: "stamps", rewardAmount: 1 }).expect(403);
});
