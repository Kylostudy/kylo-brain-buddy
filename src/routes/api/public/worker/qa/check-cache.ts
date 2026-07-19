// Diff-mód cache lookup. A worker minden oldal előtt behívja a page signature-t
// (sha1(pathname + dom texts)). Ha egy korábbi BEFEJEZETT run ugyanezt a
// (tenant, language, skin, signature, page_url) kombót már elemezte, akkor
// visszaadjuk a korábbi issue-kat, és a worker ezeket klónozza az új run-ba
// anélkül, hogy Gemint hívna. Óriási költségmegtakarítás ismételt futtatáskor.
//
// POST { run_id, page_url, language, skin, page_signature }
//   -> 200 { hit: bool, source_run_id?: string, issues?: [...] }
//
// Auth: Bearer WORKER_API_TOKEN

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
  page_url: z.string(),
  language: z.string().nullable().optional(),
  skin: z.string().nullable().optional(),
  page_signature: z.string().min(8).max(128),
});

export const Route = createFileRoute("/api/public/worker/qa/check-cache")({
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
        const p = Body.safeParse(raw);
        if (!p.success) return json({ error: "bad request", details: p.error.issues }, 400);
        const d = p.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: run } = await supabaseAdmin
          .from("audit_qa_runs")
          .select("tenant_id")
          .eq("id", d.run_id)
          .maybeSingle();
        if (!run) return json({ error: "run not found" }, 404);

        // Keressünk egy korábbi BEFEJEZETT runt ugyanazon tenantnál, ahol a
        // coverage sor page_signature-je egyezik és a nyelv+skin+url is stimmel.
        let covQ = supabaseAdmin
          .from("audit_qa_coverage")
          .select("run_id, url, visited_at, audit_qa_runs!inner(status, tenant_id)")
          .eq("tenant_id", run.tenant_id)
          .eq("screenshot_hash", d.page_signature)
          .eq("url", d.page_url)
          .neq("run_id", d.run_id)
          .eq("audit_qa_runs.status", "completed")
          .order("visited_at", { ascending: false })
          .limit(1);
          
          covQ = d.language ? covQ.eq("language", d.language) : covQ.is("language", null);
          covQ = d.skin ? covQ.eq("skin", d.skin) : covQ.is("skin", null);

        const { data: covRows, error: covErr } = await covQ;
        if (covErr) return json({ error: covErr.message }, 500);
        const prev = covRows?.[0];
        if (!prev) return json({ hit: false });

        // Betöltjük a korábbi run azon issue-jait, amik ehhez a URL/lang/skin
        // hármashoz tartoznak. Csak az érdemi mezőket adjuk vissza.
        let issQ = supabaseAdmin
          .from("audit_qa_issues")
          .select(
            "severity, category, language, skin, page_url, page_title, expected_language, detected_language, problematic_text, selector, ai_diagnosis, ai_suggested_fix, screenshot_path",
          )
          .eq("run_id", prev.run_id)
          .eq("page_url", d.page_url);
        issQ = d.language ? issQ.eq("language", d.language) : issQ.is("language", null);
        issQ = d.skin ? issQ.eq("skin", d.skin) : issQ.is("skin", null);

        const { data: issues, error: issErr } = await issQ;
        if (issErr) return json({ error: issErr.message }, 500);

        return json({
          hit: true,
          source_run_id: prev.run_id,
          issues: issues ?? [],
        });
      },
    },
  },
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
