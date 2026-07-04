ALTER TABLE public.brain_task_queue DROP CONSTRAINT brain_task_queue_task_type_check;
ALTER TABLE public.brain_task_queue ADD CONSTRAINT brain_task_queue_task_type_check
  CHECK (task_type = ANY (ARRAY['publish_video'::text, 'post_comment_reply'::text, 'metrics_snapshot'::text, 'comments_snapshot'::text, 'ping'::text]));