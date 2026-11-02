import "dotenv/config";
import {randomBytes} from "node:crypto";
import {mkdirSync,writeFileSync} from "node:fs";
import {requireLocalOperator} from "../src/environment-safety.js";
import {hostedPool,digest} from "../src/hosted-db.js";
requireLocalOperator("Pilot invitation creation");
const db=hostedPool();
try{
 const token=randomBytes(32).toString("hex");
 await db.query("INSERT INTO coffee.merchant_invites(token_hash,expires,created_by) VALUES($1,$2,'local-operator')",[digest(token),Date.now()+48*3600000]);
 mkdirSync('data/invites',{recursive:true,mode:0o700});
 writeFileSync('data/invites/merchant-'+Date.now()+'.txt','/business/register.html#invite='+token+'\n',{mode:0o600,flag:'wx'});
 console.log("Local merchant invitation saved under ignored data/invites with owner-only permissions; valid for 48 hours. No token was logged.");
}catch{console.error("Could not create isolated merchant invitation.");process.exitCode=1;}finally{await db.end();}
