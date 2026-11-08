// Owner-retired capability: fail closed for every unknown/browser task.
export const NON_BROWSER_TASKS = Object.freeze([
  "archive_video", "receive_subject_factory_package",
]);
export function isNonBrowserSpec(spec) {
  return NON_BROWSER_TASKS.includes(spec?.brain_task?.task_type);
}