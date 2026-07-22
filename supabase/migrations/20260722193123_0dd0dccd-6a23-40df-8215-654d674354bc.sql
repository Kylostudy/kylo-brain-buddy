ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS quiet_hours_start integer,
  ADD COLUMN IF NOT EXISTS quiet_hours_end   integer,
  ADD COLUMN IF NOT EXISTS quiet_hours_timezone text;

ALTER TABLE public.workflows
  DROP CONSTRAINT IF EXISTS workflows_quiet_hours_range;

ALTER TABLE public.workflows
  ADD CONSTRAINT workflows_quiet_hours_range
  CHECK (
    (quiet_hours_start IS NULL AND quiet_hours_end IS NULL)
    OR (quiet_hours_start BETWEEN 0 AND 23 AND quiet_hours_end BETWEEN 0 AND 23)
  );

CREATE OR REPLACE FUNCTION public.is_workflow_quiet_now(_workflow_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  s int; e int; tz text; h int;
BEGIN
  SELECT quiet_hours_start, quiet_hours_end, quiet_hours_timezone
    INTO s, e, tz
  FROM public.workflows WHERE id = _workflow_id;

  IF s IS NULL OR e IS NULL THEN RETURN false; END IF;
  IF tz IS NULL OR tz = '' THEN tz := 'UTC'; END IF;

  h := EXTRACT(HOUR FROM (now() AT TIME ZONE tz))::int;

  IF s = e THEN
    RETURN false;
  ELSIF s < e THEN
    RETURN h >= s AND h < e;
  ELSE
    RETURN h >= s OR h < e;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_workflow_quiet_now(uuid) TO authenticated, service_role;