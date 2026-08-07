SELECT cron.schedule(
  'linkedin-comment-scan-hourly',
  '25 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--7d89e05a-a0ab-454c-a80a-3c9b8715c912.lovable.app/api/public/cron/linkedin-comment-scan',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_HPFmaRfvpsBh_AsefQ1f4w_NpQ5j4Oq"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);