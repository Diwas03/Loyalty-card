import "dotenv/config";
import { Pool } from "pg";
import { initializeHosted } from "../src/hosted-runtime.js";
import { passwordHash } from "../src/auth.js";

// An explicit, separate loopback database only. Never falls back to DATABASE_URL.
const url = new URL(process.env.DEV_DATABASE_URL || "http://invalid");
if (!["postgres:","postgresql:"].includes(url.protocol) || !["127.0.0.1","localhost"].includes(url.hostname) || url.pathname !== "/coffee_dev")
  throw Error("Set DEV_DATABASE_URL to a disposable loopback /coffee_dev database. Production URLs are refused.");
const password = process.env.DEV_SEED_PASSWORD || "";
const hash = passwordHash(password);
const db = new Pool({ connectionString:url.toString(),ssl:false });
try {
  await initializeHosted(db);
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7342101)");
    if ((await client.query("SELECT 1 FROM coffee.staff_accounts WHERE username NOT IN ('seed-cafe-owner','seed-salon-owner') UNION ALL SELECT 1 FROM coffee.members WHERE id NOT IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222') LIMIT 1")).rowCount)
      throw Error("Database contains non-seed accounts/members; refusing to change it.");
    for(const [id,name,member] of [["seed-cafe","Thimphu Cafe","11111111-1111-4111-8111-111111111111"],["seed-salon","Paro Salon","22222222-2222-4222-8222-222222222222"]]) {
      const username=id+"-owner";
      await client.query("INSERT INTO coffee.shops(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,name]);
      const reset=process.env.DEV_SEED_RESET_PASSWORDS==="true";
      await client.query("INSERT INTO coffee.staff_accounts VALUES($1,$2,'owner',true) ON CONFLICT(username) DO UPDATE SET password_hash=CASE WHEN $3::boolean THEN EXCLUDED.password_hash ELSE staff_accounts.password_hash END",[username,hash,reset]);
      if(reset) await client.query("DELETE FROM coffee.sessions WHERE username=$1",[username]);
      await client.query("INSERT INTO coffee.staff_profiles(username,full_name,shop_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[username,name+" Owner",id]);
      await client.query("INSERT INTO coffee.members(id,name,shop_id) VALUES($1,'Development customer',$2) ON CONFLICT DO NOTHING",[member,id]);
      await client.query("SELECT coffee.mutate_member($1,'purchase',$2,$3)",[member,"seed-purchase-"+id,username]);
    }
    await client.query("COMMIT");
    console.log("Two isolated development businesses seeded. Owners: seed-cafe-owner, seed-salon-owner. " + (process.env.DEV_SEED_RESET_PASSWORDS==="true" ? "Development passwords reset and sessions revoked. " : "Existing seed credentials retained. ") + "No production data used.");
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
} finally { await db.end(); }
