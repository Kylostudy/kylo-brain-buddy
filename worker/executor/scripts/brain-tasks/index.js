// Brain task router. A worker/executor/run.js akkor hívja meg, ha a spec-ben
// szerepel spec.brain_task blokk (Kylogic által küldött taszk).
//
// task_type → executor script megfeleltetés:
//   ping                → runBrainPing (nem nyit böngészőt)
//   metrics_snapshot    → platform szerint dispatch:
//                            linkedin  → runLinkedInMetricsSnapshot
//                            pinterest → runPinterestMetricsSnapshot
//                            (tiktok   → később)
//   comments_snapshot   → TODO
//   post_comment_reply  → TODO

import { runBrainPing } from "./ping.js";
import { runLinkedInMetricsSnapshot } from "./linkedin-metrics-snapshot.js";
import { runPinterestMetricsSnapshot } from "./pinterest-metrics-snapshot.js";
import { runPinterestUploadPin } from "./pinterest-upload-pin.js";
import { runTikTokUploadVideo } from "./tiktok-upload-video.js";
import { runRecordReplay } from "./record-replay.js";

export function isBrainTask(spec) {
  return !!(spec && spec.brain_task && spec.brain_task.task_type);
}

/** Igaz → böngészőt kell nyitni a taszkhoz. */
export function needsBrowser(brainTask) {
  return brainTask.task_type !== "ping";
}

/**
 * Fő belépési pont. A böngésző-igényes taszkok kapják a page/context-et,
 * a ping csak logot.
 */
export async function runBrainTask(args) {
  const { brainTask } = args;
  const t = brainTask.task_type;

  switch (t) {
    case "ping":
      return await runBrainPing({ brainTask, log: args.log });

    case "record_replay_login":
      return await runRecordReplay(args);

    case "metrics_snapshot": {
      const platform = (brainTask.platform || args.spec?.platform || "").toLowerCase();
      if (platform === "linkedin") {
        return await runLinkedInMetricsSnapshot(args);
      }
      if (platform === "pinterest") {
        return await runPinterestMetricsSnapshot(args);
      }
      throw new Error(
        `metrics_snapshot: platform "${platform || "?"}" executor még nincs implementálva`,
      );
    }

    case "upload_pin": {
      const platform = (brainTask.platform || args.spec?.platform || "pinterest").toLowerCase();
      if (platform === "pinterest") {
        return await runPinterestUploadPin(args);
      }
      throw new Error(`upload_pin: platform "${platform}" executor még nincs implementálva`);
    }

    case "upload_video": {
      const platform = (brainTask.platform || args.spec?.platform || "").toLowerCase();
      if (platform === "tiktok") {
        return await runTikTokUploadVideo(args);
      }
      throw new Error(`upload_video: platform "${platform || "?"}" executor még nincs implementálva`);
    }

    case "comments_snapshot":
    case "post_comment_reply":
      throw new Error(
        `brain_task "${t}" executor még nincs implementálva a workeren`,
      );

    default:
      throw new Error(`Ismeretlen brain_task task_type: ${t}`);
  }
}
