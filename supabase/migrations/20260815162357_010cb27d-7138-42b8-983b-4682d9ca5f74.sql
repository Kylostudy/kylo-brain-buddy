select cron.schedule(
  'worker-health-alert',
  '*/5 * * * *',
  $$
  select net.http_post(
    url:='https://project--7d89e05a-a0ab-454c-a80a-3c9b8715c912.lovable.app/api/public/cron/worker-health-alert',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable_HPFmaRfvpsBh_AsefQ1f4w_NpQ5j4Oq"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);