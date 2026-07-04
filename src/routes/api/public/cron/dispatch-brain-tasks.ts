// Brain task dispatcher — a brain_task_queue (Kylogic-ból érkező taszkok)
// esedékes sorait átemeli brain_workflow_runs-ra, hogy a VPS worker fel tudja
// venni őket a claim endpointon keresztül.
//
// pg_cron 1 percenként hívja. Body-ban közös titok (WORKER_API_TOKEN) kell,
// hogy idegenek ne triggerelhessék.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const MAX_BATCH = 25;

export const Route = createFileRoute("/api/public/cron/dispatch-brain-tasks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: expects the Supabase publishable/anon key in the `apikey`
        // header (matches the pg_cron caller). This route lives under
        // /api/public/* so the platform bypasses its auth — we do the check
        // ourselves against a low-risk, non-secret key.
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
        const provided = request.headers.get("apikey")?.trim();
        if (!expected || !provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }


        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const sb = supabaseAdmin as ReturnType<typeof createClient<Database>>;

        const nowIso = new Date().toISOString();

        // 1) Fetch due, still-queued task queue rows.
        const { data: due, error: dueErr } = await sb
          .from("brain_task_queue")
          .select(
            "id, tenant_id, workflow_id, task_type, platform, language, region, payload, scheduled_utc, kylogic_task_id, kylogic_callback_url",
          )
          .eq("status", "queued")
          .lte("scheduled_utc", nowIso)
          .order("scheduled_utc", { ascending: true })
          .limit(MAX_BATCH);

        if (dueErr) {
          return new Response(
            JSON.stringify({ error: dueErr.message }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        const dispatched: Array<{ task_id: string; run_id: string }> = [];
        const skipped: Array<{ task_id: string; reason: string }> = [];

        for (const task of due ?? []) {
          // Look up workflow spec + runner + proxy binding.
          const { data: wf } = await sb
            .from("workflows")
            .select("id, spec, tenant_id, platform, region")
            .eq("id", task.workflow_id)
            .maybeSingle();

          if (!wf) {
            skipped.push({ task_id: task.id, reason: "workflow not found" });
            await sb
              .from("brain_task_queue")
              .update({
                status: "failed",
                error: "workflow not found at dispatch time",
                completed_at: new Date().toISOString(),
              })
              .eq("id", task.id);
            continue;
          }

          // Compose spec_snapshot: base workflow spec + Kylogic task payload
          // wrapped under `brain_task` so executor scripts know what to do.
          const baseSpec =
            wf.spec && typeof wf.spec === "object"
              ? { ...(wf.spec as Record<string, unknown>) }
              : {};
          const specSnapshot: Record<string, unknown> = {
            ...baseSpec,
            platform: wf.platform ?? baseSpec.platform ?? null,
            region: wf.region ?? baseSpec.region ?? null,
            brain_task: {
              task_id: task.id,
              kylogic_task_id: task.kylogic_task_id,
              task_type: task.task_type,
              payload: task.payload,
              platform: task.platform,
              language: task.language,
              region: task.region,
            },
          };

          // Attempt to atomically claim the task (queued → running).
          const { data: claimed, error: claimErr } = await sb
            .from("brain_task_queue")
            .update({ status: "running", started_at: new Date().toISOString() })
            .eq("id", task.id)
            .eq("status", "queued")
            .select("id")
            .maybeSingle();

          if (claimErr || !claimed) {
            skipped.push({ task_id: task.id, reason: "already claimed" });
            continue;
          }

          // Create the workflow_runs row with the brain_task_id link.
          const { data: runRow, error: insErr } = await sb
            .from("brain_workflow_runs")
            .insert({
              workflow_id: task.workflow_id,
              tenant_id: task.tenant_id,
              runner: "docker",
              status: "queued",
              spec_snapshot: specSnapshot as never,
              brain_task_id: task.id,
            })
            .select("id")
            .single();

          if (insErr || !runRow) {
            // Rollback the task row so a later dispatch can retry.
            await sb
              .from("brain_task_queue")
              .update({
                status: "queued",
                started_at: null,
                error: `dispatch failed: ${insErr?.message ?? "unknown"}`,
              })
              .eq("id", task.id);
            skipped.push({
              task_id: task.id,
              reason: `run insert failed: ${insErr?.message ?? "unknown"}`,
            });
            continue;
          }

          dispatched.push({ task_id: task.id, run_id: runRow.id });
        }

        return Response.json({
          ok: true,
          checked: due?.length ?? 0,
          dispatched_count: dispatched.length,
          skipped_count: skipped.length,
          dispatched,
          skipped,
        });
      },
    },
  },
});
