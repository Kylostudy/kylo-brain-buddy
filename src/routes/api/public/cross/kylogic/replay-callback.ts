/**
 * POST /api/public/cross/kylogic/replay-callback
 *
 * Operator-only: re-fires the Brain→Kylogic task callback for an existing
 * completed task. Used to recover from a dropped background callback
 * (Cloudflare Worker background promise cancelled when the parent request
 * returned before fetch resolved).
 *
 * Auth: header X-Replay-Token must equal BRAIN_KYLOGIC_TASK_SECRET.
 * Body: { "task_id": "tsk_..." }
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  sendKylogicCallback,
  type KylogicCallbackPayload,
} from "@/lib/kylogic-bridge.server";

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute(
  "/api/public/cross/kylogic/replay-callback",
)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.BRAIN_KYLOGIC_TASK_SECRET;
        if (!expected) return jsonError(500, "Secret not configured");
        const tok = request.headers.get("x-replay-token");
        if (!tok || tok !== expected) return jsonError(401, "Unauthorized");

        let body: { task_id?: string };
        try {
          body = (await request.json()) as { task_id?: string };
        } catch {
          return jsonError(400, "Invalid JSON");
        }
        if (!body.task_id) return jsonError(400, "task_id required");

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: task, error } = await supabaseAdmin
          .from("kylogic_incoming_tasks")
          .select(
            "task_id, tenant_id, kylogic_callback_url, status, result",
          )
          .eq("task_id", body.task_id)
          .maybeSingle();

        if (error) return jsonError(500, `DB read failed: ${error.message}`);
        if (!task) return jsonError(404, "Task not found");

        const payload: KylogicCallbackPayload = {
          task_id: task.task_id,
          tenant_id: task.tenant_id,
          status: task.status === "failed" ? "failed" : "completed",
          result: task.result ?? undefined,
        };

        const cb = await sendKylogicCallback(
          task.kylogic_callback_url,
          payload,
        );

        await supabaseAdmin.from("kylogic_incoming_task_log").insert({
          task_id: task.task_id,
          event: "callback.replayed",
          outcome: cb.ok ? "success" : "failure",
          detail: cb.ok
            ? { status: cb.status }
            : { status: cb.status, error: cb.error, body: cb.body },
        });

        if (cb.ok) {
          await supabaseAdmin
            .from("kylogic_incoming_tasks")
            .update({ callback_sent_at: new Date().toISOString() })
            .eq("task_id", task.task_id);
        }

        return new Response(
          JSON.stringify({
            ok: cb.ok,
            status: cb.status,
            error: cb.ok ? undefined : cb.error,
            body: cb.ok ? undefined : cb.body,
            callback_url: task.kylogic_callback_url,
            payload,
          }),
          {
            status: cb.ok ? 200 : 502,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
