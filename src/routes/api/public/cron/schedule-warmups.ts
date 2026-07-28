// Warmup ütemező — óránként fut, pg_cron hívja.
//
// Minden warmup workflow-hoz tartozó proxy-t megnéz:
//   - ha warmup_next_scheduled_at <= most VAGY még nincs sikeres süti-csomag,
//     ÉS warmup_running_at üres/régi, létrehoz egy brain_workflow_runs sort
//     (status=queued, proxy_id=X),
//     amit majd a VPS worker felvesz a /worker/claim endpointon,
//   - beállítja warmup_running_at = most, warmup_next_scheduled_at = null.
//
// Amikor a run befejeződik (worker/complete), külön logika a warmup után
// megújítja a warmup_next_scheduled_at-ot (~7 nap múlva random időpont).
//
// Auth: apikey header a Supabase publishable/anon kulcsával — ugyanaz a
// minta, mint a többi cron endpointon.

import { createFileRoute } from "@tanstack/react-router";

// Max hány warmup indulhat egyszerre. 1 IP = 1 böngésző = 1 workflow.
// A worker VPS (4 mag / 64 GB) 5 párhuzamos warmup böngészőt elbír, így egy
// éjszaka alatt mind a 21 ország sütigyűjtése lemehet.
const MAX_ENQUEUE_PER_TICK = 5;

// Ha egy warmup több mint 2 órája „running", elakadtnak tekintjük.
const RUNNING_TIMEOUT_MS = 2 * 60 * 60 * 1000;

// Reddit szempontból ezek a legfontosabbak: német, portugál, spanyol, arab.
// Ha több hiányzó warmup vár, ezek kerülnek előre.
const REDDIT_PRIORITY_LANGUAGES = ["de", "pt", "pt-br", "es", "ar"];
const REDDIT_PRIORITY_REGIONS = ["CH", "DE", "BR", "PT", "ES", "CO", "MX", "SA", "AE", "EG", "MA"];

function priorityScore(country: string | null, language: string | null): number {
  const lang = (language || "").toLowerCase();
  const region = (country || "").toUpperCase();
  const langIdx = REDDIT_PRIORITY_LANGUAGES.indexOf(lang);
  if (langIdx >= 0) return langIdx;
  const regionIdx = REDDIT_PRIORITY_REGIONS.indexOf(region);
  if (regionIdx >= 0) return REDDIT_PRIORITY_LANGUAGES.length + regionIdx;
  return 100;
}

