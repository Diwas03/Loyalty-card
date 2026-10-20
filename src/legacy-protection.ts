import type { HostedDB } from "./hosted-db.js";
/** Preserve old data while closing the Supabase browser-role access introduced by public-table migration. */
export async function protectLegacyTables(db: HostedDB) {
  await db.query(`DO $protect$
DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['scan_requests','members','operations','jobs','registrations','sessions','meta','staff_accounts','wallet_issuance','programme','programme_changes','customer_enrollments'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);END IF;
   END LOOP;
  END IF;
 END LOOP;
END $protect$;`);
}
