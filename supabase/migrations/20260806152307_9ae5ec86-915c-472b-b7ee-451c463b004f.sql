CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'lead-radar-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--7d89e05a-a0ab-454c-a80a-3c9b8715c912.lovable.app/api/public/cron/lead-radar',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_HPFmaRfvpsBh_AsefQ1f4w_NpQ5j4Oq"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'linkedin-metrics-twice-daily',
  '5 8,20 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--7d89e05a-a0ab-454c-a80a-3c9b8715c912.lovable.app/api/public/cron/linkedin-metrics',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_HPFmaRfvpsBh_AsefQ1f4w_NpQ5j4Oq"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);