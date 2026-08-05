// A VPS deploy-őr (kylo-deploy.sh) percenként ideszól: van-e kért frissítés?
// Ha van, ez a végpont "running" állapotba teszi és visszaadja.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token
// Válasz: 200 { request: {...} } vagy 204 (nincs teendő)

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function checkAuth(request: Request): string | null {
  const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ")
      ? header.slice(7)
      : request.headers.get("x-worker-token") ?? ""
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

export const Route = createFileRoute("/api/public/worker/deploy-claim")({
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
          /* üres body OK */
        }
        const workerId = body.workerId || "worker-1";

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: pending, error: selErr } = await supabaseAdmin
          .from("worker_deploy_requests")
          .select("id,note,created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (selErr)
          return new Response(JSON.stringify({ error: selErr.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        if (!pending) return new Response(null, { status: 204 });

        // Optimista lefoglalás: csak akkor visszük el, ha még mindig pending.
        const { data: claimed, error: updErr } = await supabaseAdmin
          .from("worker_deploy_requests")
          .update({
            status: "running",
            worker_id: workerId,
            started_at: new Date().toISOString(),
          })
          .eq("id", pending.id)
          .eq("status", "pending")
          .select("id,note,created_at")
          .maybeSingle();

        if (updErr)
          return new Response(JSON.stringify({ error: updErr.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        if (!claimed) return new Response(null, { status: 204 });

        return new Response(JSON.stringify({ request: claimed }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
