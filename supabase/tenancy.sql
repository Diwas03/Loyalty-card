-- Legacy profiles remain a default workspace, not an authorization source.
CREATE TABLE IF NOT EXISTS coffee.business_memberships(
 username text NOT NULL REFERENCES coffee.staff_accounts(username) ON DELETE CASCADE,
 shop_id text NOT NULL REFERENCES coffee.shops(id),
 role text NOT NULL CHECK(role IN ('owner','manager','cashier')),enabled boolean NOT NULL DEFAULT true,
 PRIMARY KEY(username,shop_id)
);
CREATE TABLE IF NOT EXISTS coffee.locations(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,shop_id text NOT NULL REFERENCES coffee.shops(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),active boolean NOT NULL DEFAULT true,
 UNIQUE(id,shop_id)
);
CREATE TABLE IF NOT EXISTS coffee.location_grants(
 username text NOT NULL,shop_id text NOT NULL,location_id text NOT NULL,
 PRIMARY KEY(username,shop_id,location_id),
 FOREIGN KEY(username,shop_id) REFERENCES coffee.business_memberships(username,shop_id) ON DELETE CASCADE,
 FOREIGN KEY(location_id,shop_id) REFERENCES coffee.locations(id,shop_id)
);
CREATE TABLE IF NOT EXISTS coffee.workspace_context(
 token_hash text PRIMARY KEY REFERENCES coffee.sessions(token_hash) ON DELETE CASCADE,
 shop_id text NOT NULL REFERENCES coffee.shops(id),location_id text NOT NULL,
 FOREIGN KEY(location_id,shop_id) REFERENCES coffee.locations(id,shop_id)
);
CREATE TABLE IF NOT EXISTS coffee.access_audit(id bigserial PRIMARY KEY,shop_id text NOT NULL REFERENCES coffee.shops(id),actor text NOT NULL,action text NOT NULL,subject text NOT NULL,created_at bigint NOT NULL);
INSERT INTO coffee.locations(id,shop_id,name) SELECT id||':main',id,'Main location' FROM coffee.shops ON CONFLICT DO NOTHING;
WITH added AS (INSERT INTO coffee.business_memberships(username,shop_id,role)
 SELECT a.username,coalesce(p.shop_id,'default'),CASE WHEN a.role='owner' THEN 'owner' ELSE 'cashier' END
 FROM coffee.staff_accounts a LEFT JOIN coffee.staff_profiles p USING(username) ON CONFLICT DO NOTHING RETURNING username,shop_id)
INSERT INTO coffee.location_grants SELECT username,shop_id,shop_id||':main' FROM added ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION coffee.create_main_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO coffee.locations(id,shop_id,name) VALUES(NEW.id||':main',NEW.id,'Main location');RETURN NEW;END $$;
DROP TRIGGER IF EXISTS coffee_shop_location ON coffee.shops;
CREATE TRIGGER coffee_shop_location AFTER INSERT ON coffee.shops FOR EACH ROW EXECUTE FUNCTION coffee.create_main_location();
CREATE OR REPLACE FUNCTION coffee.create_business_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO coffee.business_memberships(username,shop_id,role) SELECT NEW.username,NEW.shop_id,CASE WHEN role='owner' THEN 'owner' ELSE 'cashier' END FROM coffee.staff_accounts WHERE username=NEW.username ON CONFLICT DO NOTHING;
 INSERT INTO coffee.location_grants VALUES(NEW.username,NEW.shop_id,NEW.shop_id||':main') ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coffee_profile_membership ON coffee.staff_profiles;
CREATE TRIGGER coffee_profile_membership AFTER INSERT ON coffee.staff_profiles FOR EACH ROW EXECUTE FUNCTION coffee.create_business_membership();
CREATE OR REPLACE FUNCTION coffee.assert_location(p_actor text,p_shop text,p_location text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM coffee.business_memberships b JOIN coffee.staff_accounts a USING(username) JOIN coffee.locations l ON l.shop_id=b.shop_id
  WHERE b.username=p_actor AND b.shop_id=p_shop AND b.enabled AND a.enabled AND l.id=p_location AND l.active
   AND (b.role='owner' OR EXISTS(SELECT 1 FROM coffee.location_grants g WHERE g.username=p_actor AND g.shop_id=p_shop AND g.location_id=p_location)))
 THEN RAISE EXCEPTION 'Location access denied';END IF;
