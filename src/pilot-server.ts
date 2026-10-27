import "dotenv/config";
import { Pool } from "pg";
import { initializeHosted } from "./hosted-runtime.js";
import { createHostedApp } from "./hosted-app.js";

// Run the same application as Vercel against an explicitly isolated local DB.
const url=new URL(process.env.DEV_DATABASE_URL || "http://invalid");
if (!["postgres:","postgresql:"].includes(url.protocol) || !["127.0.0.1","localhost"].includes(url.hostname) || url.pathname!=="/coffee_dev")
  throw Error("Set DEV_DATABASE_URL to a loopback coffee_dev database. The local pilot never uses DATABASE_URL.");
delete process.env.PUBLIC_BASE_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
delete process.env.VERCEL;
delete process.env.GOOGLE_ISSUER_ID;
process.env.APPLE_WALLET_ENABLED="false";
const db=new Pool({connectionString:url.toString(),ssl:false});
try { await initializeHosted(db); } catch(error) { await db.end(); throw error; }
const app=createHostedApp(db,promise=>void promise.catch(()=>console.error("Local pilot background job failed; inspect durable delivery status.")));
const server=app.listen(Number(process.env.PORT || 3000),"127.0.0.1",()=>console.log("Local multi-shop pilot: http://127.0.0.1:"+(process.env.PORT || 3000)+"/business/ (external wallet delivery disabled)"));
for(const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,()=>server.close(async()=>{await db.end();}));
