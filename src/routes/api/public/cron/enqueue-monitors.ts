// Monitor cron — időzített workflow-k (decathlon-stock stb.) sorba állítása.
// pg_cron 5 percenként hívja. Mindenkit lekér, akinek
//   spec.monitor_type valamilyen monitor-típus
//   és spec.schedule_minutes szerint esedékes az utolsó futása óta.
// Új workflow_runs sort szúr be queued státusszal — a VPS worker felveszi.
//
// Nincs külön auth header: a route a /api/public/* alatt van, de a body-ban
// kérünk egy közös titkot (CRON_SHARED_SECRET vagy WORKER_API_TOKEN), hogy
// idegenek ne tudják triggerelni.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const MONITOR_TYPES = new Set(["decathlon-stock"]);

export const Route = createFileRoute("/api/public/cron/enqueue-monitors")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.WORKER_API_TOKEN;
        let body: { secret?: string } = {};
        try {
          body = (await request.json()) as { secret?: string };
        } catch {
          // üres body OK
        }
        if (!token || body.secret !== token) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const sb = supabaseAdmin as ReturnType<typeof createClient<Database>>;

        const { data: workflows } = await sb
          .from("workflows")
          .select("id, spec, status")
          .neq("status", "archived");

        const enqueued: string[] = [];
        const skipped: string[] = [];

        for (const wf of workflows ?? []) {
          const spec = (wf.spec ?? {}) as Record<string, unknown>;
          const monitorType = String(spec.monitor_type ?? "");
          if (!MONITOR_TYPES.has(monitorType)) continue;
          const scheduleMinutes = Number(spec.schedule_minutes ?? 0);
          if (!scheduleMinutes || scheduleMinutes < 1) continue;

          // Utolsó futás ideje (queued / running / bármi)
          const { data: lastRun } = await sb
            .from("workflow_runs")
            .select("created_at, status")
            .eq("workflow_id", wf.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          // Ha még fut / sorban áll → ne dupláljuk
          if (lastRun && (lastRun.status === "queued" || lastRun.status === "running")) {
            skipped.push(wf.id);
            continue;
          }

          const lastTs = lastRun ? new Date(lastRun.created_at).getTime() : 0;
          const dueAt = lastTs + scheduleMinutes * 60_000;
          if (Date.now() < dueAt) {
            skipped.push(wf.id);
            continue;
          }

          const { error } = await sb.from("workflow_runs").insert({
            workflow_id: wf.id,
            runner: "docker",
            status: "queued",
            spec_snapshot: spec as never,
            logs: [
              {
                ts: new Date().toISOString(),
                level: "info",
                message: `Időzített monitor sorba téve (${monitorType}).`,
              },
            ] as never,
          });
          if (error) {
            console.error("enqueue insert error", error);
            skipped.push(wf.id);
          } else {
            enqueued.push(wf.id);
          }
        }

        return Response.json({ ok: true, enqueued, skipped });
      },
    },
  },
});