export const Route = createFileRoute("/api/public/cron/schedule-warmups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
        const provided = request.headers.get("apikey")?.trim();
        if (!expected || !provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const nowIso = new Date().toISOString();
        const runningCutoff = new Date(Date.now() - RUNNING_TIMEOUT_MS).toISOString();

        // Elakadt „running" jelzők feloldása (2 óránál régebbi).
        await supabaseAdmin
          .from("proxies")
          .update({ warmup_running_at: null })
          .lt("warmup_running_at", runningCutoff);

        // Aktív proxyk. Korábban csak a warmup_next_scheduled_at <= now sorokat
        // vettük fel; ettől egy failed/cancelled warmup könnyen „eltűnt”, ha a
        // next_scheduled null lett, miközben továbbra sem volt süti-csomag.
        const { data: proxyRows, error: dueErr } = await supabaseAdmin
          .from("proxies")
          .select("id, tenant_id, country, warmup_next_scheduled_at, warmup_running_at")
          .eq("is_active", true)
          .order("warmup_next_scheduled_at", { ascending: true, nullsFirst: false })
          .limit(200);

        if (dueErr) {
          return new Response(JSON.stringify({ error: dueErr.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const enqueued: Array<{
          proxy_id: string;
          country: string;
          workflow_id: string;
          run_id: string;
        }> = [];
        const skipped: Array<{ proxy_id: string; reason: string }> = [];

        const candidates: Array<{
          proxy_id: string;
          tenant_id: string;
          country: string;
          scheduled_at: string | null;
          workflow_id: string;
          spec: Record<string, unknown>;
          language: string | null;
          missing_cookie: boolean;
          score: number;
        }> = [];

        for (const p of proxyRows ?? []) {
          if (p.warmup_running_at) continue;

          const scheduledAt = p.warmup_next_scheduled_at
            ? new Date(p.warmup_next_scheduled_at).getTime()
            : null;
          const scheduledDue = scheduledAt !== null && scheduledAt <= Date.now();

          // Warmup workflow lekérése: spec.proxy_id = p.id ÉS spec.is_warmup = true.
          // Postgrest jsonb szűrés:
          const { data: wfs } = await supabaseAdmin
            .from("workflows")
            .select("id, spec, language, cookie_jar_updated_at")
            .eq("tenant_id", p.tenant_id)
            .eq("module", "brain")
            .eq("active", true)
            .contains("spec", { is_warmup: true, proxy_id: p.id });

          const wf = wfs && wfs.length > 0 ? wfs[0] : null;
          if (!wf) {
            skipped.push({ proxy_id: p.id, reason: "no matching warmup workflow" });
            // Ne próbáljuk újra minden órában — toljuk el 24 óra múlvára.
            await supabaseAdmin
              .from("proxies")
              .update({
                warmup_next_scheduled_at: new Date(
                  Date.now() + 24 * 60 * 60 * 1000,
                ).toISOString(),
              })
              .eq("id", p.id);
            continue;
          }

          const missingCookie = !wf.cookie_jar_updated_at;
          if (!scheduledDue && !missingCookie) continue;

          const spec = (wf.spec ?? {}) as Record<string, unknown>;
          const language =
            typeof spec.language === "string"
              ? spec.language
              : typeof wf.language === "string"
                ? wf.language
                : null;

          candidates.push({
            proxy_id: p.id,
            tenant_id: p.tenant_id,
            country: (p.country || "").toUpperCase(),
            scheduled_at: p.warmup_next_scheduled_at,
            workflow_id: wf.id,
            spec,
            language,
            missing_cookie: missingCookie,
            score: priorityScore(p.country, language),
          });
        }

        candidates.sort((a, b) => {
          if (a.missing_cookie !== b.missing_cookie) return a.missing_cookie ? -1 : 1;
          if (a.score !== b.score) return a.score - b.score;
          return String(a.scheduled_at || "9999").localeCompare(String(b.scheduled_at || "9999"));
        });

        for (const p of candidates.slice(0, MAX_ENQUEUE_PER_TICK)) {
          const { data: openRun } = await supabaseAdmin
            .from("brain_workflow_runs")
            .select("id, status")
            .eq("proxy_id", p.proxy_id)
            .in("status", ["queued", "scheduled", "running"])
            .limit(1)
            .maybeSingle();

          if (openRun) {
            skipped.push({
              proxy_id: p.proxy_id,
              reason: `already has open warmup run (${openRun.status})`,
            });
            await supabaseAdmin
              .from("proxies")
              .update({ warmup_running_at: null, warmup_next_scheduled_at: null })
              .eq("id", p.proxy_id);
            continue;
          }
          const specSnapshot = { ...p.spec, proxy_id: p.proxy_id };

          const { data: run, error: rErr } = await supabaseAdmin
            .from("brain_workflow_runs")
            .insert({
              workflow_id: p.workflow_id,
              tenant_id: p.tenant_id,
              runner: "docker",
              status: "queued",
              module: "brain",
              proxy_id: p.proxy_id,
              spec_snapshot: specSnapshot as never,
            })
            .select("id")
            .single();

          if (rErr || !run) {
            skipped.push({
              proxy_id: p.proxy_id,
              reason: `run insert failed: ${rErr?.message ?? "unknown"}`,
            });
            continue;
          }

          await supabaseAdmin
            .from("proxies")
            .update({
              warmup_running_at: nowIso,
              warmup_last_run_at: nowIso,
              warmup_next_scheduled_at: null,
            })
            .eq("id", p.proxy_id);

          enqueued.push({
            proxy_id: p.proxy_id,
            country: p.country,
            workflow_id: p.workflow_id,
            run_id: run.id,
          });
        }

        return Response.json({
          ok: true,
          checked: proxyRows?.length ?? 0,
          candidates_count: candidates.length,
          enqueued_count: enqueued.length,
          skipped_count: skipped.length,
          enqueued,
          skipped,
        });
      },
    },
  },
});
