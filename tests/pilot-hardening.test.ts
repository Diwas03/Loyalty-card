import {test} from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {randomBytes,randomUUID} from "node:crypto";
import {memDb} from "./helpers.js";
import {initializeHosted,verifyHostedSchema} from "../src/hosted-runtime.js";
import {installHosted} from "../src/hosted-setup.js";
import {createHostedApp} from "../src/hosted-app.js";
import {digest} from "../src/hosted-db.js";
async function fixture(){const db=await memDb();await initializeHosted(db);return {db,app:createHostedApp(db)};}
async function owner(app:ReturnType<typeof createHostedApp>,username:string){
 const credentials={username,fullName:username,shopName:username,password:"pilot-hardening-password"};
 const shop=(await request(app).post('/api/setup/owner').send(credentials).expect(201)).body.shopId;
 const login=(await request(app).post('/api/login').send(credentials).expect(200)).body;
 return {shop,token:login.token,client:request.agent(app).set('Authorization','Bearer '+login.token)};
}
test("revocation closes browser recovery and stale transfer creation; transfer conflicts are not consumed",async()=>{
 const {db,app}=await fixture();try{
  const own=await owner(app,'link-owner');const browser=request.agent(app);await browser.get('/api/customer-session').expect(200);
  const card=(await browser.post('/api/join').send({name:'Private customer',accept:true}).expect(200)).body.member;
  const transfer=(await browser.post('/api/members/'+card.id+'/transfer').send({}).expect(200)).body.transferUrl.split('#')[1];
  const rotated=(await own.client.post('/api/staff/members/'+card.id+'/rotate-link').send({confirm:true}).expect(200)).body.customerUrl;
  await request(app).get('/api/members/'+card.id).expect(404);
  assert.equal((await browser.get('/api/customer-session').expect(200)).body.member,null);
  await request(app).post('/api/recover').send({token:transfer}).expect(410);
  assert.equal((await db.query('SELECT coffee.create_transfer($1,$2) AS created',[card.id,digest('fake')])).rows[0].created,false);
  const newId=new URL(rotated,'http://localhost').searchParams.get('member');
  const valid=(await request(app).post('/api/members/'+newId+'/transfer').send({}).expect(200)).body.transferUrl.split('#')[1];
  const occupied=request.agent(app);await occupied.get('/api/customer-session').expect(200);await occupied.post('/api/join').send({name:'Other member',accept:true}).expect(200);
  await occupied.post('/api/recover').send({token:valid}).expect(409);
  const results=await Promise.all([1,2].map(()=>request(app).post('/api/recover').send({token:valid})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,410]);
 }finally{await db.end();}
});
test("location revocation blocks reads/corrections; cross-shop reads cannot expire someone else's rewards",async()=>{
 const {db,app}=await fixture();try{
  const a=await owner(app,'scope-a'),b=await owner(app,'scope-b');
  const other=(await db.query("SELECT coffee.enroll_customer('Other shop',NULL,$1) AS m",[b.shop])).rows[0].m;
  await db.query("UPDATE coffee.shops SET stamp_goal=2,reward_expiry_days=1 WHERE id=$1",[b.shop]);
  for(let i=0;i<2;i++)await db.query("SELECT coffee.mutate_member($1,'purchase',$2,'scope-b')",[other.id,randomUUID()]);
  await db.query("UPDATE coffee.issued_rewards SET expires_at=1 WHERE member_id=$1",[other.id]);
  await a.client.get('/api/staff/members/'+other.id).expect(404);
  assert.equal((await db.query('SELECT rewards FROM coffee.members WHERE id=$1',[other.id])).rows[0].rewards,1);
  await a.client.post('/api/staff/accounts').send({username:'scoped-manager',fullName:'Manager',password:'pilot-manager-password'}).expect(201);
  await a.client.post('/api/staff/team/scoped-manager').send({role:'manager',enabled:true,locations:[a.shop+':main']}).expect(200);
  const login=(await request(app).post('/api/login').send({username:'scoped-manager',password:'pilot-manager-password'}).expect(200)).body;
  const manager=request.agent(app).set('Authorization','Bearer '+login.token);
  const member=(await db.query("SELECT coffee.enroll_customer('Own member',NULL,$1) AS m",[a.shop])).rows[0].m;
  assert.equal((await manager.get('/api/staff/members/'+member.id).expect(200)).body.privateCardToken,undefined);
  await manager.post('/api/staff/members/'+member.id+'/adjustment').set('Idempotency-Key',randomUUID()).send({delta:1,reason:'Correction audit check',confirm:true}).expect(200);
  const audit=(await db.query("SELECT actor,reason,location_id,stamp_delta,reward_delta FROM coffee.ledger WHERE member_id=$1 AND kind='adjustment'",[member.id])).rows[0];
  assert.deepEqual(audit,{actor:'scoped-manager',reason:'Correction audit check',location_id:a.shop+':main',stamp_delta:1,reward_delta:0});
  await manager.post('/api/staff/members/'+member.id+'/adjustment').set('Idempotency-Key',randomUUID()).send({delta:7,reason:'Cannot create a reward',confirm:true}).expect(409);
  assert.equal((await db.query('SELECT rewards FROM coffee.members WHERE id=$1',[member.id])).rows[0].rewards,0);

  await db.query('DELETE FROM coffee.location_grants WHERE username=$1',['scoped-manager']);
  await manager.get('/api/staff/members').expect(403);
  await manager.get('/api/staff/reports').expect(403);
  await manager.post('/api/staff/members/'+member.id+'/adjustment').set('Idempotency-Key',randomUUID()).send({delta:1,reason:'Valid reason',confirm:true}).expect(403);
  await assert.rejects(db.query('SELECT coffee.staff_adjust($1,$2,1,$3,$4,$5,$6)',[a.shop,member.id,'Valid reason',randomUUID(),'scoped-manager',a.shop+':main']),/Location access denied/);
 }finally{await db.end();}
});
test("DELETE recovery revokes bearer session; CSV neutralizes formulas and reconciles expiry",async()=>{
 const {db,app}=await fixture();try{
  const a=await owner(app,'csv-owner');const browser=request.agent(app);
  const login=(await browser.post('/api/login').send({username:'csv-owner',password:'pilot-hardening-password'}).expect(200)).body;
  await browser.delete('/api/staff/session').send({}).expect(200);
  await browser.get('/api/staff/me').set('Authorization','Bearer '+login.token).expect(401);
  const m=(await db.query("SELECT coffee.enroll_customer($1,NULL,$2) AS m",['  =FORMULA',a.shop])).rows[0].m;
  await db.query('UPDATE coffee.shops SET stamp_goal=2,reward_expiry_days=1 WHERE id=$1',[a.shop]);
  for(let i=0;i<2;i++)await db.query("SELECT coffee.mutate_member($1,'purchase',$2,'csv-owner')",[m.id,randomUUID()]);
  await db.query("UPDATE coffee.issued_rewards SET expires_at=1 WHERE member_id=$1",[m.id]);
  await db.query('UPDATE coffee.members SET name=$1 WHERE id=$2',['  =FORMULA',m.id]);
  const csv=(await a.client.get('/api/staff/customers.csv').expect(200)).text;
  assert.match(csv,/"'  =FORMULA"/);
  assert.equal((await db.query('SELECT rewards FROM coffee.members WHERE id=$1',[m.id])).rows[0].rewards,0);
 }finally{await db.end();}
});
test("invited merchant onboarding is opt-in, atomic and doesn't break existing merchants",async()=>{
 const {db,app}=await fixture();try{
  const a=await owner(app,'existing-owner');
  process.env.PILOT_ONBOARDING_MODE='invite';
  const credentials={username:'new-pilot',fullName:'Pilot',shopName:'Invited shop',password:'new-pilot-password'};
  await request(app).post('/api/setup/owner').send(credentials).expect(403);
  const token=randomBytes(32).toString('hex');
  await db.query('INSERT INTO coffee.merchant_invites(token_hash,expires,created_by) VALUES($1,$2,$3)',[digest(token),Date.now()+60000,'operator']);
  const results=await Promise.all(['one','two'].map(suffix=>request(app).post('/api/setup/owner').send({...credentials,username:'pilot-'+suffix,inviteToken:token})));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,403]);
  await a.client.get('/api/staff/me').expect(200);
  const expired=randomBytes(32).toString('hex');await db.query('INSERT INTO coffee.merchant_invites(token_hash,expires,created_by) VALUES($1,0,$2)',[digest(expired),'operator']);
  await request(app).post('/api/setup/owner').send({...credentials,inviteToken:expired}).expect(403);
 }finally{delete process.env.PILOT_ONBOARDING_MODE;await db.end();}
});
test("migrations preserve pool search_path and cloud readiness performs no initialization",async()=>{
 const db=await memDb();try{
  await assert.rejects(verifyHostedSchema(db),/migrations/);
  const c=await db.connect();try{const before=(await c.query('SHOW search_path')).rows[0].search_path;await installHosted(c);assert.equal((await c.query('SHOW search_path')).rows[0].search_path,before);}finally{c.release();}
  await verifyHostedSchema(db);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM coffee.members')).rows[0].n,0);
 }finally{await db.end();}
});
test("intentional alert drill is hidden in production and requires a staging secret",async()=>{
 const {db,app}=await fixture();const original={app:process.env.APP_ENV,vercel:process.env.VERCEL_ENV};
 try{
  const token=randomBytes(32).toString('hex');process.env.STAGING_ALERT_TEST_TOKEN=token;process.env.APP_ENV='staging';
  await request(app).get('/api/ops/alert-test').expect(404);
  const response=await request(app).get('/api/ops/alert-test').set('Authorization','Bearer '+token).expect(503);
  assert.match(response.headers['x-request-id'],/^[a-f0-9-]{36}$/);
  process.env.VERCEL_ENV='production';await request(app).get('/api/ops/alert-test').set('Authorization','Bearer '+token).expect(404);
 }finally{delete process.env.STAGING_ALERT_TEST_TOKEN;if(original.app)process.env.APP_ENV=original.app;else delete process.env.APP_ENV;if(original.vercel)process.env.VERCEL_ENV=original.vercel;else delete process.env.VERCEL_ENV;await db.end();}
});

