// Progress endpoint — a VPS orchestrator periodikusan (~2mp-enként) elküldi
// az addig gyűjtött logokat, hogy a UI-n élőben látszódjon, mi történik.
// Nem zárja le a futást; a végleges státusz továbbra is /complete-tal jön.

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
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
  runId: z.string().uuid(),
  logs: z
    .array(
      z.object({
        ts: z.string(),
        level: z.enum(["info", "warn", "error"]),
        message: z.string(),
      }),
    )
    .max(2000),
});

export const Route = createFileRoute("/api/public/worker/progress")({
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
            JSON.stringify({ error: e instanceof Error ? e.message : "bad" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Csak akkor frissítünk, ha a run még nincs lezárva (finished_at NULL).
        // Az utolsó 500 sort tartjuk meg, hogy a JSON ne híjjon meg.
        const trimmed = parsed.logs.slice(-500);
        const { error } = await supabaseAdmin
          .from("brain_workflow_runs")
          .update({
            logs: trimmed as never,
            status: "running",
          } as never)
          .eq("id", parsed.runId)
          .is("finished_at", null);

        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        return Response.json({ ok: true, count: trimmed.length });
      },
    },
  },
});
