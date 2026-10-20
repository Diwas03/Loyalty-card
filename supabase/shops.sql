-- Additive multi-shop migration. Existing identities and balances belong to the default shop.
CREATE TABLE IF NOT EXISTS coffee.shops(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),color text NOT NULL DEFAULT '#41291d' CHECK(color ~ '^#[a-fA-F0-9]{6}$'),stamp_goal int NOT NULL DEFAULT 8 CHECK(stamp_goal BETWEEN 2 AND 100));
INSERT INTO coffee.shops(id,name,stamp_goal) SELECT 'default','Demo Coffee Shop',stamp_goal FROM coffee.programme WHERE id=1 ON CONFLICT(id) DO NOTHING;
ALTER TABLE coffee.members ADD COLUMN IF NOT EXISTS shop_id text NOT NULL DEFAULT 'default' REFERENCES coffee.shops(id);
ALTER TABLE coffee.staff_profiles ADD COLUMN IF NOT EXISTS shop_id text NOT NULL DEFAULT 'default' REFERENCES coffee.shops(id);
ALTER TABLE coffee.programme_changes ADD COLUMN IF NOT EXISTS shop_id text NOT NULL DEFAULT 'default' REFERENCES coffee.shops(id);
CREATE INDEX IF NOT EXISTS coffee_members_shop ON coffee.members(shop_id);
CREATE INDEX IF NOT EXISTS coffee_staff_shop ON coffee.staff_profiles(shop_id);
CREATE OR REPLACE FUNCTION coffee.register_shop(p_username text,p_hash text,p_name text,p_shop_name text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE shop text;BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF length(trim(p_shop_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Invalid shop name';END IF;
 IF NOT EXISTS(SELECT 1 FROM coffee.staff_accounts) THEN
  shop='default';UPDATE coffee.shops SET name=trim(p_shop_name) WHERE id=shop;
 ELSE INSERT INTO coffee.shops(name) VALUES(trim(p_shop_name)) RETURNING id INTO shop;END IF;
 INSERT INTO coffee.staff_accounts(username,password_hash,role,enabled) VALUES(p_username,p_hash,'owner',true);
 INSERT INTO coffee.staff_profiles(username,full_name,shop_id) VALUES(p_username,trim(p_name),shop);
 RETURN jsonb_build_object('username',p_username,'fullName',trim(p_name),'role','owner','shopId',shop);
END $$;
CREATE OR REPLACE FUNCTION coffee.register_shop_staff(p_username text,p_hash text,p_name text,p_shop text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 INSERT INTO coffee.staff_accounts(username,password_hash,role,enabled) VALUES(p_username,p_hash,'staff',true);
 INSERT INTO coffee.staff_profiles(username,full_name,shop_id) VALUES(p_username,trim(p_name),p_shop);
 RETURN jsonb_build_object('username',p_username,'fullName',trim(p_name),'role','staff','shopId',p_shop);
END $$;
CREATE OR REPLACE FUNCTION coffee.enroll_customer(p_name text,p_token text,p_shop text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m coffee.members;BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF NOT EXISTS(SELECT 1 FROM coffee.shops WHERE id=p_shop) THEN RAISE EXCEPTION 'Shop not found';END IF;
 IF p_token IS NOT NULL THEN
  SELECT members.* INTO m FROM coffee.members JOIN coffee.customer_enrollments e ON e.member_id=members.id WHERE e.token_hash=p_token AND members.shop_id=p_shop;
  IF FOUND THEN RETURN to_jsonb(m);END IF;
 END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Customer name must contain 1–80 characters';END IF;
 INSERT INTO coffee.members(name,shop_id) VALUES(trim(p_name),p_shop) RETURNING * INTO m;
 IF p_token IS NOT NULL THEN INSERT INTO coffee.customer_enrollments VALUES(p_token,m.id,(extract(epoch FROM clock_timestamp())*1000)::bigint);END IF;
 RETURN to_jsonb(m);
END $$;
CREATE OR REPLACE FUNCTION coffee.change_shop_goal(p_shop text,p_goal int,p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE old_goal int;rev bigint;BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF p_goal NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Choose a whole number between 2 and 100';END IF;
 IF EXISTS(SELECT 1 FROM coffee.members WHERE shop_id=p_shop AND stamps>=p_goal) THEN RAISE EXCEPTION 'Cannot lower the goal below current customer progress';END IF;
 SELECT stamp_goal INTO old_goal FROM coffee.shops WHERE id=p_shop FOR UPDATE;
 IF old_goal IS NULL THEN RAISE EXCEPTION 'Shop not found';END IF;
 IF old_goal<>p_goal THEN
  UPDATE coffee.shops SET stamp_goal=p_goal WHERE id=p_shop;
  IF p_shop='default' THEN UPDATE coffee.programme SET stamp_goal=p_goal WHERE id=1;END IF;
  INSERT INTO coffee.programme_changes(actor,old_goal,new_goal,created_at,shop_id) VALUES(p_actor,old_goal,p_goal,(extract(epoch FROM clock_timestamp())*1000)::bigint,p_shop);
  rev=nextval('coffee.revision');UPDATE coffee.members SET version=rev WHERE shop_id=p_shop;
  INSERT INTO coffee.jobs(member_id,version) SELECT id,rev FROM coffee.members WHERE shop_id=p_shop;
 END IF;
 RETURN jsonb_build_object('stampGoal',p_goal);
END $$;
CREATE OR REPLACE FUNCTION coffee.change_goal(p_goal int,p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN RETURN coffee.change_shop_goal('default',p_goal,p_actor);END $$;
ALTER TABLE coffee.shops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA coffee FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA coffee FROM PUBLIC;