END $$;
ALTER TABLE coffee.business_memberships ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION coffee.change_team_member(p_actor text,p_shop text,p_username text,p_role text,p_enabled boolean,p_locations text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE old coffee.business_memberships; BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF NOT EXISTS(SELECT 1 FROM coffee.business_memberships b JOIN coffee.staff_accounts a USING(username) WHERE b.username=p_actor AND b.shop_id=p_shop AND b.role='owner' AND b.enabled AND a.enabled) THEN RAISE EXCEPTION 'Owner access required';END IF;
 SELECT * INTO old FROM coffee.business_memberships WHERE username=p_username AND shop_id=p_shop FOR UPDATE;
 IF NOT FOUND OR p_role NOT IN ('owner','manager','cashier') THEN RAISE EXCEPTION 'Invalid membership or role';END IF;
 IF old.role='owner' AND old.enabled AND (p_role<>'owner' OR NOT p_enabled) AND (SELECT count(*) FROM coffee.business_memberships b JOIN coffee.staff_accounts a USING(username) WHERE b.shop_id=p_shop AND b.role='owner' AND b.enabled AND a.enabled)<2 THEN RAISE EXCEPTION 'Cannot remove the last owner';END IF;
 IF p_enabled AND p_role<>'owner' AND coalesce(cardinality(p_locations),0)=0 THEN RAISE EXCEPTION 'Assign at least one location';END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_locations) AS requested(location_id) WHERE NOT EXISTS(SELECT 1 FROM coffee.locations l WHERE l.id=requested.location_id AND l.shop_id=p_shop AND l.active)) THEN RAISE EXCEPTION 'Invalid location';END IF;
 UPDATE coffee.business_memberships SET role=p_role,enabled=p_enabled WHERE username=p_username AND shop_id=p_shop;
 DELETE FROM coffee.location_grants WHERE username=p_username AND shop_id=p_shop;
 INSERT INTO coffee.location_grants SELECT p_username,p_shop,id FROM unnest(p_locations) id ON CONFLICT DO NOTHING;
 DELETE FROM coffee.sessions WHERE username=p_username;
 INSERT INTO coffee.access_audit(shop_id,actor,action,subject,created_at) VALUES(p_shop,p_actor,'team-membership',p_username||':'||p_role||':'||p_enabled,(extract(epoch FROM clock_timestamp())*1000)::bigint);
END $$;
CREATE TABLE IF NOT EXISTS coffee.team_invites(token_hash text PRIMARY KEY,shop_id text NOT NULL REFERENCES coffee.shops(id),role text NOT NULL CHECK(role IN ('manager','cashier')),locations text[] NOT NULL,expires bigint NOT NULL,created_by text NOT NULL,accepted_by text);
CREATE OR REPLACE FUNCTION coffee.accept_team_invite(p_token text,p_username text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE invite coffee.team_invites; BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 SELECT * INTO invite FROM coffee.team_invites WHERE token_hash=p_token AND expires>(extract(epoch FROM clock_timestamp())*1000)::bigint AND accepted_by IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation expired or already used';END IF;
 IF NOT EXISTS(SELECT 1 FROM coffee.business_memberships b JOIN coffee.staff_accounts a USING(username) WHERE b.username=invite.created_by AND b.shop_id=invite.shop_id AND b.role='owner' AND b.enabled AND a.enabled) THEN RAISE EXCEPTION 'Invitation owner no longer has access';END IF;
 IF NOT EXISTS(SELECT 1 FROM coffee.staff_accounts WHERE username=p_username AND enabled) THEN RAISE EXCEPTION 'Sign in required';END IF;
 IF EXISTS(SELECT 1 FROM unnest(invite.locations) AS requested(location_id) WHERE NOT EXISTS(SELECT 1 FROM coffee.locations l WHERE l.id=requested.location_id AND l.shop_id=invite.shop_id AND l.active)) THEN RAISE EXCEPTION 'Invitation locations are unavailable';END IF;
 INSERT INTO coffee.business_memberships VALUES(p_username,invite.shop_id,invite.role,true);
 INSERT INTO coffee.location_grants SELECT p_username,invite.shop_id,id FROM unnest(invite.locations) id;
 UPDATE coffee.team_invites SET accepted_by=p_username WHERE token_hash=p_token;
 INSERT INTO coffee.access_audit(shop_id,actor,action,subject,created_at) VALUES(invite.shop_id,p_username,'accept-invite',invite.created_by,(extract(epoch FROM clock_timestamp())*1000)::bigint);
 RETURN invite.shop_id;
END $$;
ALTER TABLE coffee.team_invites ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION coffee.staff_mutate(p_id text,p_action text,p_key text,p_actor text,p_shop text,p_location text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 IF p_actor<>'legacy' THEN PERFORM coffee.assert_location(p_actor,p_shop,p_location);
 ELSIF EXISTS(SELECT 1 FROM coffee.staff_accounts) THEN RAISE EXCEPTION 'Named staff sign-in required';END IF;
 IF NOT EXISTS(SELECT 1 FROM coffee.members WHERE id=p_id AND shop_id=p_shop) THEN RAISE EXCEPTION 'Membership not found';END IF;
 PERFORM set_config('coffee.location',p_location,true);
 IF p_action='scan' THEN RETURN coffee.scan_purchase(p_id,p_key,p_actor);
 ELSIF p_action='redeem' THEN RETURN coffee.mutate_member(p_id,'redeem',p_key,p_actor);
 ELSE RAISE EXCEPTION 'Unsupported action';END IF;
END $$;
ALTER TABLE coffee.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE coffee.location_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE coffee.workspace_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE coffee.access_audit ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS coffee_access_audit_immutable ON coffee.access_audit;
CREATE TRIGGER coffee_access_audit_immutable BEFORE UPDATE OR DELETE ON coffee.access_audit FOR EACH ROW EXECUTE FUNCTION coffee.immutable_ledger();
REVOKE ALL ON ALL TABLES IN SCHEMA coffee FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA coffee FROM PUBLIC;
