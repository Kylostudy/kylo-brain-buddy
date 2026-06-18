/**
 * Steel.dev runner — szerver-only.
 *
 * Mostantól nem közvetlenül a Lovable Cloud edge-éről hívjuk a Steel API-t,
 * hanem ugyanúgy `queued` státusszal a sorba tesszük a futtatást, mint a
 * Docker runnernél. A VPS-en futó orchestrator pickeli fel, és ott — egy
 * Node.js konténerben — a Playwright `chromium.connectOverCDP()` segítségével
 * csatlakozik a Steel session-höz, ahol végrehajtja a tényleges szkriptet
 * (login + feltöltés). Így a Steel preview-ablakban is látszik élőben, mi
 * történik, viszont a teljes flow lefut (nem csak egy üres session nyílik).
 */

import type { Runner, RunLogEntry, StartRunArgs, StartRunResult } from "./types";

function nowIso() {
  return new Date().toISOString();
}

export const steelRunner: Runner = {
  name: "steel",
  async start({ workflowId, spec, credentialsLabel }: StartRunArgs): Promise<StartRunResult> {
    const logs: RunLogEntry[] = [
      { ts: nowIso(), level: "info", message: `Steel queue: workflow ${workflowId} sorba téve.` },
      { ts: nowIso(), level: "info", message: `Platform: ${spec.platform ?? "n/a"} · Credential: ${credentialsLabel ?? "nincs"}` },
      {
        ts: nowIso(),
        level: "info",
        message:
          "A VPS orchestrator a következő poll-ciklusban (≤3s) létrehoz egy Steel sessiont, és Playwright/CDP-n keresztül lefuttatja a szkriptet (a Steel viewerben élőben követhető).",
      },
    ];
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
