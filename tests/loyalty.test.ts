import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { openDb, transact, member, type Member } from "../src/db.js";
import { createApp } from "../src/app.js";
import { runOne } from "../src/queue.js";
// Keep HTTP authorization tests local even when a developer has configured a real HTTPS origin.
delete process.env.PUBLIC_BASE_URL;

function fixture() {
  const db = openDb(":memory:");
  const m = db.prepare("SELECT * FROM members LIMIT 1").get() as Member;
  return { db, m };
}
test("duplicate paid coffee is applied exactly once, including queued deliveries", () => {
  const { db, m } = fixture();
  const key = randomUUID();
  const first = transact(db, m.id, "purchase", key);
  assert.deepEqual(transact(db, m.id, "purchase", key), first);
  assert.equal(member(db, m.id)!.stamps, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()!.n, 2);
  assert.throws(() => transact(db, m.id, "redeem", key));
  db.close();
});
test("eighth stamp awards one reward; new cycle retains unused reward; redemption earns no stamp", () => {
  const { db, m } = fixture();
  for (let i = 0; i < 8; i++) transact(db, m.id, "purchase", randomUUID());
  assert.equal(member(db, m.id)!.stamps, 0);
  assert.equal(member(db, m.id)!.rewards, 1);
  transact(db, m.id, "purchase", randomUUID());
  assert.equal(member(db, m.id)!.stamps, 1);
  assert.equal(member(db, m.id)!.rewards, 1);
  transact(db, m.id, "redeem", randomUUID());
  assert.equal(member(db, m.id)!.stamps, 1);
  assert.equal(member(db, m.id)!.rewards, 0);
  db.close();
});
test("simultaneous independent SQLite connections redeem only once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coffee-test-"));
  const file = join(dir, "test.sqlite");
  const db = openDb(file);
  const id = String(db.prepare("SELECT id FROM members LIMIT 1").get()!.id);
  db.prepare("UPDATE members SET rewards=1").run();
  // Separate threads each use their own SQLite connection and contend for the same transaction lock.
  const source = `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {tsImport}=await import('tsx/esm/api');const {openDb,transact}=await tsImport(workerData.module,workerData.parent);const db=openDb(workerData.file);parentPort.postMessage('ready');parentPort.once('message',()=>{try{transact(db,workerData.id,'redeem',require('node:crypto').randomUUID());parentPort.postMessage(1);}catch(e){if(e.message!=='No reward available')throw e;parentPort.postMessage(0);}finally{db.close();}});})();`;
  const workers = [
    new Worker(source, {
      eval: true,
      workerData: {
        file,
        id,
        module: new URL("../src/db.ts", import.meta.url).href,
        parent: import.meta.url,
      },
    }),
    new Worker(source, {
      eval: true,
      workerData: {
        file,
        id,
        module: new URL("../src/db.ts", import.meta.url).href,
        parent: import.meta.url,
      },
    }),
  ];
  await Promise.all(
    workers.map(
      (w) =>
        new Promise<void>((resolve, reject) => {
          w.once("message", () => resolve());
          w.once("error", reject);
        }),
    ),
  );
  const promises = workers.map(
    (w) =>
      new Promise<number>((resolve, reject) => {
        w.once("message", resolve);
        w.once("error", reject);
      }),
  );
  workers.forEach((w) => w.postMessage("go"));
  assert.deepEqual((await Promise.all(promises)).sort(), [0, 1]);
  assert.equal(member(db, id)!.rewards, 0);
  db.close();
  rmSync(dir, { recursive: true });
});
test("unauthorized staff actions, unconfirmed actions and cross-origin login are rejected", async () => {
  const { db, m } = fixture();
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
  assert.equal(member(db, m.id)!.stamps, 1);
  await agent.post("/api/logout").send({}).expect(200);
  await agent.get(`/api/staff/members/${m.id}`).expect(401);
  db.close();
});
test("wallet failure never rolls back purchase, survives reopening, and retries successfully", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coffee-queue-"));
  const file = join(dir, "db.sqlite");
  let db = openDb(file);
  const id = String(db.prepare("SELECT id FROM members LIMIT 1").get()!.id);
  transact(db, id, "purchase", randomUUID());
  await runOne(db, async () => {
    throw Error("Provider offline");
  });
  assert.equal(member(db, id)!.stamps, 1);
  let j = db.prepare("SELECT * FROM jobs ORDER BY id LIMIT 1").get()!;
  assert.equal(j.status, "retry");
  assert.equal(j.attempts, 1);
  db.close();
  db = openDb(file);
  assert.equal(member(db, id)!.stamps, 1);
  db.prepare("UPDATE jobs SET next_at=0").run();
  await runOne(db, async () => {});
  j = db.prepare("SELECT * FROM jobs ORDER BY id LIMIT 1").get()!;
  assert.equal(j.status, "delivered");
  db.close();
  rmSync(dir, { recursive: true });
});
test("Apple registration authentication, discovery and removal protocol", async () => {
  const { db, m } = fixture();
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
  transact(db, m.id, "purchase", randomUUID());
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
  db.close();
});
test("unconfigured wallet routes fail explicitly instead of simulating success", async () => {
  const { db, m } = fixture();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  delete process.env.APPLE_CERT_FILE;
  const app = createApp(db);
  await request(app)
    .get("/wallet/google/" + m.id)
    .expect(503);
  await request(app)
    .get("/wallet/apple/" + m.id)
    .expect(503);
  await request(app)
    .get("/api/members/" + m.id + "/qr")
    .expect("Content-Type", /image\/png/)
    .expect(200);
  db.close();
});
