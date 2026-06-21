/**
 * POST /api/public/cross/kit/task
 *
 * Inbound endpoint for Kit → Brain task dispatch.
 * - Verifies HMAC with KIT_BRAIN_TASK_SECRET (Stripe-style scheme, ±5 min).
 * - Idempotent on task_id (Idempotency-Key header == body.task_id).
 * - For the smoke-test `task_type: "ping"` we complete synchronously,
 *   log one event, and fire the callback in the background.
 *
 * Auth: bypasses Lovable's published-site auth via /api/public/* prefix;
 *       caller is verified by HMAC inside the handler.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  buildLogUrl,
  sendKitCallback,
  verifyKitRequest,
  type KitCallbackPayload,
} from "@/lib/kit-bridge.server";

type IncomingTaskBody = {
  task_id: string;
  tenant_id: string;
  user_id?: string;
  kit_callback_url: string;
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
    typeof o.kit_callback_url === "string" &&
    typeof o.task_type === "string"
  );
}

export const Route = createFileRoute("/api/public/cross/kit/task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();

        const verify = verifyKitRequest(
          "task",
          "POST",
          "/api/public/cross/kit/task",
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

        // Cross-check Idempotency-Key with task_id (defense in depth).
        const idemp = request.headers.get("idempotency-key");
        if (idemp && idemp !== body.task_id) {
          return jsonError(400, "Idempotency-Key does not match task_id");
        }
        // Cross-check X-Tenant-ID header with body.
        const tenantHeader = request.headers.get("x-tenant-id");
        if (tenantHeader && tenantHeader !== body.tenant_id) {
          return jsonError(400, "X-Tenant-ID does not match body.tenant_id");
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Idempotent insert: if task_id already exists, return its current state.
        const { data: existing, error: selErr } = await supabaseAdmin
          .from("kit_incoming_tasks")
          .select("task_id, status")
          .eq("task_id", body.task_id)
          .maybeSingle();

        if (selErr) {
          console.error("[Kit→Brain] task lookup failed", selErr);
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
          .from("kit_incoming_tasks")
          .insert({
            task_id: body.task_id,
            tenant_id: body.tenant_id,
            kit_user_id: body.user_id ?? null,
            kit_callback_url: body.kit_callback_url,
            task_type: body.task_type,
            payload: (body.payload ?? {}) as never,
            status: "pending",
          });

        if (insErr) {
          console.error("[Kit→Brain] task insert failed", insErr);
          return jsonError(500, "Failed to persist task");
        }

        await supabaseAdmin.from("kit_incoming_task_log").insert({
          task_id: body.task_id,
          event: "task.received",
          outcome: "info",
          detail: { task_type: body.task_type },
        });

        // ---- Processing -----------------------------------------------------
        // For now we only know how to handle "ping". Anything else is parked
        // in `pending` and returns 202 — a future task runner will pick it up.
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
          .from("kit_incoming_tasks")
          .update({ status: "completed", result })
          .eq("task_id", body.task_id);

        if (updErr) {
          console.error("[Kit→Brain] task update failed", updErr);
          return jsonError(500, "Failed to update task");
        }

        await supabaseAdmin.from("kit_incoming_task_log").insert({
          task_id: body.task_id,
          event: "task.completed",
          outcome: "success",
          detail: { result },
        });

        // Background callback (don't block response).
        const callbackPayload: KitCallbackPayload = {
          task_id: body.task_id,
          tenant_id: body.tenant_id,
          status: "completed",
          result,
          log_available: true,
          log_url: buildLogUrl(body.task_id),
        };

        // Intentionally not awaited.
        void (async () => {
          const cb = await sendKitCallback(body.kit_callback_url, callbackPayload);
          await supabaseAdmin.from("kit_incoming_task_log").insert({
            task_id: body.task_id,
            event: "callback.sent",
            outcome: cb.ok ? "success" : "failure",
            detail: cb.ok
              ? { status: cb.status }
              : { status: cb.status, error: cb.error, body: cb.body },
          });
          if (cb.ok) {
            await supabaseAdmin
              .from("kit_incoming_tasks")
              .update({ callback_sent_at: new Date().toISOString() })
              .eq("task_id", body.task_id);
          }
        })().catch((err) => {
          console.error("[Kit→Brain] background callback threw", err);
        });

        return new Response(
          JSON.stringify({
            ok: true,
            task_id: body.task_id,
            status: "completed",
            log_url: buildLogUrl(body.task_id),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
