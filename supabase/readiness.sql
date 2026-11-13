-- Reviewed additive hardening. Existing balances, voucher labels and expiries are unchanged.
CREATE TABLE IF NOT EXISTS coffee.pilot_readiness_versions(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS coffee.merchant_invites(
 token_hash text PRIMARY KEY,expires bigint NOT NULL,used_at bigint,shop_id text REFERENCES coffee.shops(id),created_by text NOT NULL
);
ALTER TABLE coffee.merchant_invites ENABLE ROW LEVEL SECURITY;
-- Serialize owner creation with invite consumption. Default open onboarding is retained;
-- PILOT_ONBOARDING_MODE=invite on the server opts into controlled onboarding.
CREATE OR REPLACE FUNCTION coffee.register_invited_shop(p_username text,p_hash text,p_name text,p_shop_name text,p_invite text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF NOT EXISTS(SELECT 1 FROM coffee.merchant_invites WHERE token_hash=p_invite AND used_at IS NULL AND expires>(extract(epoch FROM clock_timestamp())*1000)::bigint FOR UPDATE) THEN RAISE EXCEPTION 'Merchant invitation unavailable';END IF;
 result=coffee.register_shop(p_username,p_hash,p_name,p_shop_name);
 UPDATE coffee.merchant_invites SET used_at=(extract(epoch FROM clock_timestamp())*1000)::bigint,shop_id=result->>'shopId' WHERE token_hash=p_invite;
 RETURN result;
END $$;
-- Location authorization and ledger location are in the same transaction as adjustment.
CREATE OR REPLACE FUNCTION coffee.staff_adjust(p_shop text,p_id text,p_delta int,p_reason text,p_key text,p_actor text,p_location text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 PERFORM coffee.assert_location(p_actor,p_shop,p_location);
 PERFORM set_config('coffee.location',p_location,true);
 RETURN coffee.adjust_progress(p_shop,p_id,p_delta,p_reason,p_key,p_actor);
END $$;
-- Revocation removes both outstanding transfer tokens and browser recovery mappings.
CREATE OR REPLACE FUNCTION coffee.rotate_private_link(p_id text,p_shop text,p_actor text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE token text;BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 UPDATE coffee.members SET card_token=gen_random_uuid()::text WHERE id=p_id AND shop_id=p_shop RETURNING card_token INTO token;
 IF token IS NULL THEN RAISE EXCEPTION 'Membership not found';END IF;
 DELETE FROM coffee.card_transfers WHERE member_id=p_id;
 DELETE FROM coffee.customer_enrollments WHERE member_id=p_id;
 INSERT INTO coffee.access_audit(shop_id,actor,action,subject,created_at) VALUES(p_shop,p_actor,'rotate-private-link',p_id,(extract(epoch FROM clock_timestamp())*1000)::bigint);
 RETURN token;
END $$;
-- Transfer, enrollment mapping and consumption commit together; rotation uses the same lock.
CREATE OR REPLACE FUNCTION coffee.consume_transfer(p_hash text,p_browser text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE transfer coffee.card_transfers;m coffee.members;existing text;BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 SELECT * INTO transfer FROM coffee.card_transfers WHERE token_hash=p_hash AND expires>(extract(epoch FROM clock_timestamp())*1000)::bigint FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Transfer unavailable';END IF;
 SELECT * INTO m FROM coffee.members WHERE id=transfer.member_id;
 SELECT member_id INTO existing FROM coffee.customer_enrollments WHERE token_hash=encode(sha256(convert_to(CASE WHEN m.shop_id='default' THEN p_browser ELSE p_browser||':'||m.shop_id END,'UTF8')),'hex');
 IF existing IS NOT NULL AND existing<>m.id THEN RAISE EXCEPTION 'This browser already has another membership at this shop';END IF;
 INSERT INTO coffee.customer_enrollments VALUES(encode(sha256(convert_to(CASE WHEN m.shop_id='default' THEN p_browser ELSE p_browser||':'||m.shop_id END,'UTF8')),'hex'),m.id,(extract(epoch FROM clock_timestamp())*1000)::bigint) ON CONFLICT DO NOTHING;
 DELETE FROM coffee.card_transfers WHERE member_id=m.id;
 RETURN jsonb_build_object('cardToken',m.card_token);
END $$;
CREATE OR REPLACE FUNCTION coffee.create_transfer(p_card text,p_hash text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE member text;BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 SELECT id INTO member FROM coffee.members WHERE card_token=p_card FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 INSERT INTO coffee.card_transfers VALUES(member,p_hash,(extract(epoch FROM clock_timestamp())*1000)::bigint+600000)
 ON CONFLICT(member_id) DO UPDATE SET token_hash=excluded.token_hash,expires=excluded.expires;
 RETURN true;
END $$;
CREATE INDEX IF NOT EXISTS coffee_operations_member_kind_time ON coffee.operations(member_id,kind,created_at DESC);
REVOKE ALL ON ALL TABLES IN SCHEMA coffee FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA coffee FROM PUBLIC;
INSERT INTO coffee.pilot_readiness_versions(version) VALUES('20261102') ON CONFLICT DO NOTHING;
