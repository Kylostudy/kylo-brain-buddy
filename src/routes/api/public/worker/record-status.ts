// Worker recording status endpoint — a VPS recorder hívja másodpercenként,
// hogy megnézze, kell-e leállni (stop/cancel a UI-ból), és hogy hiba esetén
// beállíthassa a session-t failed-re. Így nem kell SUPABASE_SERVICE_ROLE_KEY-t
// kiadni a VPS-re; a worker csak BRAIN_URL + WORKER_API_TOKEN-nel dolgozik.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN>
// POST body:
//   { sessionId: string, markFailed?: { error: string } }
// Válasz: 200 { status: "active" | "stopping" | "completed" | "cancelled" | "failed" | "missing" }

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN;
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const Body = z.object({
  sessionId: z.string().uuid(),
  markFailed: z
    .object({
      error: z.string().max(500),
    })
    .optional(),
});

export const Route = createFileRoute("/api/public/worker/record-status")({
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

        if (parsed.markFailed) {
          await sb
            .from("recording_sessions")
            .update({
              status: "failed",
              error: parsed.markFailed.error,
              ended_at: new Date().toISOString(),
            })
            .eq("id", parsed.sessionId)
            .in("status", ["active", "requested"]);
        }

        const { data } = await sb
          .from("recording_sessions")
          .select("status")
          .eq("id", parsed.sessionId)
          .maybeSingle();

        return new Response(
          JSON.stringify({ status: data?.status ?? "missing" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
