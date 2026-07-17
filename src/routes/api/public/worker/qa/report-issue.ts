// A worker minden talált hibát ide küld. Dedupe: (run_id, dedupe_hash) UNIQUE →
// duplikátumnál csak az occurrence_count nő.

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual, createHash } from "node:crypto";
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
  severity: z.enum(["critical", "major", "minor", "info"]),
  category: z.enum([
    "translation_missing",
    "translation_wrong",
    "contrast",
    "missing_back_button",
    "broken_layout",
    "clipped_text",
    "navigation_dead_end",
    "console_error",
    "other",
  ]),
  language: z.string().nullable().optional(),
  skin: z.string().nullable().optional(),
  page_url: z.string(),
  page_title: z.string().nullable().optional(),
  expected_language: z.string().nullable().optional(),
  detected_language: z.string().nullable().optional(),
  problematic_text: z.string().nullable().optional(),
  selector: z.string().nullable().optional(),
  dom_context: z.record(z.unknown()).nullable().optional(),
  ai_diagnosis: z.string().nullable().optional(),
  ai_suggested_fix: z.string().nullable().optional(),
  screenshot_path: z.string().nullable().optional(),
});

export const Route = createFileRoute("/api/public/worker/qa/report-issue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const err = checkAuth(request);
        if (err) return json({ error: err }, 401);
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) return json({ error: "bad request", details: parsed.error.issues }, 400);
        const d = parsed.data;

        // dedupe_hash: category + normalizált path + problematic_text lényege
        const path = (() => {
          try {
            return new URL(d.page_url).pathname;
          } catch {
            return d.page_url;
          }
        })();
        const hash = createHash("sha1")
          .update(
            [
              d.category,
              path,
              d.language ?? "",
              d.skin ?? "",
              (d.problematic_text ?? "").slice(0, 120).toLowerCase().trim(),
              (d.selector ?? "").slice(0, 80),
            ].join("|"),
          )
          .digest("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Tenant a runról
        const { data: run } = await supabaseAdmin
          .from("audit_qa_runs")
          .select("tenant_id")
          .eq("id", d.run_id)
          .single();
        if (!run) return json({ error: "run not found" }, 404);

        // Upsert dedupe kulcson
        const { data: existing } = await supabaseAdmin
          .from("audit_qa_issues")
          .select("id, occurrence_count")
          .eq("run_id", d.run_id)
          .eq("dedupe_hash", hash)
          .maybeSingle();

        if (existing) {
          await supabaseAdmin
            .from("audit_qa_issues")
            .update({ occurrence_count: (existing.occurrence_count ?? 1) + 1 })
            .eq("id", existing.id);
          return json({ id: existing.id, deduplicated: true });
        }

        const { data: inserted, error: insErr } = await supabaseAdmin
          .from("audit_qa_issues")
          .insert({
            run_id: d.run_id,
            tenant_id: run.tenant_id,
            severity: d.severity,
            category: d.category,
            language: d.language ?? null,
            skin: d.skin ?? null,
            page_url: d.page_url,
            page_title: d.page_title ?? null,
            expected_language: d.expected_language ?? null,
            detected_language: d.detected_language ?? null,
            problematic_text: d.problematic_text ?? null,
            selector: d.selector ?? null,
            dom_context: d.dom_context ?? null,
            ai_diagnosis: d.ai_diagnosis ?? null,
            ai_suggested_fix: d.ai_suggested_fix ?? null,
            screenshot_path: d.screenshot_path ?? null,
            dedupe_hash: hash,
          })
          .select("id")
          .single();
        if (insErr) return json({ error: insErr.message }, 500);

        // Számláló emelés a runon
        await supabaseAdmin.rpc("audit_qa_run_bump_counts", { _run_id: d.run_id, _issues: 1, _pages: 0, _cost: 0 }).then(
          () => {},
          async () => {
            // fallback: közvetlen update, ha az rpc nincs
            const { data: r } = await supabaseAdmin.from("audit_qa_runs").select("total_issues_found").eq("id", d.run_id).single();
            if (r) {
              await supabaseAdmin
                .from("audit_qa_runs")
                .update({ total_issues_found: (r.total_issues_found ?? 0) + 1 })
                .eq("id", d.run_id);
            }
          },
        );

        return json({ id: inserted?.id, deduplicated: false });
      },
    },
  },
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
