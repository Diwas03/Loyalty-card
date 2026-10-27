import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { memDb } from "./helpers.js";
import { initializeHosted } from "../src/hosted-runtime.js";
import { createHostedApp } from "../src/hosted-app.js";

test("workspace refresh, isolation, expiry and logout use scoped httpOnly recovery", async () => {
  delete process.env.PUBLIC_BASE_URL;
  const db = await memDb();
  try {
    await initializeHosted(db);
    const app = createHostedApp(db);
    const browser = request.agent(app);
    await browser.post("/api/setup/owner").send({ username: "owner", fullName: "Owner", shopName: "Cafe", password: "owner-test-password" }).expect(201);
    const login = await browser.post("/api/login").send({ username: "owner", password: "owner-test-password" }).expect(200);
    await browser.get("/api/staff/me").expect(401);
    const restore = await browser.post("/api/staff/session").send({}).expect(200);
    assert.equal(restore.body.token, login.body.token);
    await browser.post("/api/staff/session").set("Origin", "https://evil.example").send({}).expect(403);
    await browser.post("/api/staff/session").set("Content-Type", "text/plain").send("{}").expect(403);
    await browser.post("/api/logout").set("Authorization", "Bearer " + restore.body.token).send({}).expect(200);
    await browser.post("/api/staff/session").send({}).expect(401);
    const second = await browser.post("/api/login").send({ username: "owner", password: "owner-test-password" }).expect(200);
    await db.query("UPDATE coffee.sessions SET expires=0");
    await browser.post("/api/staff/session").send({}).expect(401);
    await browser.get("/api/staff/me").set("Authorization", "Bearer " + second.body.token).expect(401);
  } finally { await db.end(); }
});

test("confirmed purchases and compensating corrections reconcile an immutable tenant ledger", async () => {
  delete process.env.PUBLIC_BASE_URL;
  const db = await memDb();
  try {
    await initializeHosted(db);
    const app = createHostedApp(db);
    async function owner(username: string) {
      await request(app).post("/api/setup/owner").send({ username, fullName: username, shopName: username, password: "owner-test-password" }).expect(201);
      const login = await request(app).post("/api/login").send({ username, password: "owner-test-password" }).expect(200);
      return request.agent(app).set("Authorization", "Bearer " + login.body.token);
    }
    const a = await owner("owner-a"), b = await owner("owner-b");
    await a.post("/api/staff/accounts").send({ username: "cashier", fullName: "Cashier", password: "cashier-test-password" }).expect(201);
    const login = await request(app).post("/api/login").send({ username: "cashier", password: "cashier-test-password" }).expect(200);
    const cashier = request.agent(app).set("Authorization", "Bearer " + login.body.token);
    const m = (await db.query("SELECT coffee.enroll_customer('Member',NULL,'default') AS m")).rows[0].m;
    const url = `/api/staff/members/${m.id}/scan`, key = randomUUID();
    await a.post(url).set("Idempotency-Key", key).send({}).expect(400);
    await Promise.all([1,2].map(() => a.post(url).set("Idempotency-Key",key).send({ confirm: true }).expect(200)));
    const adjustment = `/api/staff/members/${m.id}/adjustment`;
    const body = { delta: -1, reason: "Duplicate purchase correction", confirm: true };
    await cashier.post(adjustment).set("Idempotency-Key",randomUUID()).send(body).expect(403);
    await b.post(adjustment).set("Idempotency-Key",randomUUID()).send(body).expect(409);
    const correctionKey = randomUUID();
    for (let i=0;i<2;i++) await a.post(adjustment).set("Idempotency-Key",correctionKey).send(body).expect(200);
    const ledger = (await db.query("SELECT * FROM coffee.ledger WHERE member_id=$1 ORDER BY id",[m.id])).rows;
    assert.equal(ledger.length,2);
    assert.equal(ledger.reduce((sum,row)=>sum+row.stamp_delta,0),0);
    assert.equal(ledger[1].reason,body.reason);
    await assert.rejects(db.query("UPDATE coffee.ledger SET actor='tampered'"),/immutable/);
    const report = (await a.get("/api/staff/reports").expect(200)).body;
    assert.equal(report.qualifying_visits,1); assert.equal(report.corrections,1); assert.equal(report.trackedSales,null);
    assert.equal((await b.get("/api/staff/reports").expect(200)).body.members,0);
    await cashier.get("/api/staff/customers.csv").expect(403);
    assert.match((await a.get("/api/staff/customers.csv").expect(200)).text,/Member/);
    await initializeHosted(db);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.ledger WHERE member_id=$1",[m.id])).rows[0].n,2);
  } finally { await db.end(); }
});