test("the six-file upstream migration upgrades without changing representative balances, IDs or promised reward terms",async()=>{
 const db=await memDb();try{
  const {readFileSync}=await import('node:fs');const c=await db.connect();
  try{await c.query('BEGIN');for(const file of ['schema','shops','referrals','pilot','rewards','tenancy'])await c.query(readFileSync('supabase/'+file+'.sql','utf8'));await c.query('COMMIT');await c.query('RESET search_path');}finally{c.release();}
  await db.query("UPDATE coffee.shops SET stamp_goal=2,reward_label='Grandfathered coffee',reward_expiry_days=90 WHERE id='default'");
  const member=(await db.query("SELECT coffee.enroll_customer('Before upgrade',NULL,'default') AS m")).rows[0].m;
  for(let i=0;i<3;i++)await db.query("SELECT coffee.mutate_member($1,'purchase',$2,'migration-fixture')",[member.id,randomUUID()]);
  const before=(await db.query('SELECT * FROM coffee.members WHERE id=$1',[member.id])).rows[0];
  const vouchers=(await db.query('SELECT * FROM coffee.issued_rewards WHERE member_id=$1 ORDER BY id',[member.id])).rows;
  await initializeHosted(db);await verifyHostedSchema(db);
  assert.deepEqual((await db.query('SELECT * FROM coffee.members WHERE id=$1',[member.id])).rows[0],before);
  assert.deepEqual((await db.query('SELECT * FROM coffee.issued_rewards WHERE member_id=$1 ORDER BY id',[member.id])).rows,vouchers);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM coffee.ledger WHERE member_id=$1',[member.id])).rows[0].n,3);
 }finally{await db.end();}
});
