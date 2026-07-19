// Publikus cron végpont — pg_cron percenként meghívja, és minden esedékes
// audit_qa_schedules sorra sorba tesz egy új QA futást (diff-móddal, olcsón).
// Auth: `apikey` header egyeznie kell a projekt publishable kulcsával.
// Minden érdemi művelet supabaseAdmin-nal fut (a cron nem user, nincs RLS-kontextusa).
import { createFileRoute } from "@tanstack/react-router";
import { Cron } from "croner";

export const Route = createFileRoute("/api/public/hooks/qa-scheduler")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !publishable) {
          return Response.json({ error: "SUPABASE env hiányzik" }, { status: 500 });
        }

        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== publishable) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Esedékes ütemezések (enabled + next_run_at <= now).
        const nowIso = new Date().toISOString();
        const { data: due, error: dueErr } = await supabaseAdmin
          .from("audit_qa_schedules")
          .select("*")
          .eq("enabled", true)
          .lte("next_run_at", nowIso)
          .limit(50);
        if (dueErr) return Response.json({ error: dueErr.message }, { status: 500 });

        const results: Array<{ id: string; ok: boolean; runId?: string; error?: string }> = [];

        for (const s of due ?? []) {
          const scheduleId = s.id as string;
          const tenantId = s.tenant_id as string;
          const baseUrl = (s.base_url as string) || "https://kylo.study";
          const languages = (s.languages as string[]) ?? [];
          const skins = (s.skins as string[]) ?? [];
          const diffMode = s.diff_mode as boolean;
          const costCapUsd = Number(s.cost_cap_usd ?? 50);
          const maxPagesPerCombo = Number(s.max_pages_per_combo ?? 300);
          const cronExpr = s.cron_expression as string;
          const tz = (s.timezone as string) || "Europe/Budapest";

          try {
            // 1) audit_qa_runs beszúrás
            const { data: run, error: runErr } = await supabaseAdmin
              .from("audit_qa_runs")
              .insert({
                tenant_id: tenantId,
                workflow_id: null,
                status: "running",
                base_url: baseUrl,
                config: {
                  languages,
                  skins,
                  maxPagesPerCombo,
                  diffMode,
                  triggeredBy: "schedule",
                  scheduleId,
                  scheduleName: s.name,
                },
                cost_cap_usd: costCapUsd,
              } as never)
              .select("id")
              .single();
            if (runErr || !run) throw new Error(runErr?.message || "run insert failed");
            const runId = run.id as string;

            // 2) Workflow újrahasználat / létrehozás
            let wfId: string | null = null;
            const { data: existingWf } = await supabaseAdmin
              .from("workflows")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("module", "audit")
              .contains("spec", { monitor_type: "kylo-study-qa" })
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (existingWf?.id) {
              wfId = existingWf.id as string;
            } else {
              const { data: wf, error: wfErr } = await supabaseAdmin
                .from("workflows")
                .insert({
                  tenant_id: tenantId,
                  module: "audit",
                  name: "Kylo.study QA — nyelv és skin tesztelés",
                  spec: { monitor_type: "kylo-study-qa" },
                } as never)
                .select("id")
                .single();
              if (wfErr || !wf) throw new Error(wfErr?.message || "workflow insert failed");
              wfId = wf.id as string;
            }
            await supabaseAdmin.from("audit_qa_runs").update({ workflow_id: wfId } as never).eq("id", runId);

            // 3) Elvárt oldalak (checklista)
            const { data: expectedRoutes } = await supabaseAdmin
              .from("audit_qa_expected_routes")
              .select("path, requires_auth")
              .eq("tenant_id", tenantId)
              .order("path", { ascending: true });

            // 4) queued brain_workflow_runs
            const spec = {
              monitor_type: "kylo-study-qa",
              audit_qa: {
                run_id: runId,
                base_url: baseUrl,
                languages,
                skins,
                max_pages_per_combo: maxPagesPerCombo,
                max_clicks_per_page: 10,
                cost_cap_usd: costCapUsd,
                diff_mode: diffMode,
                expected_routes: (expectedRoutes ?? []).map((r) => ({
                  path: r.path,
                  requires_auth: !!r.requires_auth,
                })),
              },
            };
            const { error: qErr } = await supabaseAdmin.from("brain_workflow_runs").insert({
              workflow_id: wfId,
              tenant_id: tenantId,
              module: "audit",
              runner: "docker",
              status: "queued",
              spec_snapshot: spec,
              started_at: new Date().toISOString(),
              logs: [
                {
                  ts: new Date().toISOString(),
                  level: "info",
                  message: `Ütemezett Kylo.study QA sorba téve — schedule="${s.name}" · run_id=${runId}`,
                },
              ],
            } as never);
            if (qErr) throw new Error(qErr.message);

            // 5) Következő futás időpont + last_run_* frissítés
            let nextRunAt: string | null = null;
            try {
              const job = new Cron(cronExpr, { timezone: tz });
              const nx = job.nextRun(new Date());
              nextRunAt = nx ? nx.toISOString() : null;
            } catch {
              nextRunAt = null;
            }
            await supabaseAdmin
              .from("audit_qa_schedules")
              .update({
                last_run_at: new Date().toISOString(),
                last_run_id: runId,
                last_run_status: "queued",
                next_run_at: nextRunAt,
              } as never)
              .eq("id", scheduleId);

            results.push({ id: scheduleId, ok: true, runId });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Hiba esetén ne pörögjön percenként — toljuk el a next_run-t a következő ciklusra a cron alapján.
            let nextRunAt: string | null = null;
            try {
              const job = new Cron(cronExpr, { timezone: tz });
              const nx = job.nextRun(new Date());
              nextRunAt = nx ? nx.toISOString() : null;
            } catch { /* noop */ }
            await supabaseAdmin
              .from("audit_qa_schedules")
              .update({
                last_run_at: new Date().toISOString(),
                last_run_status: `error: ${msg}`.slice(0, 500),
                next_run_at: nextRunAt,
              } as never)
              .eq("id", scheduleId);
            results.push({ id: scheduleId, ok: false, error: msg });
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
