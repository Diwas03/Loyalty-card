import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import { requireLocalDatabase } from "./environment-safety.js";
const quote = (value: string) => '"'+value.replaceAll('"','""')+'"';
export type PilotBackup = { format: "loyalty-private-v1"; createdAt: string; tables: Record<string,Record<string,unknown>[]>; sequences: Record<string,{last_value:string;is_called:boolean}> };
function target(db: Pool, restore = false) {
 const url=requireLocalDatabase((db as Pool & {options:{connectionString?:string}}).options.connectionString,restore?"Private restore":"Private backup");
 if(restore&&!/^\/coffee_restore_[a-f0-9]+$/.test(url.pathname)) throw Error("Restore requires a fresh loopback coffee_restore_* database");
}
export async function backupPilot(db: Pool):Promise<PilotBackup> {
 target(db); const c=await db.connect();
 try {
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot:PilotBackup={format:"loyalty-private-v1",createdAt:new Date().toISOString(),tables:{},sequences:{}};
  const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='coffee' ORDER BY tablename")).rows;
  for(const {tablename} of tables) snapshot.tables[tablename]=(await c.query(`SELECT * FROM coffee.${quote(tablename)}`)).rows;
  for(const {sequencename} of (await c.query("SELECT sequencename FROM pg_sequences WHERE schemaname='coffee'")).rows)
   snapshot.sequences[sequencename]=(await c.query(`SELECT last_value::text,is_called FROM coffee.${quote(sequencename)}`)).rows[0];
  await c.query("COMMIT");return snapshot;
 } catch(error) {await c.query("ROLLBACK");throw error;} finally {c.release();}
}
/** Local-only recovery rehearsal. Never accepts production or an occupied database. */
export async function restorePilot(db:Pool,snapshot:PilotBackup) {
 target(db,true);
 if(snapshot.format!=="loyalty-private-v1"||!snapshot.tables||!snapshot.sequences)throw Error("Unsupported private backup format");
 const c=await db.connect();
 try {
  await c.query("BEGIN"); await c.query("SELECT pg_advisory_xact_lock(7342101)");
  if((await c.query("SELECT 1 FROM coffee.members UNION ALL SELECT 1 FROM coffee.staff_accounts LIMIT 1")).rowCount)throw Error("Restore target contains accounts or memberships; refusing to overwrite");
  const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='coffee' ORDER BY tablename")).rows.map(row=>String(row.tablename));
  if(JSON.stringify(tables)!==JSON.stringify(Object.keys(snapshot.tables).sort()))throw Error("Backup schema differs from the reviewed migration version");
  await c.query("LOCK TABLE "+tables.map(name=>'coffee.'+quote(name)).join(',')+" IN ACCESS EXCLUSIVE MODE");
  // Refuse configurations/audit/invitations as well as occupied member tables.
  // A restore target may contain only the migration's untouched bootstrap rows.
  const bootstrap:Record<string,Record<string,unknown>[]> = {
    programme:[{id:1,stamp_goal:8}],
    shops:[{id:"default",name:"Demo Coffee Shop",color:"#41291d",stamp_goal:8,
      card_title:"Member card",tagline:"A little more rewarding.",reward_label:"Free coffee",
      stamp_icon:"check",card_style:"classic",logo_data:"",referrals_enabled:true,
      referral_reward_kind:"stamps",referral_reward_amount:1,currency:"BTN",timezone:"Asia/Thimphu",
      country:"BT",reward_expiry_days:null,shop_address:"",shop_maps_url:""}],
    locations:[{id:"default:main",shop_id:"default",name:"Main location",active:true}],
    pilot_readiness_versions:[{version:"20261102"}],
  };
  for (const table of tables) {
    if (table in bootstrap) {
      const projection=table==='pilot_readiness_versions'?"jsonb_build_object('version',t.version)":"to_jsonb(t)";
      const rows=(await c.query(`SELECT ${projection} AS record FROM coffee.${quote(table)} t`)).rows.map(row=>row.record);
      if (!isDeepStrictEqual(rows,bootstrap[table])) throw Error("Restore target is not a pristine migrated database");
    } else if ((await c.query(`SELECT 1 FROM coffee.${quote(table)} LIMIT 1`)).rowCount) {
      throw Error("Restore target contains application data; refusing to overwrite");
    }
  }
  const versions=(snapshot.tables.pilot_readiness_versions||[]).map(row=>row.version).sort();
  if (!isDeepStrictEqual(versions,["20261102"])) throw Error("Backup migration version differs from this application");
  // Superuser-only local rehearsal: avoid replaying audit/voucher/referral triggers.
  // Check/unique constraints remain enforced; all FKs are explicitly checked below.
  await c.query("SET LOCAL session_replication_role=replica");
  await c.query("TRUNCATE "+tables.map(name=>'coffee.'+quote(name)).join(',')+" RESTART IDENTITY");
  for(const table of tables) {
   const columns=(await c.query("SELECT column_name,udt_name FROM information_schema.columns WHERE table_schema='coffee' AND table_name=$1 ORDER BY ordinal_position",[table])).rows;
   const names=columns.map(col=>String(col.column_name));
   for(const row of snapshot.tables[table]) {
    if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify([...names].sort()))throw Error("Backup columns differ from the reviewed migration version");
    const values=columns.map(col=>['json','jsonb'].includes(col.udt_name)&&row[col.column_name]!==null?JSON.stringify(row[col.column_name]):row[col.column_name]);
    await c.query(`INSERT INTO coffee.${quote(table)} (${names.map(quote).join(',')}) VALUES(${names.map((_,i)=>'$'+(i+1)).join(',')})`,values);
   }
  }
  const constraints=(await c.query(`SELECT c.conname,c.conrelid::regclass::text AS source,c.confrelid::regclass::text AS destination,
   ARRAY(SELECT attname FROM unnest(c.conkey) WITH ORDINALITY k(n,i) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.i)::text[] AS source_columns,
   ARRAY(SELECT attname FROM unnest(c.confkey) WITH ORDINALITY k(n,i) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.i)::text[] AS destination_columns
   FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='coffee' AND c.contype='f'`)).rows;
  for(const fk of constraints) {
   const source=fk.source_columns as string[],destination=fk.destination_columns as string[];
   const sql=`SELECT 1 FROM ${fk.source} a WHERE ${source.map(k=>'a.'+quote(k)+' IS NOT NULL').join(' AND ')} AND NOT EXISTS(SELECT 1 FROM ${fk.destination} b WHERE ${source.map((k,i)=>'a.'+quote(k)+'=b.'+quote(destination[i])).join(' AND ')}) LIMIT 1`;
   if((await c.query(sql)).rowCount)throw Error("Backup contains invalid foreign key relationships");
  }
  for(const {sequencename} of (await c.query("SELECT sequencename FROM pg_sequences WHERE schemaname='coffee'")).rows) {
   const value=snapshot.sequences[sequencename];if(!value||!/^\d+$/.test(value.last_value))throw Error("Backup sequence state missing");
   await c.query("SELECT setval($1::regclass,$2::bigint,$3)",['coffee.'+quote(sequencename),value.last_value,value.is_called]);
  }
  await c.query("SET LOCAL session_replication_role=origin");
  await c.query("DELETE FROM coffee.sessions");
  await c.query("DELETE FROM coffee.card_transfers");
  await c.query("DELETE FROM coffee.team_invites");
  await c.query("DELETE FROM coffee.merchant_invites");
  await c.query("DELETE FROM coffee.request_limits");
  await c.query("UPDATE coffee.jobs SET status='blocked',error='Restore quarantine: review external delivery before enabling' WHERE status<>'delivered'");
  await c.query("COMMIT");
  return {tables:tables.length,members:snapshot.tables.members.length,sessionsRevoked:true,deliveryQuarantined:true};
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
