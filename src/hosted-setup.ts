import { protectLegacyTables } from "./legacy-protection.js";
import { readFileSync } from "node:fs";
import type { HostedDB } from "./hosted-db.js";
export async function installHosted(db: HostedDB) {
  await db.query(readFileSync("supabase/schema.sql", "utf8"));
  await db.query(readFileSync("supabase/shops.sql", "utf8"));
  await protectLegacyTables(db);
}
export async function hostedStatus(db: HostedDB) {
  const [
    { rows: members },
    { rows: staff },
    { rows: legacy },
    { rows: extensions },
  ] = await Promise.all([
    db.query("SELECT count(*) AS n FROM coffee.members"),
    db.query(
      "SELECT count(*) AS n FROM coffee.staff_accounts WHERE role='owner' AND enabled=true",
    ),
    db.query("SELECT to_regclass('public.members') IS NOT NULL AS present"),
    db.query(
      "SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net','supabase_vault')",
    ),
  ]);
  return {
    members: Number(members[0].n),
    owners: Number(staff[0].n),
    legacyPublicTables: !!legacy[0].present,
    extensions: extensions.map((r) => r.extname),
  };
}
export async function importLegacyPublic(db: HostedDB) {
  // Run through a dedicated pg client in a single transaction; callers must hold the two migration locks.
  const source = (
    await db.query(
      "SELECT to_regclass('public.members') IS NOT NULL AS present",
    )
  ).rows[0].present;
  if (!source)
    return { imported: false, reason: "No legacy public members table" };
  const sourceCount = Number(
    (await db.query("SELECT count(*) AS n FROM public.members")).rows[0].n,
  );
  const targetCount = Number(
    (await db.query("SELECT count(*) AS n FROM coffee.members")).rows[0].n,
  );
  if (!sourceCount)
    return { imported: false, reason: "Legacy source is empty" };
  if (targetCount)
    throw Error(
      "Both public and coffee contain memberships. Refusing to overwrite or guess which balance is authoritative.",
    );
  await db.query(
    "INSERT INTO coffee.members(id,name,stamps,rewards,version,apple_token) SELECT id,name,stamps,rewards,version,apple_token FROM public.members",
  );
  const has = async (table: string) =>
    (
      await db.query("SELECT to_regclass($1) IS NOT NULL AS present", [
        "public." + table,
      ])
    ).rows[0].present;
  if (await has("operations"))
    await db.query(
      "INSERT INTO coffee.operations(key,member_id,kind,result,actor,created_at) SELECT key,member_id,kind,result::jsonb,coalesce(actor,'legacy'),coalesce(created_at,0) FROM public.operations",
    );
  if (await has("staff_accounts"))
    await db.query(
      "INSERT INTO coffee.staff_accounts(username,password_hash,role,enabled) SELECT username,password_hash,role,enabled::text IN ('1','true') FROM public.staff_accounts ON CONFLICT(username) DO NOTHING",
    );
  if (await has("customer_enrollments"))
    await db.query(
      "INSERT INTO coffee.customer_enrollments SELECT token_hash,member_id,created_at FROM public.customer_enrollments",
    );
  if (await has("programme"))
    await db.query(
      "UPDATE coffee.programme SET stamp_goal=(SELECT stamp_goal FROM public.programme WHERE id=1) WHERE id=1",
    );
  await db.query("UPDATE coffee.shops SET stamp_goal=(SELECT stamp_goal FROM coffee.programme WHERE id=1) WHERE id='default'");
  await db.query(
    "SELECT setval('coffee.revision',GREATEST(COALESCE((SELECT max(version) FROM coffee.members),1),1),true)",
  );
  await db.query(
    "INSERT INTO coffee.jobs(member_id,version) SELECT id,version FROM coffee.members",
  );
  return { imported: true, count: sourceCount };
}
export async function configureHostedCron(
  db: HostedDB,
  origin: string,
  secret: string,
) {
  const u = new URL(origin);
  if (u.protocol !== "https:" || u.origin !== origin)
    throw Error("Use an HTTPS origin without a path or trailing slash");
  if (secret.length < 32)
    throw Error("CRON_SECRET must contain at least 32 characters");
  await db.query("CREATE EXTENSION IF NOT EXISTS pg_cron");
  await db.query(
    "CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions",
  );
  for (const [name, value] of [
    ["coffee_app_url", origin],
    ["coffee_cron_secret", secret],
  ]) {
    const existing = (
      await db.query("SELECT id FROM vault.secrets WHERE name=$1", [name])
    ).rows;
    if (existing.length > 1)
      throw Error("Duplicate Vault names require review before scheduling");
    if (existing.length)
      await db.query("SELECT vault.update_secret($1::uuid,$2)", [
        existing[0].id,
        value,
      ]);
    else await db.query("SELECT vault.create_secret($1,$2)", [value, name]);
  }
  await db.query(
    "SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='coffee-wallet-updates'",
  );
  const command = `SELECT net.http_post(url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='coffee_app_url')||'/api/cron/wallet-updates',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='coffee_cron_secret')),body:='{}'::jsonb,timeout_milliseconds:=55000)`;
  await db.query("SELECT cron.schedule($1,$2,$3)", [
    "coffee-wallet-updates",
    "* * * * *",
    command,
  ]);
  return { scheduled: true };
}
