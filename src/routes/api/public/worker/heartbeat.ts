// Gép-életjel: a VPS orchestrator percenként beküldi a CPU/RAM/lemez/konténer
// adatokat, hogy a Brainben látszódjon, mennyi terhelést bír a worker.

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

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

const Body = z.object({
  workerId: z.string().min(1).max(120),
  cpuPercent: z.number().min(0).max(100).nullable().optional(),
  load1: z.number().min(0).max(10000).nullable().optional(),
  load5: z.number().min(0).max(10000).nullable().optional(),
  memTotalMb: z.number().int().min(0).max(10_000_000).nullable().optional(),
  memUsedMb: z.number().int().min(0).max(10_000_000).nullable().optional(),
  memPercent: z.number().min(0).max(100).nullable().optional(),
  diskPercent: z.number().min(0).max(100).nullable().optional(),
  containersRunning: z.number().int().min(0).max(10000).nullable().optional(),
  inflightJobs: z.number().int().min(0).max(10000).nullable().optional(),
  uptimeSeconds: z.number().int().min(0).nullable().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const Route = createFileRoute("/api/public/worker/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        let p: z.infer<typeof Body>;
        try {
          p = Body.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "bad" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { error } = await supabaseAdmin.from("worker_heartbeats").insert({
          worker_id: p.workerId,
          cpu_percent: p.cpuPercent ?? null,
          load1: p.load1 ?? null,
          load5: p.load5 ?? null,
          mem_total_mb: p.memTotalMb ?? null,
          mem_used_mb: p.memUsedMb ?? null,
          mem_percent: p.memPercent ?? null,
          disk_percent: p.diskPercent ?? null,
          containers_running: p.containersRunning ?? null,
          inflight_jobs: p.inflightJobs ?? null,
          uptime_seconds: p.uptimeSeconds ?? null,
          detail: (p.detail ?? {}) as never,
        } as never);

        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        // Öntisztítás: 14 napnál régebbi életjeleket nem tartjuk meg.
        if (Math.random() < 0.02) {
          const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString();
          await supabaseAdmin
            .from("worker_heartbeats")
            .delete()
            .lt("created_at", cutoff);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
