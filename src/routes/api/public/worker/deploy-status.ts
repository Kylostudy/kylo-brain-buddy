// A deploy szkript ide küldi vissza a haladást és a végeredményt,
// hogy a Brainben élőben látszódjon a frissítés menete.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token

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
  id: z.string().uuid(),
  status: z.enum(["running", "succeeded", "failed"]),
  log: z.string().max(200_000).optional(),
  error: z.string().max(10_000).nullable().optional(),
  activeColor: z.string().max(20).nullable().optional(),
});

export const Route = createFileRoute("/api/public/worker/deploy-status")({
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

        const patch: {
          status: string;
          log?: string;
          error?: string | null;
          active_color?: string | null;
          finished_at?: string;
        } = { status: p.status };
        if (p.log !== undefined) patch.log = p.log;
        if (p.error !== undefined) patch.error = p.error;
        if (p.activeColor !== undefined) patch.active_color = p.activeColor;
        if (p.status !== "running") patch.finished_at = new Date().toISOString();

        const { error } = await supabaseAdmin
          .from("worker_deploy_requests")
          .update(patch)
          .eq("id", p.id);

        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