test("private links rotate without changing balances; transfer links expire and consume exactly once", async () => {
  const db=await memDb();
  try {
    await initializeHosted(db); const app=createHostedApp(db);
    await request(app).post("/api/setup/owner").send({username:"owner",fullName:"Owner",shopName:"Shop",password:"owner-test-password"}).expect(201);
    const token=(await request(app).post("/api/login").send({username:"owner",password:"owner-test-password"})).body.token;
    const owner=request.agent(app).set("Authorization","Bearer "+token);
    const m=(await db.query("SELECT coffee.enroll_customer('Transfer member',NULL,'default') AS m")).rows[0].m;
    const transfer=(await request(app).post(`/api/members/${m.id}/transfer`).send({}).expect(200)).body.transferUrl.split("#")[1];
    const results=await Promise.all([1,2].map(()=>request(app).post("/api/recover").send({token:transfer})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,410]);
    const expired=(await request(app).post(`/api/members/${m.id}/transfer`).send({}).expect(200)).body.transferUrl.split("#")[1];
    await db.query("UPDATE coffee.card_transfers SET expires=0");
    await request(app).post("/api/recover").send({token:expired}).expect(410);
    const outstanding=(await request(app).post(`/api/members/${m.id}/transfer`).send({}).expect(200)).body.transferUrl.split("#")[1];
    const rotated=(await owner.post(`/api/staff/members/${m.id}/rotate-link`).send({confirm:true}).expect(200)).body.customerUrl.split("=")[1];
    await request(app).get(`/api/members/${m.id}`).expect(404);
    await request(app).get(`/api/members/${m.id}/qr`).expect(404);
    assert.equal((await request(app).get(`/api/members/${rotated}`).expect(200)).body.stamps,0);
    await request(app).get(`/api/members/${rotated}/qr`).expect(200);
    await request(app).post("/api/recover").send({token:outstanding}).expect(410);
    await owner.post("/api/staff/region").send({currency:"BTN",country:"BT",timezone:"Asia/Thimphu"}).expect(200);
    await owner.post("/api/staff/region").send({currency:"BTN",country:"BT",timezone:"Invalid/zone"}).expect(400);
  } finally { await db.end(); }
});

