ALTER TABLE public.workflows DROP CONSTRAINT IF EXISTS workflows_platform_check;
ALTER TABLE public.workflows ADD CONSTRAINT workflows_platform_check CHECK (
  platform IS NULL OR platform = ANY (ARRAY['tiktok','instagram','youtube','facebook','linkedin','pinterest','x','reddit','system']::text[])
);

ALTER TABLE public.brain_task_queue DROP CONSTRAINT IF EXISTS brain_task_queue_task_type_check;
ALTER TABLE public.brain_task_queue ADD CONSTRAINT brain_task_queue_task_type_check CHECK (
  task_type = ANY (ARRAY['publish_video','post_comment_reply','metrics_snapshot','comments_snapshot','ping','upload_pin','upload_video','record_replay_login','reddit_warmup','reddit_register','stt_media_fetch']::text[])
);