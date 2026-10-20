CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET search_path = coffee, public, extensions;
-- Run in the Supabase SQL editor. Private server-only schema; never expose it through the Data API.
CREATE SCHEMA IF NOT EXISTS coffee;
REVOKE ALL ON SCHEMA coffee FROM PUBLIC;
CREATE SEQUENCE IF NOT EXISTS coffee.revision;
CREATE TABLE IF NOT EXISTS coffee.programme(id int PRIMARY KEY CHECK(id=1),stamp_goal int NOT NULL CHECK(stamp_goal BETWEEN 2 AND 100));
INSERT INTO coffee.programme VALUES(1,8) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS coffee.members(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),stamps int NOT NULL DEFAULT 0 CHECK(stamps>=0),rewards int NOT NULL DEFAULT 0 CHECK(rewards>=0),version bigint NOT NULL DEFAULT nextval('coffee.revision'),apple_token text NOT NULL DEFAULT encode(gen_random_bytes(32),'hex'));
CREATE TABLE IF NOT EXISTS coffee.staff_accounts(username text PRIMARY KEY,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('staff','owner')),enabled boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS coffee.staff_profiles(username text PRIMARY KEY REFERENCES coffee.staff_accounts(username) ON DELETE CASCADE,full_name text NOT NULL CHECK(length(full_name) BETWEEN 1 AND 80));
CREATE OR REPLACE FUNCTION coffee.register_staff(p_username text,p_hash text,p_name text,p_first boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF p_first AND EXISTS(SELECT 1 FROM coffee.staff_accounts) THEN RAISE EXCEPTION 'Owner setup is already complete' USING ERRCODE='23505';END IF;
 IF p_username !~ '^[a-z0-9._-]{3,40}$' OR p_username='legacy' OR p_hash !~ '^[^:]+:[a-f0-9]{64}$' OR length(trim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Invalid account details';END IF;
 INSERT INTO coffee.staff_accounts(username,password_hash,role,enabled) VALUES(p_username,p_hash,CASE WHEN p_first THEN 'owner' ELSE 'staff' END,true);
 INSERT INTO coffee.staff_profiles VALUES(p_username,trim(p_name));
 RETURN jsonb_build_object('username',p_username,'fullName',trim(p_name),'role',CASE WHEN p_first THEN 'owner' ELSE 'staff' END);
END $$;
CREATE TABLE IF NOT EXISTS coffee.sessions(token_hash text PRIMARY KEY,username text NOT NULL,expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS coffee.operations(key text PRIMARY KEY,member_id text NOT NULL REFERENCES coffee.members(id),kind text NOT NULL,result jsonb NOT NULL,actor text NOT NULL,created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS coffee.jobs(id bigserial PRIMARY KEY,member_id text NOT NULL REFERENCES coffee.members(id),provider text NOT NULL DEFAULT 'google',version bigint NOT NULL,status text NOT NULL DEFAULT 'pending',attempts int NOT NULL DEFAULT 0,next_at bigint NOT NULL DEFAULT 0,error text,UNIQUE(member_id,provider,version));
CREATE INDEX IF NOT EXISTS coffee_jobs_ready ON coffee.jobs(status,next_at);
CREATE TABLE IF NOT EXISTS coffee.customer_enrollments(token_hash text PRIMARY KEY,member_id text NOT NULL REFERENCES coffee.members(id),created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS coffee.wallet_issuance(member_id text PRIMARY KEY REFERENCES coffee.members(id),created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS coffee.programme_changes(id bigserial PRIMARY KEY,actor text NOT NULL,old_goal int NOT NULL,new_goal int NOT NULL,created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS coffee.request_limits(key text PRIMARY KEY,window_id bigint NOT NULL,count int NOT NULL);
CREATE OR REPLACE FUNCTION coffee.enroll_customer(p_name text,p_token text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m coffee.members; BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF p_token IS NOT NULL THEN SELECT members.* INTO m FROM coffee.members JOIN coffee.customer_enrollments e ON e.member_id=members.id WHERE e.token_hash=p_token; IF FOUND THEN RETURN to_jsonb(m); END IF; END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Customer name must contain 1–80 characters'; END IF;
 INSERT INTO coffee.members(name) VALUES(trim(p_name)) RETURNING * INTO m;
 IF p_token IS NOT NULL THEN INSERT INTO coffee.customer_enrollments VALUES(p_token,m.id,(extract(epoch FROM clock_timestamp())*1000)::bigint);END IF;
 RETURN to_jsonb(m);END $$;
CREATE OR REPLACE FUNCTION coffee.mutate_member(p_id text,p_kind text,p_key text,p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m coffee.members; op coffee.operations; goal int; result jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 SELECT * INTO op FROM coffee.operations WHERE key=p_key;
 IF FOUND THEN IF op.member_id<>p_id OR op.kind<>p_kind THEN RAISE EXCEPTION 'Idempotency key already used for another action'; END IF;RETURN op.result;END IF;
 IF p_kind NOT IN ('purchase','redeem') THEN RAISE EXCEPTION 'Unsupported loyalty action';END IF;
 SELECT * INTO m FROM coffee.members WHERE id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found';END IF;
 SELECT stamp_goal INTO goal FROM coffee.programme WHERE id=1;
 IF p_kind='redeem' AND m.rewards<1 THEN RAISE EXCEPTION 'No reward available';END IF;
 UPDATE coffee.members SET stamps=CASE WHEN p_kind='purchase' THEN (m.stamps+1)%goal ELSE m.stamps END,rewards=CASE WHEN p_kind='purchase' THEN m.rewards+CASE WHEN m.stamps=goal-1 THEN 1 ELSE 0 END ELSE m.rewards-1 END,version=nextval('coffee.revision') WHERE id=p_id RETURNING * INTO m;
 INSERT INTO coffee.jobs(member_id,version) VALUES(m.id,m.version);
 result=jsonb_build_object('id',m.id,'stamps',m.stamps,'rewards',m.rewards,'version',m.version,'stampGoal',goal);
 INSERT INTO coffee.operations VALUES(p_key,p_id,p_kind,result,p_actor,(extract(epoch FROM clock_timestamp())*1000)::bigint);RETURN result;END $$;
CREATE OR REPLACE FUNCTION coffee.change_goal(p_goal int,p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE old_goal int; rev bigint; BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF p_goal NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Choose a whole number between 2 and 100';END IF;
 IF EXISTS(SELECT 1 FROM coffee.members WHERE stamps>=p_goal) THEN RAISE EXCEPTION 'Cannot lower the goal below current customer progress';END IF;
 SELECT stamp_goal INTO old_goal FROM coffee.programme WHERE id=1;
 IF old_goal<>p_goal THEN UPDATE coffee.programme SET stamp_goal=p_goal WHERE id=1;
 INSERT INTO coffee.programme_changes(actor,old_goal,new_goal,created_at) VALUES(p_actor,old_goal,p_goal,(extract(epoch FROM clock_timestamp())*1000)::bigint);
 rev=nextval('coffee.revision');UPDATE coffee.members SET version=rev;
 INSERT INTO coffee.jobs(member_id,version) SELECT id,rev FROM coffee.members;END IF;
 RETURN jsonb_build_object('stampGoal',p_goal);END $$;
CREATE OR REPLACE FUNCTION coffee.claim_job(p_member text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j coffee.jobs; now_ms bigint=(extract(epoch FROM clock_timestamp())*1000)::bigint;BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 SELECT * INTO j FROM coffee.jobs candidate WHERE candidate.status IN ('pending','retry','blocked','working') AND candidate.next_at<=now_ms AND (p_member IS NULL OR candidate.member_id=p_member) AND NOT EXISTS(SELECT 1 FROM coffee.jobs active WHERE active.member_id=candidate.member_id AND active.status='working' AND active.next_at>now_ms) ORDER BY id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE coffee.jobs SET status='working',next_at=now_ms+120000 WHERE id=j.id;RETURN to_jsonb(j);END $$;
CREATE OR REPLACE FUNCTION coffee.allow_request(p_key text,p_limit int,p_window_ms bigint) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE now_window_id bigint=floor((extract(epoch FROM clock_timestamp())*1000)/p_window_ms);n int;BEGIN
 INSERT INTO coffee.request_limits VALUES(p_key,now_window_id,1) ON CONFLICT(key) DO UPDATE SET window_id=excluded.window_id,count=CASE WHEN coffee.request_limits.window_id=excluded.window_id THEN coffee.request_limits.count+1 ELSE 1 END RETURNING count INTO n;RETURN n<=p_limit;END $$;
DO $$ DECLARE t record;BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='coffee' LOOP EXECUTE format('ALTER TABLE coffee.%I ENABLE ROW LEVEL SECURITY',t.tablename);END LOOP;END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA coffee FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA coffee FROM PUBLIC;

RESET search_path;
