import "dotenv/config";
import { Pool } from "pg";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import {dirname,resolve} from "node:path";
import {requireLocalDatabase} from "../src/environment-safety.js";
import {backupPilot,restorePilot} from "../src/pilot-backup.js";
import {initializeHosted} from "../src/hosted-runtime.js";
const mode=process.argv[2];
const url=requireLocalDatabase(process.env.PILOT_BACKUP_DATABASE_URL,"Private backup/restore");
const db=new Pool({connectionString:url.toString(),ssl:false});
try {
 const file=resolve(process.argv[3]||"data/backups/pilot-local.json");
 if(mode==="backup") {
  const backup=await backupPilot(db);mkdirSync(dirname(file),{recursive:true,mode:0o700});
  writeFileSync(file,JSON.stringify(backup),{mode:0o600,flag:"wx"});
  console.log("Synthetic/local private-schema backup written with owner-only permissions.");
 }else if(mode==="restore") {
  if(!/^\/coffee_restore_[a-f0-9]+$/.test(url.pathname))throw Error("Restore requires a disposable restore database");
  if ((await db.query("SELECT to_regnamespace('coffee') IS NOT NULL AS present")).rows[0].present) throw Error("CLI restore requires a new database without an application schema");
  await initializeHosted(db);
  console.log(JSON.stringify(await restorePilot(db,JSON.parse(readFileSync(file,"utf8")))));
 }else throw Error("Use backup or restore");
}catch{console.error("Private backup/restore refused or failed. Check the isolated target, schema version and file; no data contents were logged.");process.exitCode=1;}finally{await db.end();}
