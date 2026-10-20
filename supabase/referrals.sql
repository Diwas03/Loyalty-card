-- A referral code is public and unrelated to the private membership link.
ALTER TABLE coffee.shops ADD COLUMN IF NOT EXISTS referrals_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE coffee.shops ADD COLUMN IF NOT EXISTS referral_reward_kind text NOT NULL DEFAULT 'stamps' CHECK(referral_reward_kind IN ('stamps','rewards'));
ALTER TABLE coffee.shops ADD COLUMN IF NOT EXISTS referral_reward_amount int NOT NULL DEFAULT 1 CHECK(referral_reward_amount BETWEEN 1 AND 10);
ALTER TABLE coffee.members ADD COLUMN IF NOT EXISTS referral_code text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-','');
CREATE UNIQUE INDEX IF NOT EXISTS coffee_member_referral_code ON coffee.members(referral_code);
CREATE TABLE IF NOT EXISTS coffee.referrals(
 referred_id text PRIMARY KEY REFERENCES coffee.members(id),
 referrer_id text NOT NULL REFERENCES coffee.members(id),
 shop_id text NOT NULL REFERENCES coffee.shops(id),
 reward_kind text NOT NULL CHECK(reward_kind IN ('stamps','rewards')),
 reward_amount int NOT NULL CHECK(reward_amount BETWEEN 1 AND 10),
 created_at bigint NOT NULL,credited_at bigint,
 CHECK(referred_id<>referrer_id)
);
CREATE INDEX IF NOT EXISTS coffee_referrals_shop ON coffee.referrals(shop_id,created_at DESC);
CREATE INDEX IF NOT EXISTS coffee_referrals_referrer ON coffee.referrals(referrer_id);
CREATE OR REPLACE FUNCTION coffee.enroll_customer(p_name text,p_token text,p_shop text,p_referral text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; sponsor coffee.members; shop coffee.shops; BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 -- Existing memberships and retries cannot acquire or change attribution.
 IF p_token IS NOT NULL AND EXISTS(SELECT 1 FROM coffee.customer_enrollments e JOIN coffee.members m ON m.id=e.member_id WHERE e.token_hash=p_token AND m.shop_id=p_shop) THEN
  RETURN coffee.enroll_customer(p_name,p_token,p_shop);
 END IF;
 result=coffee.enroll_customer(p_name,p_token,p_shop);
 SELECT * INTO shop FROM coffee.shops WHERE id=p_shop;
 SELECT * INTO sponsor FROM coffee.members WHERE referral_code=p_referral AND shop_id=p_shop AND id<>(result->>'id');
 IF FOUND AND shop.referrals_enabled AND p_token IS NOT NULL THEN
  INSERT INTO coffee.referrals(referred_id,referrer_id,shop_id,reward_kind,reward_amount,created_at)
   VALUES(result->>'id',sponsor.id,p_shop,shop.referral_reward_kind,shop.referral_reward_amount,(extract(epoch FROM clock_timestamp())*1000)::bigint) ON CONFLICT DO NOTHING;
 END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION coffee.credit_referral() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE referral coffee.referrals; sponsor coffee.members; goal int; result jsonb; BEGIN
 IF NEW.kind<>'purchase' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(7342101);
 IF EXISTS(SELECT 1 FROM coffee.operations WHERE member_id=NEW.member_id AND kind='purchase' AND key<>NEW.key) THEN RETURN NEW; END IF;
 SELECT * INTO referral FROM coffee.referrals WHERE referred_id=NEW.member_id AND credited_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT * INTO sponsor FROM coffee.members WHERE id=referral.referrer_id AND shop_id=referral.shop_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM coffee.members WHERE id=NEW.member_id AND shop_id=referral.shop_id) THEN RETURN NEW; END IF;
 SELECT stamp_goal INTO goal FROM coffee.shops WHERE id=referral.shop_id;
 UPDATE coffee.members SET
  stamps=CASE WHEN referral.reward_kind='stamps' THEN (sponsor.stamps+referral.reward_amount)%goal ELSE sponsor.stamps END,
  rewards=sponsor.rewards+CASE WHEN referral.reward_kind='stamps' THEN (sponsor.stamps+referral.reward_amount)/goal ELSE referral.reward_amount END,
  version=nextval('coffee.revision') WHERE id=sponsor.id RETURNING * INTO sponsor;
 INSERT INTO coffee.jobs(member_id,version) VALUES(sponsor.id,sponsor.version);
 result=jsonb_build_object('id',sponsor.id,'stamps',sponsor.stamps,'rewards',sponsor.rewards,'version',sponsor.version,'stampGoal',goal,'bonusKind',referral.reward_kind,'bonusAmount',referral.reward_amount);
 INSERT INTO coffee.operations VALUES('referral:'||referral.referred_id,sponsor.id,'referral',result,NEW.actor,(extract(epoch FROM clock_timestamp())*1000)::bigint);
 UPDATE coffee.referrals SET credited_at=(extract(epoch FROM clock_timestamp())*1000)::bigint WHERE referred_id=NEW.member_id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coffee_referral_purchase ON coffee.operations;
CREATE TRIGGER coffee_referral_purchase AFTER INSERT ON coffee.operations FOR EACH ROW EXECUTE FUNCTION coffee.credit_referral();
ALTER TABLE coffee.referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coffee.referrals FROM PUBLIC;
REVOKE ALL ON FUNCTION coffee.enroll_customer(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION coffee.credit_referral() FROM PUBLIC;
