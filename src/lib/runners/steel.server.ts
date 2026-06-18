/**
 * Steel.dev runner — szerver-only.
 *
 * Most a Steel /v1/sessions endpointot hívjuk, és visszaadjuk a session ID-t +
 * a debug URL-t logként. A tényleges Playwright-szkriptet ezután fogjuk
 * berakni (külön munkamenetben), amikor megvannak az első konkrét workflow
 * lépések.
 *
 * Ha a STEEL_API_KEY hiányzik → "local-mock" módra esünk vissza: szintetikus
 * sikeres futtatást generálunk, hogy a teljes flow (DB → UI → "kész") fejlesztés
 * közben is végigfusson kulcs nélkül.
 */

import type {
  Runner,
  RunLogEntry,
  StartRunArgs,
  StartRunResult,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

function log(level: RunLogEntry["level"], message: string): RunLogEntry {
  return { ts: nowIso(), level, message };
}

export const steelRunner: Runner = {
  name: "steel",
  async start({ spec, workflowId, hasCredentials, credentialsLabel }: StartRunArgs): Promise<StartRunResult> {
    const apiKey = process.env.STEEL_API_KEY;

    // --- Fallback: szimulált futás kulcs nélkül ---
    if (!apiKey) {
      const logs: RunLogEntry[] = [
        log("warn", "STEEL_API_KEY hiányzik → szimulált futás (local-mock)."),
        log(
          "info",
          `Workflow ${workflowId} spec betöltve. Platform: ${spec.platform ?? "n/a"}, fiók: ${spec.account_label ?? "n/a"}.`,
        ),
        log("info", `Credential: ${credentialsLabel ?? "nincs mentve"}`),
        log("info", "Emberi viselkedés-szimuláció: várakozás 1.2s …"),
        log("info", "Szimulált poszt elküldve. ✅"),
      ];
      return {
        externalId: null,
        initialLogs: logs,
        finishedSync: true,
        finalStatus: "succeeded",
        finalResult: { simulated: true, posted: 1, hasCredentials: !!hasCredentials },
        finalError: null,
      };
    }

    // --- Éles Steel.dev session létrehozása ---
    try {
      const res = await fetch("https://api.steel.dev/v1/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Steel-Api-Key": apiKey,
        },
        body: JSON.stringify({
          // Konzervatív default — később per-workflow konfigolható.
          sessionTimeout: 5 * 60 * 1000,
          blockAds: true,
          isSelenium: false,
          stealthConfig: {
            humanlikeInteractions: true,
            skipFingerprintInjection: false,
          },
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        return {
          externalId: null,
          initialLogs: [
            log("error", `Steel hiba (${res.status}): ${txt.slice(0, 200)}`),
          ],
          finishedSync: true,
          finalStatus: "failed",
          finalResult: null,
          finalError: `Steel API ${res.status}`,
        };
      }

      const json = (await res.json()) as {
        id?: string;
        sessionViewerUrl?: string;
        debugUrl?: string;
      };

      const logs: RunLogEntry[] = [
        log("info", `Steel session létrehozva: ${json.id ?? "?"}`),
      ];
      if (json.sessionViewerUrl) {
        logs.push(log("info", `Viewer: ${json.sessionViewerUrl}`));
      }
      logs.push(
        log(
          "info",
          `Workflow ${workflowId} spec átadva. Platform: ${spec.platform ?? "n/a"}.`,
        ),
        log("info", `Credential: ${credentialsLabel ?? "nincs mentve"}`),
        log(
          "warn",
          "Playwright szkript még nincs bekötve — a session él, de tétlen. (Következő fázis.)",
        ),
      );

      return {
        externalId: json.id ?? null,
        initialLogs: logs,
        // A session nyitva — később polleroljuk vagy webhookot kapunk.
        // Most a felhasználó manuálisan zárja, vagy lejár.
        finishedSync: false,
      };
    } catch (e) {
      return {
        externalId: null,
        initialLogs: [
          log(
            "error",
            `Steel hívás kivétel: ${e instanceof Error ? e.message : String(e)}`,
          ),
        ],
        finishedSync: true,
        finalStatus: "failed",
        finalResult: null,
        finalError: e instanceof Error ? e.message : "Ismeretlen hiba",
      };
    }
  },
};