test("issued vouchers retain terms, redeem once and expire with reconciling ledger entries", async () => {
  const db=await memDb();
  try {
    await initializeHosted(db);
    await db.query("UPDATE coffee.shops SET stamp_goal=2,reward_label='Original reward',reward_expiry_days=30 WHERE id='default'");
    const id=(await db.query("SELECT coffee.enroll_customer('Voucher customer',NULL,'default') AS m")).rows[0].m.id;
    const purchase=()=>db.query("SELECT coffee.mutate_member($1,'purchase',$2,'test')",[id,randomUUID()]);
    await purchase(); await purchase();
    const reward=(await db.query("SELECT * FROM coffee.issued_rewards WHERE member_id=$1",[id])).rows[0];
    assert.equal(reward.label,"Original reward"); assert.equal(reward.status,"available"); assert.ok(reward.expires_at>reward.issued_at);
    await db.query("UPDATE coffee.shops SET reward_label='New reward',reward_expiry_days=1 WHERE id='default'");
    assert.equal((await db.query("SELECT label FROM coffee.issued_rewards WHERE id=$1",[reward.id])).rows[0].label,"Original reward");
    const results=await Promise.allSettled([1,2].map(()=>db.query("SELECT coffee.mutate_member($1,'redeem',$2,'test')",[id,randomUUID()])));
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal((await db.query("SELECT status FROM coffee.issued_rewards WHERE id=$1",[reward.id])).rows[0].status,"redeemed");
    await purchase(); await purchase();
    await db.query("UPDATE coffee.issued_rewards SET expires_at=1 WHERE member_id=$1 AND status='available'",[id]);
    await Promise.all([1,2].map(()=>db.query("SELECT coffee.expire_member_rewards($1)",[id])));
    assert.equal((await db.query("SELECT rewards FROM coffee.members WHERE id=$1",[id])).rows[0].rewards,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.operations WHERE member_id=$1 AND kind='expire'",[id])).rows[0].n,1);
    assert.equal((await db.query("SELECT sum(reward_delta)::int AS n FROM coffee.ledger WHERE member_id=$1",[id])).rows[0].n,0);
    await initializeHosted(db);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM coffee.issued_rewards WHERE member_id=$1",[id])).rows[0].n,2);
  } finally { await db.end(); }
});

test("a staff account can join a second business without cross-business or unassigned-location access",async()=>{
  const db=await memDb();
  try{
    await initializeHosted(db);const app=createHostedApp(db);
    async function register(username:string){
      const account=(await request(app).post("/api/setup/owner").send({username,fullName:username,shopName:username,password:"business-test-password"}).expect(201)).body;
      const login=(await request(app).post("/api/login").send({username,password:"business-test-password"}).expect(200)).body;
      return {shopId:account.shopId,client:request.agent(app).set("Authorization","Bearer "+login.token)};
    }
    const a=await register("business-a"),b=await register("business-b");
    const location=(await a.client.post("/api/staff/locations").send({name:"Second location"}).expect(201)).body;
    await b.client.post("/api/staff/workspace").send({shopId:a.shopId,locationId:location.id}).expect(403);
    const invite=(await a.client.post("/api/staff/team-invites").send({role:"manager",locations:[location.id]}).expect(201)).body.inviteUrl.split("#")[1];
    await b.client.post("/api/staff/team-invites/accept").send({token:invite}).expect(200);
    await b.client.post("/api/staff/team-invites/accept").send({token:invite}).expect(409);
    await b.client.post("/api/staff/workspace").send({shopId:a.shopId,locationId:a.shopId+":main"}).expect(403);
    await b.client.post("/api/staff/workspace").send({shopId:a.shopId,locationId:location.id}).expect(200);
    assert.equal((await b.client.get("/api/staff/me").expect(200)).body.businessRole,"manager");
    await b.client.post("/api/staff/region").send({currency:"BTN",country:"BT",timezone:"Asia/Thimphu"}).expect(403);
    await b.client.get("/api/staff/team").expect(403);
    const member=(await db.query("SELECT coffee.enroll_customer('Scoped customer',NULL,$1) AS m",[a.shopId])).rows[0].m;
    await b.client.post(`/api/staff/members/${member.id}/scan`).set("Idempotency-Key",randomUUID()).send({confirm:true}).expect(200);
    assert.equal((await db.query("SELECT location_id FROM coffee.ledger WHERE member_id=$1",[member.id])).rows[0].location_id,location.id);
    await assert.rejects(db.query("SELECT coffee.staff_mutate($1,'scan',$2,'business-b',$3,$4)",[member.id,randomUUID(),a.shopId,a.shopId+":main"]),/Location access denied/);
    await a.client.post("/api/staff/team/business-a").send({role:"cashier",enabled:true,locations:[location.id]}).expect(409);
    await a.client.post("/api/staff/team/business-b").send({role:"cashier",enabled:false,locations:[]}).expect(200);
    await b.client.get("/api/staff/me").expect(401);
    await initializeHosted(db);
    const relogin=(await request(app).post("/api/login").send({username:"business-b",password:"business-test-password"}).expect(200)).body;
    const independent=request.agent(app).set("Authorization","Bearer "+relogin.token);
    assert.equal((await independent.get("/api/staff/me").expect(200)).body.shopId,b.shopId);
    await independent.post("/api/staff/workspace").send({shopId:a.shopId,locationId:a.shopId+":main"}).expect(403);
    await independent.get(`/api/staff/members/${member.id}`).expect(404);
  }finally{await db.end();}
});
