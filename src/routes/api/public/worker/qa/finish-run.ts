// Run lezárása — a worker hívja a végén.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-worker-token") ?? "").trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const Body = z.object({
  run_id: z.string().uuid(),
  status: z.enum(["completed", "failed", "stopped"]),
  final_cost_usd: z.number().min(0).nullable().optional(),
});

export const Route = createFileRoute("/api/public/worker/qa/finish-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const err = checkAuth(request);
        if (err) return new Response(JSON.stringify({ error: err }), { status: 401, headers: { "content-type": "application/json" } });
        const p = Body.safeParse(await request.json().catch(() => null));
        if (!p.success) return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: { "content-type": "application/json" } });
        const d = p.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const patch: { status: typeof d.status; finished_at: string; total_cost_usd?: number } = {
          status: d.status,
          finished_at: new Date().toISOString(),
        };
        if (d.final_cost_usd != null) patch.total_cost_usd = d.final_cost_usd;
        const { error } = await supabaseAdmin.from("audit_qa_runs").update(patch).eq("id", d.run_id);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  },
});
