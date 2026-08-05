ALTER TABLE public.brain_task_queue DROP CONSTRAINT brain_task_queue_task_type_check;
ALTER TABLE public.brain_task_queue ADD CONSTRAINT brain_task_queue_task_type_check
CHECK (task_type = ANY (ARRAY[
  'publish_video','post_comment_reply','metrics_snapshot','comments_snapshot','ping',
  'upload_pin','upload_video','record_replay_login','reddit_warmup','reddit_register',
  'stt_media_fetch','reddit_post','reddit_comment','linkedin_post',
  'facebook_warmup','linkedin_warmup','instagram_warmup','tiktok_warmup'
]));