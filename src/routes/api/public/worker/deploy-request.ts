// A VPS hívja meg, ha azt látja, hogy a GitHubon újabb commit van,
// mint amit a helyi kód tartalmaz. Ez teszi lehetővé, hogy a Lovable
// Publish gombja automatikusan frissítse a VPS-t is.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token

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
  workerId: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

export const Route = createFileRoute("/api/public/worker/deploy-request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        let body: z.infer<typeof Body> = {};
        try {
          body = Body.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({
              error: e instanceof Error ? e.message : "bad request",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // Ne duplikáljunk: ha már van pending vagy running kérés, visszautasítjuk.
        const { data: active, error: activeErr } = await supabaseAdmin
          .from("worker_deploy_requests")
          .select("id")
          .in("status", ["pending", "running"])
          .limit(1)
          .maybeSingle();

        if (activeErr)
          return new Response(
            JSON.stringify({ error: activeErr.message }),
            { status: 500, headers: { "content-type": "application/json" } },
          );

        if (active) {
          return new Response(
            JSON.stringify({
              ok: false,
              reason: "already-active",
              message: "Már van aktív frissítési kérés.",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        const { data: created, error: insertErr } = await supabaseAdmin
          .from("worker_deploy_requests")
          .insert({
            requested_by: null,
            worker_id: body.workerId || "worker-1",
            note:
              body.note ||
              "Automatikus frissítés: új commit érkezett a GitHubra",
            status: "pending",
          })
          .select("id,note,status,created_at")
          .single();

        if (insertErr)
          return new Response(
            JSON.stringify({ error: insertErr.message }),
            { status: 500, headers: { "content-type": "application/json" } },
          );

        return new Response(JSON.stringify({ ok: true, request: created }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
