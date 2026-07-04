/**
 * POST /api/public/cross/kylogic/task
 *
 * Inbound endpoint for Kylogic → Brain task dispatch (e.g. video uploads
 * to Facebook / TikTok / YouTube).
 * - Verifies HMAC with BRAIN_KYLOGIC_TASK_SECRET (±5 min, peer "kylogic").
 * - Idempotent on task_id (Idempotency-Key header must match body.task_id).
 * - Smoke-test `task_type: "ping"` completes synchronously and fires the
 *   callback + audit push in the background.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  sendKylogicAudit,
  sendKylogicCallback,
  verifyKylogicTaskRequest,
  type KylogicCallbackPayload,
} from "@/lib/kylogic-bridge.server";

type IncomingTaskBody = {
  task_id: string;
  tenant_id: string;
  user_id?: string;
  kylogic_callback_url: string;
  task_type: string;
  payload?: unknown;
};

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidBody(b: unknown): b is IncomingTaskBody {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.task_id === "string" &&
    typeof o.tenant_id === "string" &&
    typeof o.kylogic_callback_url === "string" &&
    typeof o.task_type === "string"
  );
}

export const Route = createFileRoute("/api/public/cross/kylogic/task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();

        const verify = verifyKylogicTaskRequest(
          "POST",
          "/api/public/cross/kylogic/task",
          rawBody,
          request.headers,
        );
        if (!verify.ok) {
          return jsonError(verify.status, verify.reason);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          return jsonError(400, "Invalid JSON body");
        }
        if (!isValidBody(parsed)) {
          return jsonError(400, "Missing required fields");
        }
        const body = parsed;

        const idemp = request.headers.get("idempotency-key");
        if (idemp && idemp !== body.task_id) {
          return jsonError(400, "Idempotency-Key does not match task_id");
        }
        const tenantHeader = request.headers.get("x-tenant-id");
        if (tenantHeader && tenantHeader !== body.tenant_id) {
          return jsonError(400, "X-Tenant-ID does not match body.tenant_id");
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: existing, error: selErr } = await supabaseAdmin
          .from("kylogic_incoming_tasks")
          .select("task_id, status")
          .eq("task_id", body.task_id)
          .maybeSingle();

        if (selErr) {
          console.error("[Kylogic→Brain] task lookup failed", selErr);
          return jsonError(500, "Database lookup failed");
        }

        if (existing) {
          return new Response(
            JSON.stringify({
              ok: true,
              task_id: body.task_id,
              status: existing.status,
              idempotent_replay: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        const { error: insErr } = await supabaseAdmin
          .from("kylogic_incoming_tasks")
          .insert({
            task_id: body.task_id,
            tenant_id: body.tenant_id,
            kylogic_user_id: body.user_id ?? null,
            kylogic_callback_url: body.kylogic_callback_url,
            task_type: body.task_type,
            payload: (body.payload ?? {}) as never,
            status: "pending",
          });

        if (insErr) {
          console.error("[Kylogic→Brain] task insert failed", insErr);
          return jsonError(500, "Failed to persist task");
        }

        await supabaseAdmin.from("kylogic_incoming_task_log").insert({
          task_id: body.task_id,
          event: "task.received",
          outcome: "info",
          detail: { task_type: body.task_type },
        });

        // Fire an audit push for task.received (don't block response).
        void sendKylogicAudit({
          tenant_id: body.tenant_id,
          event: "task.received",
          task_id: body.task_id,
          detail: { task_type: body.task_type },
        }).catch((err) => {
          console.error("[Kylogic→Brain] audit push (received) failed", err);
        });

        // publish_video: filtered-mode fan-out into brain_task_queue.
        if (body.task_type === "publish_video") {
          const { handlePublishVideo, validatePublishVideoPayload } =
            await import("@/lib/kylogic-publish-video.server");

          const validated = validatePublishVideoPayload(body.payload);
          if (!validated.ok) {
            await supabaseAdmin
              .from("kylogic_incoming_tasks")
              .update({ status: "failed", result: { error: validated.error } as never })
              .eq("task_id", body.task_id);
            await supabaseAdmin.from("kylogic_incoming_task_log").insert({
              task_id: body.task_id,
              event: "task.rejected",
              outcome: "failure",
              detail: { error: validated.error },
            });
            return jsonError(400, validated.error);
          }

          const result = await handlePublishVideo({
            kylogicTaskId: body.task_id,
            tenantId: body.tenant_id,
            kylogicCallbackUrl: body.kylogic_callback_url,
            payload: validated.payload,
          });

          if (!result.ok) {
            await supabaseAdmin
              .from("kylogic_incoming_tasks")
              .update({ status: "failed", result: { error: result.error } as never })
              .eq("task_id", body.task_id);
            await supabaseAdmin.from("kylogic_incoming_task_log").insert({
              task_id: body.task_id,
              event: "task.failed",
              outcome: "failure",
              detail: { error: result.error },
            });
            return jsonError(result.status, result.error);
          }

          const summary = {
            matched_workflows: result.matched_workflows,
            fanout: result.fanout.map((r) => ({
              workflow_id: r.workflow_id,
              platform: r.platform,
              scheduled_utc: r.scheduled_utc,
              jitter_applied_seconds: r.jitter_applied_seconds,
            })),
          };

          await supabaseAdmin
            .from("kylogic_incoming_tasks")
            .update({ status: "queued", result: summary as never })
            .eq("task_id", body.task_id);

          await supabaseAdmin.from("kylogic_incoming_task_log").insert({
            task_id: body.task_id,
            event: "task.fanned_out",
            outcome: "success",
            detail: summary as never,
          });

          void sendKylogicAudit({
            tenant_id: body.tenant_id,
            event: "task.fanned_out",
            outcome: "success",
            task_id: body.task_id,
            detail: {
              matched_workflows: result.matched_workflows,
              scheduled_local: validated.payload.scheduled_local,
            },
          }).catch(() => undefined);

          return new Response(
            JSON.stringify({
              ok: true,
              task_id: body.task_id,
              status: "queued",
              ...summary,
            }),
            { status: 202, headers: { "Content-Type": "application/json" } },
          );
        }

        // Unknown task type: accepted for later async processing.
        if (body.task_type !== "ping") {
          return new Response(
            JSON.stringify({ ok: true, task_id: body.task_id, status: "pending" }),
            { status: 202, headers: { "Content-Type": "application/json" } },
          );
        }

        const result = {
          pong: true,
          received_at: new Date().toISOString(),
          echo: body.payload ?? {},
        };

        const { error: updErr } = await supabaseAdmin
          .from("kylogic_incoming_tasks")
          .update({ status: "completed", result: result as never })
          .eq("task_id", body.task_id);

        if (updErr) {
          console.error("[Kylogic→Brain] task update failed", updErr);
          return jsonError(500, "Failed to update task");
        }

        await supabaseAdmin.from("kylogic_incoming_task_log").insert({
          task_id: body.task_id,
          event: "task.completed",
          outcome: "success",
          detail: { result } as never,
        });

        const callbackPayload: KylogicCallbackPayload = {
          task_id: body.task_id,
          tenant_id: body.tenant_id,
          status: "completed",
          result,
        };

        void (async () => {
          const cb = await sendKylogicCallback(
            body.kylogic_callback_url,
            callbackPayload,
          );
          await supabaseAdmin.from("kylogic_incoming_task_log").insert({
            task_id: body.task_id,
            event: "callback.sent",
            outcome: cb.ok ? "success" : "failure",
            detail: cb.ok
              ? { status: cb.status }
              : { status: cb.status, error: cb.error, body: cb.body },
          });
          if (cb.ok) {
            await supabaseAdmin
              .from("kylogic_incoming_tasks")
              .update({ callback_sent_at: new Date().toISOString() })
              .eq("task_id", body.task_id);
          }
          await sendKylogicAudit({
            tenant_id: body.tenant_id,
            event: "task.completed",
            outcome: "success",
            task_id: body.task_id,
            detail: { callback_ok: cb.ok },
          }).catch(() => undefined);
        })().catch((err) => {
          console.error("[Kylogic→Brain] background callback threw", err);
        });

        return new Response(
          JSON.stringify({
            ok: true,
            task_id: body.task_id,
            status: "completed",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
