-- Additive pilot migration. Existing balances and private membership IDs are retained.
ALTER TABLE coffee.shops ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BTN' CHECK(currency ~ '^[A-Z]{3}$');
ALTER TABLE coffee.shops ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Thimphu';
ALTER TABLE coffee.shops ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'BT' CHECK(country ~ '^[A-Z]{2}$');
ALTER TABLE coffee.members ADD COLUMN IF NOT EXISTS card_token text;
UPDATE coffee.members SET card_token=id WHERE card_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS coffee_card_token ON coffee.members(card_token);
CREATE TABLE IF NOT EXISTS coffee.card_transfers(member_id text PRIMARY KEY REFERENCES coffee.members(id),token_hash text UNIQUE NOT NULL,expires bigint NOT NULL);
ALTER TABLE coffee.card_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coffee.card_transfers FROM PUBLIC;
-- Future enrollments retain the historical ID-link until deliberately rotated.
CREATE OR REPLACE FUNCTION coffee.default_card_token() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.card_token IS NULL THEN NEW.card_token=NEW.id;END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS coffee_card_token_default ON coffee.members;
CREATE TRIGGER coffee_card_token_default BEFORE INSERT ON coffee.members FOR EACH ROW EXECUTE FUNCTION coffee.default_card_token();
CREATE TABLE IF NOT EXISTS coffee.ledger (
 id bigserial PRIMARY KEY, shop_id text NOT NULL REFERENCES coffee.shops(id),
 member_id text NOT NULL REFERENCES coffee.members(id), operation_key text NOT NULL UNIQUE,
 kind text NOT NULL, stamp_delta int NOT NULL, reward_delta int NOT NULL,
 stamps_after int NOT NULL, rewards_after int NOT NULL, rule_goal int NOT NULL,
 actor text NOT NULL, reason text NOT NULL DEFAULT '', created_at bigint NOT NULL
);
ALTER TABLE coffee.ledger ADD COLUMN IF NOT EXISTS location_id text;
-- Opening balances are explicitly migration snapshots, never fabricated historical sales.
INSERT INTO coffee.ledger(shop_id,member_id,operation_key,kind,stamp_delta,reward_delta,stamps_after,rewards_after,rule_goal,actor,created_at)
 SELECT m.shop_id,m.id,'opening:'||m.id,'opening',m.stamps,m.rewards,m.stamps,m.rewards,s.stamp_goal,'migration',(extract(epoch FROM clock_timestamp())*1000)::bigint
 FROM coffee.members m JOIN coffee.shops s ON s.id=m.shop_id
 WHERE NOT EXISTS(SELECT 1 FROM coffee.ledger l WHERE l.member_id=m.id);
CREATE OR REPLACE FUNCTION coffee.append_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m coffee.members; previous coffee.ledger; target int; BEGIN
 IF current_setting('coffee.importing',true)='on' THEN RETURN NEW;END IF;
 SELECT * INTO m FROM coffee.members WHERE id=NEW.member_id;
 SELECT * INTO previous FROM coffee.ledger WHERE member_id=m.id ORDER BY id DESC LIMIT 1;
 SELECT stamp_goal INTO target FROM coffee.shops WHERE id=m.shop_id;
 INSERT INTO coffee.ledger(shop_id,member_id,operation_key,kind,stamp_delta,reward_delta,stamps_after,rewards_after,rule_goal,actor,reason,created_at,location_id)
 VALUES(m.shop_id,m.id,NEW.key,NEW.kind,(NEW.result->>'stamps')::int-coalesce(previous.stamps_after,0),(NEW.result->>'rewards')::int-coalesce(previous.rewards_after,0),
 (NEW.result->>'stamps')::int,(NEW.result->>'rewards')::int,target,NEW.actor,coalesce(NEW.result->>'reason',''),NEW.created_at,nullif(current_setting('coffee.location',true),''));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coffee_ledger_operation ON coffee.operations;
CREATE TRIGGER coffee_ledger_operation AFTER INSERT ON coffee.operations FOR EACH ROW EXECUTE FUNCTION coffee.append_ledger();
CREATE OR REPLACE FUNCTION coffee.immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Ledger entries are immutable; create a compensating adjustment'; END $$;
DROP TRIGGER IF EXISTS coffee_ledger_immutable ON coffee.ledger;
CREATE TRIGGER coffee_ledger_immutable BEFORE UPDATE OR DELETE ON coffee.ledger FOR EACH ROW EXECUTE FUNCTION coffee.immutable_ledger();
CREATE OR REPLACE FUNCTION coffee.adjust_progress(p_shop text,p_id text,p_delta int,p_reason text,p_key text,p_actor text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m coffee.members; op coffee.operations; target int; result jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF NOT EXISTS(SELECT 1 FROM coffee.staff_accounts a JOIN coffee.business_memberships b USING(username) WHERE a.username=p_actor AND b.role IN ('owner','manager') AND a.enabled AND b.enabled AND b.shop_id=p_shop) THEN RAISE EXCEPTION 'Owner or manager access required';END IF;
 SELECT * INTO m FROM coffee.members WHERE id=p_id AND shop_id=p_shop FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found';END IF;
 SELECT * INTO op FROM coffee.operations WHERE key=p_key;
 IF FOUND THEN
  IF op.member_id<>p_id OR op.kind<>'adjustment' OR op.result->>'reason'<>trim(p_reason) OR (op.result->>'delta')::int<>p_delta THEN RAISE EXCEPTION 'Idempotency key already used for another action';END IF;
  RETURN op.result;
 END IF;
 SELECT stamp_goal INTO target FROM coffee.shops WHERE id=p_shop;
 IF p_delta=0 OR abs(p_delta)>100 OR length(trim(p_reason)) NOT BETWEEN 3 AND 240 OR m.stamps+p_delta<0 OR m.stamps+p_delta>=target THEN
  RAISE EXCEPTION 'Adjustment must keep progress between zero and the target minus one; provide a reason';END IF;
 UPDATE coffee.members SET stamps=stamps+p_delta,version=nextval('coffee.revision') WHERE id=p_id RETURNING * INTO m;
 result=jsonb_build_object('id',m.id,'stamps',m.stamps,'rewards',m.rewards,'version',m.version,'stampGoal',target,'reason',trim(p_reason),'delta',p_delta);
 INSERT INTO coffee.operations VALUES(p_key,p_id,'adjustment',result,p_actor,(extract(epoch FROM clock_timestamp())*1000)::bigint);
 INSERT INTO coffee.jobs(member_id,version) VALUES(m.id,m.version);
 RETURN result;
END $$;
ALTER TABLE coffee.ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coffee.ledger FROM PUBLIC;
REVOKE ALL ON FUNCTION coffee.append_ledger(),coffee.immutable_ledger(),coffee.adjust_progress(text,text,int,text,text,text) FROM PUBLIC;
