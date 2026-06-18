/**
 * Docker runner — szerver-only.
 *
 * A Lovable Cloud-on belül nem futtatunk böngészőt; csak `queued` státusszal
 * a sorba tesszük a futtatást. A VPS-en futó `worker/orchestrator/index.js`
 * pollozza ezt a sort, lehúzza a credentialeket (titkosítva), és elindít
 * egy Docker konténert a Playwright szkripttel.
 */

import type { Runner, RunLogEntry, StartRunArgs, StartRunResult } from "./types";

function nowIso() {
  return new Date().toISOString();
}

export const dockerRunner: Runner = {
  name: "docker",
  async start({ workflowId, spec, credentialsLabel }: StartRunArgs): Promise<StartRunResult> {
    const logs: RunLogEntry[] = [
      { ts: nowIso(), level: "info", message: `Docker queue: workflow ${workflowId} sorba téve.` },
      { ts: nowIso(), level: "info", message: `Platform: ${spec.platform ?? "n/a"} · Credential: ${credentialsLabel ?? "nincs"}` },
      {
        ts: nowIso(),
        level: "info",
        message:
          "A VPS orchestrator a következő poll-ciklusban (≤3s) lehúzza és elindítja a konténert.",
      },
    ];
    // A startRun ezt a sort `running` helyett `queued` státuszra állítja vissza,
    // hogy az orchestrator fel tudja venni.
    return {
      externalId: null,
      initialLogs: logs,
      finishedSync: true,
      finalStatus: "queued",
      finalResult: null,
      finalError: null,
    };
  },
};
