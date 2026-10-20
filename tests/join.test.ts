import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
delete process.env.PUBLIC_BASE_URL;
test("shop self-enrollment requires consent and cookie, retries reuse membership without resetting balance", async () => {
  const db = openDb(":memory:"),
    app = createApp(db),
    customer = request.agent(app);
  await request(app)
    .post("/api/join")
    .send({ name: "Coffee fan", accept: true })
    .expect(400);
  await customer.get("/api/customer-session").expect(200);
  await customer
    .post("/api/join")
    .send({ name: "Coffee fan", accept: false })
    .expect(400);
  const first = await customer
    .post("/api/join")
    .send({ name: "Coffee fan", accept: true })
    .expect(200);
  const id = first.body.member.id;
  db.prepare("UPDATE members SET stamps=3,rewards=1 WHERE id=?").run(id);
  const second = await customer
    .post("/api/join")
    .send({ name: "Changed nickname", accept: true })
    .expect(200);
  assert.equal(second.body.member.id, id);
  assert.equal(second.body.member.stamps, 3);
  assert.equal(second.body.member.rewards, 1);
  assert.equal(second.body.member.name, "Coffee fan");
  assert.equal(second.body.member.apple_token, undefined);
  assert.equal(
    (await customer.get("/api/customer-session")).body.member.id,
    id,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM customer_enrollments").get()!.n,
    1,
  );
  await customer
    .post("/api/staff/members/" + id + "/purchase")
    .send({ confirm: true })
    .expect(401);
  db.close();
});
test("different browsers scanning the same shop QR get different memberships; stored cookie credential is hashed", async () => {
  const db = openDb(":memory:"),
    app = createApp(db);
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const c = request.agent(app);
    const session = await c.get("/api/customer-session");
    const raw = String(session.headers["set-cookie"][0])
      .split(";")[0]
      .split("=")[1];
    const r = await c
      .post("/api/join")
      .send({ name: "Same nickname", accept: true })
      .expect(200);
    ids.push(r.body.member.id);
    assert.ok(
      !db
        .prepare("SELECT token_hash FROM customer_enrollments")
        .all()
        .some((x) => x.token_hash === raw),
    );
  }
  assert.notEqual(ids[0], ids[1]);
  db.close();
});
test("printed shop QR uses the public join URL, never a customer membership", async () => {
  const db = openDb(":memory:"),
    app = createApp(db);
  await request(app).get("/shop-qr.png").expect(503);
  process.env.PUBLIC_BASE_URL = "https://coffee.example";
  const r = await request(app).get("/api/shop").expect(200);
  assert.equal(r.body.joinUrl, "https://coffee.example/join.html");
  await request(app)
    .get("/shop-qr.png")
    .expect("Content-Type", /image\/png/)
    .expect(200);
  await request(app)
    .post("/api/join")
    .set("Origin", "https://evil.example")
    .send({ name: "x", accept: true })
    .expect(403);
  delete process.env.PUBLIC_BASE_URL;
  db.close();
});
