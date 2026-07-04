// Worker run completion endpoint — a VPS worker hívja, amikor a futás befejeződött
// (sikeres, hibára futott, vagy megszakadt). A logokat és a végeredményt írja vissza.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ")
      ? header.slice(7)
      : request.headers.get("x-worker-token") ?? request.headers.get("x-api-key") ?? ""
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const Body = z.object({
  runId: z.string().uuid(),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  logs: z
    .array(
      z.object({
        ts: z.string(),
        level: z.enum(["info", "warn", "error"]),
        message: z.string(),
      }),
    )
    .default([]),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  preflight: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const Route = createFileRoute("/api/public/worker/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "bad request" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const sb = supabaseAdmin as ReturnType<typeof createClient<Database>>;

        const update: Record<string, unknown> = {
          status: parsed.status,
          logs: parsed.logs as never,
          result: (parsed.result ?? null) as never,
          error: parsed.error ?? null,
          finished_at: new Date().toISOString(),
        };
        if (parsed.preflight !== undefined) {
          update.preflight_result = parsed.preflight as never;
        }

        const { data: runRow, error } = await sb
          .from("brain_workflow_runs")
          .update(update as never)
          .eq("id", parsed.runId)
          .select("id, brain_task_id, tenant_id")
          .maybeSingle();


        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        // Monitor workflow utófeldolgozás (Decathlon stb.) — később bővül.
        try {
          const { handleRunCompletion } = await import(
            "@/lib/monitors/dispatch.server"
          );
          await handleRunCompletion(parsed.runId);
        } catch (e) {
          // ne dőljön meg a worker-complete, ha az értesítés hibára fut
          console.error("monitor dispatch error", e);
        }

        // Kylogic-task callback: ha a run egy brain_task_queue sorhoz tartozik,
        // frissítjük a task státuszát és kilövünk egy callbacket Kylogicnak.
        if (runRow?.brain_task_id) {
          try {
            const { data: taskRow } = await sb
              .from("brain_task_queue")
              .select(
                "id, kylogic_task_id, tenant_id, task_type, kylogic_callback_url, status",
              )
              .eq("id", runRow.brain_task_id)
              .maybeSingle();

            if (taskRow) {
              const finalStatus =
                parsed.status === "succeeded" ? "succeeded" : "failed";

              await sb
                .from("brain_task_queue")
                .update({
                  status: finalStatus,
                  result: (parsed.result ?? null) as never,
                  error: parsed.error ?? null,
                  completed_at: new Date().toISOString(),
                })
                .eq("id", taskRow.id);

              // Callback push — Kylogic elvárt shape-je.
              const { sendKylogicCallback, sendKylogicAudit } = await import(
                "@/lib/kylogic-bridge.server"
              );
              const cb = await sendKylogicCallback(taskRow.kylogic_callback_url, {
                task_id: taskRow.kylogic_task_id,
                tenant_id: taskRow.tenant_id,
                status: finalStatus === "succeeded" ? "completed" : "failed",
                result: parsed.result ?? undefined,
                error: parsed.error ?? undefined,
              });

              await sb.from("kylogic_incoming_task_log").insert({
                task_id: taskRow.kylogic_task_id,
                event: cb.ok ? "callback.sent" : "callback.failed",
                outcome: cb.ok ? "success" : "failure",
                detail: cb.ok
                  ? { status: cb.status, task_type: taskRow.task_type }
                  : {
                      status: cb.status,
                      error: cb.error,
                      body: (cb as { body?: string }).body,
                      task_type: taskRow.task_type,
                    },
              });

              await sendKylogicAudit({
                tenant_id: taskRow.tenant_id,
                event: `task.${finalStatus}`,
                outcome: finalStatus === "succeeded" ? "success" : "failure",
                task_id: taskRow.kylogic_task_id,
                detail: { task_type: taskRow.task_type, callback_ok: cb.ok },
              }).catch(() => undefined);
            }
          } catch (e) {
            console.error("[worker/complete] Kylogic callback flow failed", e);
          }
        }



        return Response.json({ ok: true });
      },
    },
  },
});
