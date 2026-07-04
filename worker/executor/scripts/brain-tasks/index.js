// Brain task router. A worker/executor/run.js akkor hívja meg, ha a spec-ben
// szerepel spec.brain_task blokk (Kylogic által küldött taszk).
//
// task_type → executor script megfeleltetés:
//   ping               → runBrainPing (nem nyit böngészőt)
//   metrics_snapshot   → TODO (2. lépés)
//   comments_snapshot  → TODO (3. lépés)
//   post_comment_reply → TODO (4. lépés)
//
// A böngésző-igényes taszkok később kapják meg a page/context/creds/proxy
// paramétereket. Egyelőre csak a `ping` fut, a többi explicit hibával leáll,
// hogy tudjuk, még nincs kész — nem próbál rossz módon lefutni.

import { runBrainPing } from "./ping.js";

export function isBrainTask(spec) {
  return !!(spec && spec.brain_task && spec.brain_task.task_type);
}

export function needsBrowser(brainTask) {
  // A ping nem nyit böngészőt. A többi mind fog.
  return brainTask.task_type !== "ping";
}

export async function runBrainTask({ brainTask, page, context, creds, log }) {
  const t = brainTask.task_type;
  switch (t) {
    case "ping":
      return await runBrainPing({ brainTask, log });
    case "metrics_snapshot":
    case "comments_snapshot":
    case "post_comment_reply":
      throw new Error(
        `brain_task "${t}" executor még nincs implementálva a workeren`,
      );
    default:
      throw new Error(`Ismeretlen brain_task task_type: ${t}`);
  }
}
