// Warmup ütemező — óránként fut, pg_cron hívja.
//
// Minden warmup workflow-hoz tartozó proxy-t megnéz:
//   - ha warmup_next_scheduled_at <= most ÉS warmup_running_at üres/régi,
//     létrehoz egy brain_workflow_runs sort (status=queued, proxy_id=X),
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
// A worker sorosan hívja a claim endpointot, ezért nem akarunk sok queued sort
// egyszerre — max 3 futhat / várhat, a többi majd a következő órában.
const MAX_ENQUEUE_PER_TICK = 3;

// Ha egy warmup több mint 2 órája „running", elakadtnak tekintjük.
const RUNNING_TIMEOUT_MS = 2 * 60 * 60 * 1000;

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

        // Esedékes proxyk — warmup_next <= now, jelenleg nem fut, aktív.
        const { data: due, error: dueErr } = await supabaseAdmin
          .from("proxies")
          .select("id, tenant_id, country, warmup_next_scheduled_at")
          .lte("warmup_next_scheduled_at", nowIso)
          .is("warmup_running_at", null)
          .eq("is_active", true)
          .order("warmup_next_scheduled_at", { ascending: true })
          .limit(MAX_ENQUEUE_PER_TICK);

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

        for (const p of due ?? []) {
          // Warmup workflow lekérése: spec.proxy_id = p.id ÉS spec.is_warmup = true.
          // Postgrest jsonb szűrés:
          const { data: wfs } = await supabaseAdmin
            .from("workflows")
            .select("id, spec")
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

          const spec = (wf.spec ?? {}) as Record<string, unknown>;
          const specSnapshot = { ...spec, proxy_id: p.id };

          const { data: run, error: rErr } = await supabaseAdmin
            .from("brain_workflow_runs")
            .insert({
              workflow_id: wf.id,
              tenant_id: p.tenant_id,
              runner: "docker",
              status: "queued",
              module: "brain",
              proxy_id: p.id,
              spec_snapshot: specSnapshot as never,
            })
            .select("id")
            .single();

          if (rErr || !run) {
            skipped.push({
              proxy_id: p.id,
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
            .eq("id", p.id);

          enqueued.push({
            proxy_id: p.id,
            country: (p.country || "").toUpperCase(),
            workflow_id: wf.id,
            run_id: run.id,
          });
        }

        return Response.json({
          ok: true,
          checked: due?.length ?? 0,
          enqueued_count: enqueued.length,
          skipped_count: skipped.length,
          enqueued,
          skipped,
        });
      },
    },
  },
});
