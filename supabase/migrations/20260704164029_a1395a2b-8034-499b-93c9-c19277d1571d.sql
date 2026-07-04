CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('dispatch-brain-tasks') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='dispatch-brain-tasks');

SELECT cron.schedule(
  'dispatch-brain-tasks',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kylo-brain-buddy.lovable.app/api/public/cron/dispatch-brain-tasks',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_HPFmaRfvpsBh_AsefQ1f4w_NpQ5j4Oq"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);