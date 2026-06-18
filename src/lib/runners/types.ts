/**
 * Runner absztrakció — bármely backend (Steel.dev, saját Docker worker, helyi)
 * ugyanezt az interface-t implementálja. A Brain és az UI nem tud róla,
 * melyik runner fut épp.
 */

import type { WorkflowSpec } from "@/lib/chat.functions";

export type RunnerName = "steel" | "docker" | "local-mock";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RunLogEntry = {
  ts: string; // ISO timestamp
  level: "info" | "warn" | "error";
  message: string;
};

export type RunRecord = {
  id: string;
  workflow_id: string;
  runner: RunnerName;
  status: RunStatus;
  external_id: string | null;
  spec_snapshot: WorkflowSpec;
  logs: RunLogEntry[];
  result: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type StartRunArgs = {
  runId: string;
  workflowId: string;
  spec: WorkflowSpec;
};

export type StartRunResult = {
  externalId: string | null;
  initialLogs: RunLogEntry[];
  /** Ha true → a runner szinkron befejezte (mock); ha false → később pollozzuk vagy webhookot várunk. */
  finishedSync: boolean;
  finalStatus?: RunStatus;
  finalResult?: Record<string, unknown> | null;
  finalError?: string | null;
};

export interface Runner {
  readonly name: RunnerName;
  start(args: StartRunArgs): Promise<StartRunResult>;
}
