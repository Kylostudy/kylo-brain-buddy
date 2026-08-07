// LinkedIn hozzászólás-radar ütemező — óránként sorba tesz egy beolvasást a
// bejelentkezett LinkedIn workflow-nak (értesítések + saját posztok kommentjei).
// Auth: apikey header a Supabase publishable kulcsával.
import { createFileRoute } from "@tanstack/react-router";

const MIN_GAP_MS = 55 * 60 * 1000;

export const Route = createFileRoute("/api/public/cron/linkedin-comment-scan")({
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: workflows, error } = await supabaseAdmin
          .from("workflows")
          .select("id, tenant_id, spec")
          .eq("platform", "linkedin")
          .eq("active", true);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const enqueued: string[] = [];
        const skipped: Array<{ workflow_id: string; reason: string }> = [];

        for (const wf of workflows ?? []) {
          const { data: lastRuns } = await supabaseAdmin
            .from("brain_workflow_runs")
            .select("id, status, created_at, spec_snapshot")
            .eq("workflow_id", wf.id)
            .order("created_at", { ascending: false })
            .limit(10);

          const busy = (lastRuns ?? []).find((r) =>
            ["queued", "scheduled", "running"].includes(r.status),
          );
          if (busy) {
            skipped.push({ workflow_id: wf.id, reason: `fut vagy sorban áll (${busy.status})` });
            continue;
          }

          const lastScan = (lastRuns ?? []).find(
            (r) =>
              ((r.spec_snapshot as Record<string, unknown> | null)?.["brain_task"] as
                | Record<string, unknown>
                | undefined)?.["task_type"] === "linkedin_comment_scan",
          );
          if (lastScan && Date.now() - new Date(lastScan.created_at).getTime() < MIN_GAP_MS) {
            skipped.push({ workflow_id: wf.id, reason: "nemrég volt beolvasás" });
            continue;
          }

          const spec = (wf.spec ?? {}) as Record<string, unknown>;
          const specSnapshot = {
            ...spec,
            platform: "linkedin",
            start_url: "https://www.linkedin.com/feed/",
            brain_task: {
              platform: "linkedin",
              task_type: "linkedin_comment_scan",
              max_items: 25,
              company_slug: spec["company_slug"] ?? null,
            },
          };

          const { data: run, error: rErr } = await supabaseAdmin
            .from("brain_workflow_runs")
            .insert({
              workflow_id: wf.id,
              tenant_id: wf.tenant_id,
              runner: "docker",
              status: "queued",
              module: "brain",
              spec_snapshot: specSnapshot as never,
            })
            .select("id")
            .single();

          if (rErr || !run) {
            skipped.push({ workflow_id: wf.id, reason: rErr?.message ?? "insert hiba" });
            continue;
          }
          enqueued.push(run.id);
        }

        return Response.json({ ok: true, enqueued, skipped });
      },
    },
  },
});
