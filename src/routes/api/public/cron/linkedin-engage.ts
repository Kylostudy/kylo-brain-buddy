// LinkedIn közösségépítés ütemező.
//  1) Naponta párszor sorba tesz egy „idegen poszt” beolvasást.
//  2) A Telegramon JÓVÁHAGYOTT hozzászólásokat sorba teszi kitevésre.
// Auth: apikey header a Supabase publishable kulcsával.
import { createFileRoute } from "@tanstack/react-router";

const SCAN_GAP_MS = 3 * 60 * 60 * 1000; // legfeljebb 3 óránként egy körbenézés
const MAX_POSTS_PER_RUN = 2; // egy körben legfeljebb 2 hozzászólás megy ki

export const Route = createFileRoute("/api/public/cron/linkedin-engage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
        const provided = request.headers.get("apikey")?.trim();
        if (!expected || !provided || provided !== expected) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
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
            .limit(15);

          const busy = (lastRuns ?? []).find((r) =>
            ["queued", "scheduled", "running"].includes(r.status),
          );
          if (busy) {
            skipped.push({ workflow_id: wf.id, reason: `fut vagy sorban áll (${busy.status})` });
            continue;
          }

          const taskTypeOf = (r: { spec_snapshot: unknown }) =>
            ((r.spec_snapshot as Record<string, unknown> | null)?.["brain_task"] as
              | Record<string, unknown>
              | undefined)?.["task_type"];

          const spec = (wf.spec ?? {}) as Record<string, unknown>;

          // --- 1) Jóváhagyott hozzászólások kitevése (ez az elsőbbség) ---
          const { data: approved } = await supabaseAdmin
            .from("linkedin_comments")
            .select("id, permalink, approved_reply_en")
            .eq("tenant_id", wf.tenant_id)
            .eq("reply_status", "approved")
            .is("posted_at", null)
            .not("permalink", "is", null)
            .order("approved_at", { ascending: true })
            .limit(MAX_POSTS_PER_RUN);

          let posted = 0;
          for (const c of approved ?? []) {
            if (!c.approved_reply_en?.trim() || !c.permalink) continue;
            const { data: run } = await supabaseAdmin
              .from("brain_workflow_runs")
              .insert({
                workflow_id: wf.id,
                tenant_id: wf.tenant_id,
                runner: "docker",
                status: "queued",
                module: "brain",
                spec_snapshot: {
                  ...spec,
                  platform: "linkedin",
                  start_url: c.permalink,
                  brain_task: {
                    platform: "linkedin",
                    task_type: "linkedin_comment_post",
                    comment_id: c.id,
                    permalink: c.permalink,
                    body: c.approved_reply_en,
                  },
                } as never,
              })
              .select("id")
              .single();
            if (run) {
              enqueued.push(run.id);
              posted += 1;
              await supabaseAdmin
                .from("linkedin_comments")
                .update({ reply_status: "queued" })
                .eq("id", c.id);
            }
          }
          if (posted) continue; // egyszerre csak egyféle munka fusson

          // --- 2) Körbenézés mások posztjai közt ---
          const lastScan = (lastRuns ?? []).find(
            (r) => taskTypeOf(r) === "linkedin_engage_scan",
          );
          if (lastScan && Date.now() - new Date(lastScan.created_at).getTime() < SCAN_GAP_MS) {
            skipped.push({ workflow_id: wf.id, reason: "nemrég volt körbenézés" });
            continue;
          }

          const { data: run, error: rErr } = await supabaseAdmin
            .from("brain_workflow_runs")
            .insert({
              workflow_id: wf.id,
              tenant_id: wf.tenant_id,
              runner: "docker",
              status: "queued",
              module: "brain",
              spec_snapshot: {
                ...spec,
                platform: "linkedin",
                start_url: "https://www.linkedin.com/feed/",
                brain_task: {
                  platform: "linkedin",
                  task_type: "linkedin_engage_scan",
                  max_items: 20,
                  keywords: spec["engage_keywords"] ?? null,
                  positioning: spec["positioning"] ?? null,
                },
              } as never,
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
