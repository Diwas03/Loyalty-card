-- Individual vouchers preserve their promised label and expiry at issuance.
ALTER TABLE coffee.shops ADD COLUMN IF NOT EXISTS reward_expiry_days int CHECK(reward_expiry_days BETWEEN 1 AND 3650);
CREATE TABLE IF NOT EXISTS coffee.issued_rewards(
 id bigserial PRIMARY KEY,member_id text NOT NULL REFERENCES coffee.members(id),
 shop_id text NOT NULL REFERENCES coffee.shops(id),source_key text NOT NULL,ordinal int NOT NULL,
 label text NOT NULL,status text NOT NULL CHECK(status IN ('available','redeemed','expired','revoked')),
 issued_at bigint,expires_at bigint,changed_at bigint,operation_key text,
 UNIQUE(source_key,ordinal)
);
CREATE OR REPLACE FUNCTION coffee.backfill_rewards() RETURNS void LANGUAGE sql AS $$
 INSERT INTO coffee.issued_rewards(member_id,shop_id,source_key,ordinal,label,status)
 SELECT m.id,m.shop_id,'legacy:'||m.id,n,s.reward_label,'available'
 FROM coffee.members m JOIN coffee.shops s ON s.id=m.shop_id CROSS JOIN LATERAL generate_series(1,m.rewards) n
 WHERE NOT EXISTS(SELECT 1 FROM coffee.issued_rewards r WHERE r.member_id=m.id)
 ON CONFLICT DO NOTHING;
$$;
SELECT coffee.backfill_rewards();
CREATE OR REPLACE FUNCTION coffee.track_vouchers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s coffee.shops; voucher bigint; BEGIN
 SELECT * INTO s FROM coffee.shops WHERE id=NEW.shop_id;
 IF NEW.reward_delta>0 THEN
  INSERT INTO coffee.issued_rewards(member_id,shop_id,source_key,ordinal,label,status,issued_at,expires_at)
  SELECT NEW.member_id,NEW.shop_id,NEW.operation_key,n,s.reward_label,'available',NEW.created_at,
   CASE WHEN s.reward_expiry_days IS NULL THEN NULL ELSE NEW.created_at+s.reward_expiry_days::bigint*86400000 END
  FROM generate_series(1,NEW.reward_delta) n;
 ELSIF NEW.kind='redeem' THEN
  SELECT id INTO voucher FROM coffee.issued_rewards WHERE member_id=NEW.member_id AND status='available' AND (expires_at IS NULL OR expires_at>NEW.created_at)
   ORDER BY expires_at NULLS LAST,id LIMIT 1 FOR UPDATE;
  IF voucher IS NULL THEN RAISE EXCEPTION 'No reward available';END IF;
  UPDATE coffee.issued_rewards SET status='redeemed',changed_at=NEW.created_at,operation_key=NEW.operation_key WHERE id=voucher;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coffee_voucher_ledger ON coffee.ledger;
CREATE TRIGGER coffee_voucher_ledger AFTER INSERT ON coffee.ledger FOR EACH ROW EXECUTE FUNCTION coffee.track_vouchers();
CREATE OR REPLACE FUNCTION coffee.expire_member_rewards(p_id text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE now_ms bigint; n int; m coffee.members; target int; result jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(7342101);
 now_ms=(extract(epoch FROM clock_timestamp())*1000)::bigint;
 SELECT * INTO m FROM coffee.members WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 0;END IF;
 WITH expired AS (UPDATE coffee.issued_rewards SET status='expired',changed_at=now_ms
  WHERE member_id=p_id AND status='available' AND expires_at<=now_ms RETURNING id)
 SELECT count(*)::int INTO n FROM expired;
 IF n=0 THEN RETURN 0;END IF;
 IF n>m.rewards THEN RAISE EXCEPTION 'Reward balance reconciliation required';END IF;
 UPDATE coffee.members SET rewards=rewards-n,version=nextval('coffee.revision') WHERE id=p_id RETURNING * INTO m;
 SELECT stamp_goal INTO target FROM coffee.shops WHERE id=m.shop_id;
 result=jsonb_build_object('id',m.id,'stamps',m.stamps,'rewards',m.rewards,'stampGoal',target,'reason','Reward validity period ended','expired',n);
 INSERT INTO coffee.operations VALUES('expire:'||p_id||':'||m.version,p_id,'expire',result,'system',now_ms);
 INSERT INTO coffee.jobs(member_id,version) VALUES(p_id,m.version);
 RETURN n;
END $$;
ALTER TABLE coffee.issued_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coffee.issued_rewards FROM PUBLIC;
REVOKE ALL ON FUNCTION coffee.backfill_rewards(),coffee.track_vouchers(),coffee.expire_member_rewards(text) FROM PUBLIC;
