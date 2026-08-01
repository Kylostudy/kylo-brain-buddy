import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
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

const Body = z.object({
  runId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  recipient: z.string().email().optional(),
  freshWithinSec: z.number().min(30).max(24 * 60 * 60).optional(),
});

function readKyloRecipient(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return null;
  const kylo = (spec as { kylo_signup?: { email?: unknown } }).kylo_signup;
  return typeof kylo?.email === "string" ? kylo.email : null;
}

export const Route = createFileRoute("/api/public/worker/gmail-confirmation-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr) {
          return Response.json({ error: authErr }, { status: 401 });
        }

        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "bad request" },
            { status: 400 },
          );
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const sb = supabaseAdmin as ReturnType<typeof createClient<Database>>;

          let workflowId = body.workflowId ?? null;
          let recipient = body.recipient ?? null;

          if (body.runId) {
            const { data: run } = await sb
              .from("brain_workflow_runs")
              .select("workflow_id, spec_snapshot")
              .eq("id", body.runId)
              .maybeSingle();
            workflowId = workflowId ?? run?.workflow_id ?? null;
            recipient = recipient ?? readKyloRecipient(run?.spec_snapshot) ?? null;
          }

          if (!workflowId) {
            return Response.json({ error: "workflowId hiányzik" }, { status: 400 });
          }

          const { findVerificationLinkServer } = await import("@/lib/gmail/oauth.server");
          const found = await findVerificationLinkServer({
            workflowId,
            recipient,
            platform: "kylo",
            freshWithinSec: body.freshWithinSec ?? 6 * 60 * 60,
            maxMessages: 12,
          });

          if (!found.link) {
            return Response.json({ link: null, found: false, debug: found.debug }, { status: 200 });
          }

          return Response.json({ found: true, ...found });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Ismeretlen Gmail hiba";
          console.error("[gmail-confirmation-link] hiba", message);
          return Response.json({ link: null, found: false, error: message }, { status: 200 });
        }

      },
    },
  },
});