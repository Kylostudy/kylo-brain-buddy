CREATE FUNCTION public.vps_task_is_nonbrowser(task_type text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT COALESCE(task_type = ANY(ARRAY['ping','stt_media_fetch','stt_calibrate','archive_video','membership_transcribe','receive_subject_factory_package']), false) $$;
REVOKE ALL ON FUNCTION public.vps_task_is_nonbrowser(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vps_task_is_nonbrowser(text) TO authenticated, service_role;
CREATE FUNCTION public.retire_vps_browser_execution() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='workflows' THEN
  IF NOT public.vps_task_is_nonbrowser(NEW.spec->'brain_task'->>'task_type') THEN NEW.active:=false; END IF;
 ELSIF TG_TABLE_NAME='brain_workflow_runs' THEN
  IF NOT public.vps_task_is_nonbrowser(NEW.spec_snapshot->'brain_task'->>'task_type') AND (NEW.status IN ('queued','scheduled','running') OR (TG_OP='UPDATE' AND OLD.status='cancelled')) THEN
   NEW.status:='cancelled'; NEW.finished_at:=COALESCE(NEW.finished_at,now()); NEW.error:='VPS browser execution permanently retired by owner';
  END IF;
 ELSIF TG_TABLE_NAME='brain_task_queue' THEN
  IF NOT public.vps_task_is_nonbrowser(NEW.task_type) AND NEW.status IN ('queued','running','deferred_to_next_day','account_busy') THEN NEW.status:='cancelled'; NEW.completed_at:=now(); NEW.error:='VPS browser execution permanently retired by owner'; END IF;
 ELSIF TG_TABLE_NAME='recording_sessions' THEN
  IF NEW.status IN ('requested','active','stopping') THEN NEW.status:='cancelled'; NEW.ended_at:=now(); NEW.error:='VPS browser execution permanently retired by owner'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retire_vps_browser_execution() FROM PUBLIC;
CREATE TRIGGER retire_browser_workflows BEFORE INSERT OR UPDATE ON public.workflows FOR EACH ROW EXECUTE FUNCTION public.retire_vps_browser_execution();
CREATE TRIGGER retire_browser_runs BEFORE INSERT OR UPDATE ON public.brain_workflow_runs FOR EACH ROW EXECUTE FUNCTION public.retire_vps_browser_execution();
CREATE TRIGGER retire_browser_tasks BEFORE INSERT OR UPDATE ON public.brain_task_queue FOR EACH ROW EXECUTE FUNCTION public.retire_vps_browser_execution();
CREATE TRIGGER retire_browser_recordings BEFORE INSERT OR UPDATE ON public.recording_sessions FOR EACH ROW EXECUTE FUNCTION public.retire_vps_browser_execution();