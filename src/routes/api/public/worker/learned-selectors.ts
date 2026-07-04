// Worker által tanult CSS szelektorok kezelése.
// A worker HTTP-n keresztül fér hozzá — nem közvetlen Supabase-kapcsolat.
//
// POST body {action:"lookup", platform, page_type}
//   → 200 { selectors: [{ field, selector, success_count, fail_count, last_verified_at }] }
//
// POST body {action:"upsert", platform, page_type, field, selector, learned_from, success}
//   → 200 { ok:true }
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> (ugyanaz mint a claim/complete).

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

const LookupSchema = z.object({
  action: z.literal("lookup"),
  platform: z.string().min(1).max(64),
  page_type: z.string().min(1).max(64),
});

const UpsertSchema = z.object({
  action: z.literal("upsert"),
  platform: z.string().min(1).max(64),
  page_type: z.string().min(1).max(64),
  field: z.string().min(1).max(64),
  selector: z.string().min(1).max(2000),
  learned_from: z.enum(["dom_heuristic", "gemini_vision"]).default("gemini_vision"),
  success: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

const BodySchema = z.discriminatedUnion("action", [LookupSchema, UpsertSchema]);

export const Route = createFileRoute("/api/public/worker/learned-selectors")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "invalid json" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success)
          return new Response(
            JSON.stringify({ error: "bad request", details: parsed.error.issues }),
            { status: 400, headers: { "content-type": "application/json" } },
          );

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        if (parsed.data.action === "lookup") {
          const { platform, page_type } = parsed.data;
          const { data, error } = await supabaseAdmin
            .from("worker_learned_selectors")
            .select("field, selector, success_count, fail_count, last_verified_at, last_failed_at, learned_from")
            .eq("platform", platform)
            .eq("page_type", page_type);
          if (error)
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          return new Response(JSON.stringify({ selectors: data ?? [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        // upsert
        const { platform, page_type, field, selector, learned_from, success, notes } =
          parsed.data;

        // Nézzük, van-e már sor
        const { data: existing } = await supabaseAdmin
          .from("worker_learned_selectors")
          .select("id, selector, success_count, fail_count")
          .eq("platform", platform)
          .eq("page_type", page_type)
          .eq("field", field)
          .maybeSingle();

        const now = new Date().toISOString();
        if (existing) {
          // Ha ugyanaz a szelektor működött újra → success_count++
          // Ha új szelektor → csere, számlálók resetelve
          const sameSelector = existing.selector === selector;
          const nextSuccess = success ? (sameSelector ? existing.success_count + 1 : 1) : existing.success_count;
          const nextFail = success ? existing.fail_count : existing.fail_count + 1;
          const { error: updErr } = await supabaseAdmin
            .from("worker_learned_selectors")
            .update({
              selector: success ? selector : existing.selector,
              learned_from,
              success_count: nextSuccess,
              fail_count: nextFail,
              last_verified_at: success ? now : undefined,
              last_failed_at: success ? undefined : now,
              notes: notes ?? null,
            })
            .eq("id", existing.id);
          if (updErr)
            return new Response(JSON.stringify({ error: updErr.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
        } else {
          const { error: insErr } = await supabaseAdmin
            .from("worker_learned_selectors")
            .insert({
              platform,
              page_type,
              field,
              selector,
              learned_from,
              success_count: success ? 1 : 0,
              fail_count: success ? 0 : 1,
              last_verified_at: success ? now : null,
              last_failed_at: success ? null : now,
              notes: notes ?? null,
            });
          if (insErr)
            return new Response(JSON.stringify({ error: insErr.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
