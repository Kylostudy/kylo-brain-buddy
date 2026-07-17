// Coverage jelentés — a worker azt jelenti, hogy egy adott URL/nyelv/skin
// kombinációt bejárt. Resumable crawlhoz és a runon a total_pages_visited-hez.
// Cost delta is jelenthető ide.

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
  url: z.string(),
  language: z.string().nullable().optional(),
  skin: z.string().nullable().optional(),
  interactions_count: z.number().int().min(0).default(0),
  screenshot_hash: z.string().nullable().optional(),
  cost_delta_usd: z.number().min(0).default(0),
});

export const Route = createFileRoute("/api/public/worker/qa/report-coverage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const err = checkAuth(request);
        if (err) return new Response(JSON.stringify({ error: err }), { status: 401, headers: { "content-type": "application/json" } });
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const p = Body.safeParse(raw);
        if (!p.success) return json({ error: "bad request", details: p.error.issues }, 400);
        const d = p.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: run } = await supabaseAdmin.from("audit_qa_runs").select("tenant_id, total_pages_visited, total_cost_usd, cost_cap_usd").eq("id", d.run_id).single();
        if (!run) return json({ error: "run not found" }, 404);

        // Coverage upsert
        const { error: covErr } = await supabaseAdmin
          .from("audit_qa_coverage")
          .upsert(
            {
              run_id: d.run_id,
              tenant_id: run.tenant_id,
              url: d.url,
              language: d.language ?? null,
              skin: d.skin ?? null,
              interactions_count: d.interactions_count,
              screenshot_hash: d.screenshot_hash ?? null,
              visited_at: new Date().toISOString(),
            },
            { onConflict: "run_id,url,language,skin" },
          );
        if (covErr) return json({ error: covErr.message }, 500);

        const newCost = Number(run.total_cost_usd ?? 0) + d.cost_delta_usd;
        const newPages = (run.total_pages_visited ?? 0) + 1;
        await supabaseAdmin
          .from("audit_qa_runs")
          .update({ total_pages_visited: newPages, total_cost_usd: newCost })
          .eq("id", d.run_id);

        const capped = run.cost_cap_usd != null && newCost >= Number(run.cost_cap_usd);
        return json({ ok: true, total_pages: newPages, total_cost_usd: newCost, cost_cap_reached: capped });
      },
    },
  },
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
