// Keep in sync with the fixed VPS policy and public.vps_task_is_nonbrowser.
export const NON_BROWSER_TASKS = [
  "archive_video", "receive_subject_factory_package",
] as const;
export function isNonBrowserSpec(spec: unknown): boolean {
  if (!spec || typeof spec !== "object" || !("brain_task" in spec)) return false;
  const task = spec.brain_task;
  if (!task || typeof task !== "object" || !("task_type" in task)) return false;
  return NON_BROWSER_TASKS.some((type) => type === task.task_type);
}