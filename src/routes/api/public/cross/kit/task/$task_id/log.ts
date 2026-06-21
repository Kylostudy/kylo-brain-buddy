/**
 * GET /api/public/cross/kit/task/$task_id/log
 *
 * Returns the event log bundle for a Kit-originated task.
 * - Verifies HMAC with KIT_BRAIN_LOG_SECRET (signed path includes the
 *   task_id segment exactly as it appears in the URL).
 * - Returns 404 if the task is unknown.
 * - Returns events oldest-first.
 */

import { createFileRoute } from "@tanstack/react-router";

import { verifyKitRequest } from "@/lib/kit-bridge.server";

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute(
  "/api/public/cross/kit/task/$task_id/log",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const taskId = params.task_id;
        const pathWithQuery = `/api/public/cross/kit/task/${encodeURIComponent(taskId)}/log`;

        const verify = verifyKitRequest(
          "log",
          "GET",
          pathWithQuery,
          "",
          request.headers,
        );
        if (!verify.ok) {
          return jsonError(verify.status, verify.reason);
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: task, error: taskErr } = await supabaseAdmin
          .from("kit_incoming_tasks")
          .select("task_id, tenant_id, task_type, status, created_at")
          .eq("task_id", taskId)
          .maybeSingle();

        if (taskErr) {
          console.error("[Kit→Brain] log task lookup failed", taskErr);
          return jsonError(500, "Database lookup failed");
        }
        if (!task) {
          return jsonError(404, "Task not found");
        }

        const { data: events, error: eventsErr } = await supabaseAdmin
          .from("kit_incoming_task_log")
          .select("event, outcome, detail, created_at")
          .eq("task_id", taskId)
          .order("created_at", { ascending: true });

        if (eventsErr) {
          console.error("[Kit→Brain] log events lookup failed", eventsErr);
          return jsonError(500, "Database lookup failed");
        }

        const bundle = {
          task_id: task.task_id,
          tenant_id: task.tenant_id,
          origin: "brain",
          task_type: task.task_type,
          status: task.status,
          created_at: task.created_at,
          events: events ?? [],
        };

        return new Response(JSON.stringify(bundle), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
