// Érdeklődés-radar cron — 15 percenként friss angolvizsga-kérdéseket keres a
// Redditen, és azonnal szól Telegramon.
//
// FONTOS: a Reddit blokkolja a felhő-szerverek IP-jét, ezért a beolvasást a
// VPS worker végzi lakossági proxy mögül (reddit_lead_scan feladat). Ez a cron
// csak sorba állítja a beolvasást — a pontozást és az értesítést a Brain
// oldali ingest-végpont intézi.
//
// Auth: apikey header.
import { createFileRoute } from "@tanstack/react-router";
import { isOwnerBlackout } from "@/lib/scheduling/quiet-windows";

// Ne torlódjon: ennyi időn belül ne induljon új beolvasás.
const MIN_GAP_MS = 12 * 60 * 1000;

export const Route = createFileRoute("/api/public/cron/lead-radar")({
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

        if (isOwnerBlackout()) {
          return Response.json({ ok: true, skipped: "gazdi-ablak" });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Egy olvasásra használt Reddit workflow-t választunk (csak JSON-t kér le).
          const { data: acc } = await supabaseAdmin
            .from("reddit_accounts")
            .select("tenant_id, workflow_id, proxy_id, language, locale")
            .eq("status", "active")
            .not("workflow_id", "is", null)
            .or(`quarantined_until.is.null,quarantined_until.lt.${new Date().toISOString()}`)
            .order("warmup_days_completed", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!acc?.workflow_id) {
            return Response.json({ ok: true, skipped: "nincs alkalmas workflow" });
          }

          const { data: recent } = await supabaseAdmin
            .from("brain_workflow_runs")
            .select("id, status, created_at, spec_snapshot")
            .eq("workflow_id", acc.workflow_id)
            .order("created_at", { ascending: false })
            .limit(6);

          const busy = (recent ?? []).find((r) =>
            ["queued", "scheduled", "running"].includes(r.status),
          );
          if (busy) return Response.json({ ok: true, skipped: `fut vagy sorban áll (${busy.status})` });

          const lastScan = (recent ?? []).find(
            (r) =>
              ((r.spec_snapshot as Record<string, unknown> | null)?.["brain_task"] as
                | Record<string, unknown>
                | undefined)?.["task_type"] === "reddit_lead_scan",
          );
          if (lastScan && Date.now() - new Date(lastScan.created_at).getTime() < MIN_GAP_MS) {
            return Response.json({ ok: true, skipped: "nemrég volt beolvasás" });
          }

          const { data: wf } = await supabaseAdmin
            .from("workflows")
            .select("spec")
            .eq("id", acc.workflow_id)
            .maybeSingle();

          const specSnapshot = {
            ...((wf?.spec ?? {}) as Record<string, unknown>),
            monitor_type: "reddit-lead-scan",
            platform: "reddit",
            start_url: "https://www.reddit.com/",
            brain_task: {
              platform: "reddit",
              task_type: "reddit_lead_scan",
              language: acc.language ?? acc.locale ?? "en",
            },
          };

          const { data: run, error } = await supabaseAdmin
            .from("brain_workflow_runs")
            .insert({
              workflow_id: acc.workflow_id,
              tenant_id: acc.tenant_id,
              runner: "docker",
              status: "queued",
              module: "brain",
              proxy_id: acc.proxy_id,
              spec_snapshot: specSnapshot as never,
            })
            .select("id")
            .single();

          if (error || !run) {
            return Response.json({ ok: false, error: error?.message ?? "insert hiba" }, { status: 500 });
          }

          return Response.json({ ok: true, run_id: run.id });
        } catch (err) {
          console.error("lead-radar cron hiba", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
