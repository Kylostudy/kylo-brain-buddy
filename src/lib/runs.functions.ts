import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { WorkflowSpec } from "@/lib/chat.functions";
import type { RunLogEntry, RunnerName } from "@/lib/runners/types";

function serverSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Új futtatás indítása — runner-agnosztikus.
 * 1) Beolvassa a workflow specet (snapshot).
 * 2) Beszúr egy `workflow_runs` sort `queued` státusszal.
 * 3) Behívja a docker runnert (sorba teszi a saját VPS worker számára).
 * 4) Frissíti a sort az eredménnyel.
 */
export const startRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        runner: z.enum(["docker", "local-mock"]).default("docker"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = serverSupabase();

    // 1) Spec snapshot
    const { data: wf, error: wfErr } = await supabase
      .from("workflows")
      .select("spec")
      .eq("id", data.workflowId)
      .single();
    if (wfErr) throw new Error(wfErr.message);
    const spec = (wf?.spec as WorkflowSpec | null) ?? {};

    // 2) Run sor létrehozása
    const startedAt = new Date().toISOString();
    const { data: created, error: insErr } = await supabase
      .from("brain_workflow_runs")
      .insert({
        workflow_id: data.workflowId,
        runner: data.runner as RunnerName,
        status: "running",
        spec_snapshot: spec as never,
        started_at: startedAt,
        logs: [
          {
            ts: startedAt,
            level: "info",
            message: `Futtatás indítva — runner: ${data.runner}`,
          },
        ] as never,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    const runId = created!.id;

    // 3) Runner kiválasztása + indítása
    const runner = (await import("@/lib/runners/docker.server")).dockerRunner;

    // Credential státusz lekérése (nem fejtjük vissza, csak jelezzük a logban)
    const { data: credRow } = await supabase
      .from("workflow_credentials")
      .select("platform, username, password_ciphertext, cookie_ciphertext, proxy_ciphertext")
      .eq("workflow_id", data.workflowId)
      .maybeSingle();
    const credStatus = credRow
      ? `${credRow.platform}/${credRow.username} (${credRow.password_ciphertext ? "jelszó✓" : "jelszó✗"}, ${credRow.cookie_ciphertext ? "cookie✓" : "cookie✗"}, ${credRow.proxy_ciphertext ? "proxy✓" : "proxy✗"})`
      : "nincs mentve";

    try {
      const result = await runner.start({
        runId,
        workflowId: data.workflowId,
        spec,
        hasCredentials: !!credRow,
        credentialsLabel: credStatus,
      });

      // 4) Frissítés az eredménnyel
      const finishedAt = result.finishedSync ? new Date().toISOString() : null;
      const finalLogs: RunLogEntry[] = [
        {
          ts: startedAt,
          level: "info",
          message: `Futtatás indítva — runner: ${runner.name}`,
        },
        ...result.initialLogs,
      ];

      const { error: updErr } = await supabase
        .from("brain_workflow_runs")
        .update({
          status: result.finishedSync ? (result.finalStatus ?? "succeeded") : "running",
          external_id: result.externalId,
          logs: finalLogs as never,
          result: (result.finalResult ?? null) as never,
          error: result.finalError ?? null,
          finished_at: finishedAt,
        })
        .eq("id", runId);
      if (updErr) console.error("Run update error", updErr);

      return { runId, status: result.finishedSync ? result.finalStatus : "running" };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ismeretlen hiba";
      await supabase
        .from("brain_workflow_runs")
        .update({
          status: "failed",
          error: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      throw e;
    }
  });

export const cancelRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ runId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = serverSupabase();
    const { error } = await supabase
      .from("brain_workflow_runs")
      .update({
        status: "cancelled",
        finished_at: new Date().toISOString(),
      })
      .eq("id", data.runId)
      .in("status", ["queued", "running"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
