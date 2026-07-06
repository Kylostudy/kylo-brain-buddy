import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkflowSpec } from "@/lib/chat.functions";
import type { RunLogEntry, RunnerName } from "@/lib/runners/types";

/**
 * Új futtatás indítása — runner-agnosztikus.
 * 1) Beolvassa a workflow specet (snapshot).
 * 2) Beszúr egy `brain_workflow_runs` sort `queued` státusszal.
 * 3) Behívja a docker runnert (sorba teszi a saját VPS worker számára).
 * 4) Frissíti a sort az eredménnyel.
 *
 * TODO (Audit modul): ha workflow.module === 'audit', a sor `audit_workflow_runs`-ba kell menjen,
 * és a runner egy RobotProfile-t használjon HumanProfile helyett. Lásd src/lib/behavior/.
 */

export const startRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        runner: z.enum(["docker", "local-mock"]).default("docker"),
        proxyId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // 1) Spec snapshot + tenant_id a workflow-ból (RLS-hez kötelező)
    const { data: wf, error: wfErr } = await supabase
      .from("workflows")
      .select("spec, tenant_id, module")
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
        tenant_id: wf!.tenant_id,
        module: wf!.module,
        runner: data.runner as RunnerName,
        status: "running",
        spec_snapshot: spec as never,
        proxy_id: data.proxyId ?? null,
        started_at: startedAt,
        logs: [
          {
            ts: startedAt,
            level: "info",
            message: `Futtatás indítva — runner: ${data.runner}${data.proxyId ? " · proxy csatolva" : " · proxy nélkül"}`,
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ runId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
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

/**
 * Felvétel-lejátszó login futás. A workflow spec-jébe injektál egy
 * `brain_task: { task_type: "record_replay_login" }` blokkot, majd a normál
 * `queued` run flow-n keresztül a saját VPS workerünk elveszi és lejátssza
 * a `recorded_actions` sorozatot. A végén a friss cookie-k automatikusan
 * beíródnak titkosítva a workflow_credentials-be (worker/complete flow).
 */
export const startReplayLoginRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        proxyId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: wf, error: wfErr } = await supabase
      .from("workflows")
      .select("spec, tenant_id, module")
      .eq("id", data.workflowId)
      .single();
    if (wfErr) throw new Error(wfErr.message);
    const baseSpec = (wf?.spec as WorkflowSpec | null) ?? {};
    const actions = (baseSpec as { recorded_actions?: unknown[] }).recorded_actions;
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new Error("Nincs felvett flow ezen a workflow-n — előbb rögzíts egy login felvételt.");
    }

    // Beleinjektáljuk a brain_task jelzőt — a router ebből dönt.
    const specSnapshot = {
      ...baseSpec,
      brain_task: {
        task_type: "record_replay_login",
        platform: baseSpec.platform || null,
      },
    };

    const startedAt = new Date().toISOString();
    const { data: created, error: insErr } = await supabase
      .from("brain_workflow_runs")
      .insert({
        workflow_id: data.workflowId,
        tenant_id: wf!.tenant_id,
        module: wf!.module,
        runner: "docker",
        status: "queued",
        spec_snapshot: specSnapshot as never,
        proxy_id: data.proxyId ?? null,
        started_at: startedAt,
        logs: [
          {
            ts: startedAt,
            level: "info",
            message: `Login-felvétel lejátszása sorba téve — ${actions.length} lépés, a worker fogja végrehajtani.`,
          },
        ] as never,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    return { runId: created!.id, status: "queued" as const, stepCount: actions.length };
  });
