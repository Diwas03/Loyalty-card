-- Run AFTER deployment, in the Supabase SQL editor. Replace these placeholders securely here, never in Git or chat.
-- Verify Cron/pg_net availability and current plan limits in your project first.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT vault.create_secret('https://YOUR-PRODUCTION-APP.vercel.app','coffee_app_url');
SELECT vault.create_secret('REPLACE_WITH_THE_SAME_RANDOM_CRON_SECRET_SET_IN_VERCEL','coffee_cron_secret');
-- Run once. To replace this schedule, unschedule its existing job first.
SELECT cron.schedule('coffee-wallet-updates','* * * * *',$job$
 SELECT net.http_post(
  url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='coffee_app_url')||'/api/cron/wallet-updates',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='coffee_cron_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=55000
 );
$job$);
