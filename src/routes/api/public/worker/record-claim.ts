// Worker recording claim endpoint — a saját VPS workerünk hívja, hogy elkérje
// a legrégebbi 'requested' státuszú recording session-t. Atomi CAS-szel
// 'active'-ra állítja, és visszaadja a session adatait. A worker ezután
// a SUPABASE_SERVICE_ROLE_KEY-vel csatlakozik a Realtime broadcast csatornára
// (`record:<sessionId>`), és streameli a screenshotokat / fogadja a kattintásokat.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token
// Válasz: 200 { session: {...} } vagy 204 (nincs várakozó kérés)

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
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

export const Route = createFileRoute("/api/public/worker/record-claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        let body: { workerId?: string } = {};
        try {
          body = (await request.json()) as { workerId?: string };
        } catch {
          // üres body OK
        }
        const workerId = body.workerId || "unknown-worker";

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const sb = supabaseAdmin as ReturnType<typeof createClient<Database>>;

        const { data: candidate } = await sb
          .from("recording_sessions")
          .select("id, workflow_id, start_url")
          .eq("status", "requested")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!candidate) return new Response(null, { status: 204 });

        const { data: claimed, error: updErr } = await sb
          .from("recording_sessions")
          .update({
            status: "active",
            worker_id: workerId,
            started_at: new Date().toISOString(),
          })
          .eq("id", candidate.id)
          .eq("status", "requested")
          .select("id, workflow_id, start_url, started_at")
          .maybeSingle();

        if (updErr || !claimed) return new Response(null, { status: 204 });

        return new Response(
          JSON.stringify({
            session: {
              id: claimed.id,
              workflowId: claimed.workflow_id,
              startUrl: claimed.start_url,
              channel: `record:${claimed.id}`,
              startedAt: claimed.started_at,
            },
            // A worker ezekkel csatlakozik a Realtime broadcast csatornára.
            // A publishable kulcs publikus, biztonságosan kiadható.
            supabaseUrl: process.env.SUPABASE_URL,
            supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );

      },
    },
  },
});
