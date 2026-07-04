// Brain task: "ping" — smoke test, semmi valódi művelet.
// Szinkron visszatér { pong: true, worker_time: ... }-tal.
// Böngészőt sem kell nyitni, a router meg sem indítja a Playwright-et.

export async function runBrainPing({ brainTask, log }) {
  log("info", `[brain_task=ping] kylogic_task_id=${brainTask.kylogic_task_id}`);
  return {
    pong: true,
    worker_time: new Date().toISOString(),
    task_id: brainTask.task_id,
    kylogic_task_id: brainTask.kylogic_task_id,
  };
}
