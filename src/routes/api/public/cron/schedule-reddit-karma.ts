// Reddit karma-építő ütemező — óránként fut, pg_cron hívja.
//
// Csak azok a fiókok kapnak karma-építő futást, amelyek már legalább
// MIN_WARMUP_DAYS napja melegednek. Fiókonként naponta egy futás, benne
// max 1–3 AI-írta, reklámmentes komment.
//
// Auth: apikey header a Supabase publishable kulcsával.

import { createFileRoute } from "@tanstack/react-router";
import { isLocalDaytime, isOwnerBlackout, resolveTimezone } from "@/lib/scheduling/quiet-windows";

const MIN_WARMUP_DAYS = 5; // ennyi naplózott melegítési nap után kezdünk kommentelni
const MAX_ENQUEUE_PER_TICK = 2;
const MIN_GAP_MS = 20 * 60 * 60 * 1000; // fiókonként naponta egy karma-futás
const RETRY_AFTER_FAIL_MS = 3 * 60 * 60 * 1000;
const HOURLY_CHANCE = 0.3;

export const Route = createFileRoute("/api/public/cron/schedule-reddit-karma")({
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
          return Response.json({ ok: true, skipped: "gazdi-ablak", enqueued: [] });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: accounts, error: accErr } = await supabaseAdmin
          .from("reddit_accounts")
          .select(
            "id, tenant_id, workflow_id, username, language, locale, proxy_id, target_subreddits, status, warmup_days_completed, warmup_status, quarantined_until",
          )
          .eq("status", "active");

        if (accErr) {
          return new Response(JSON.stringify({ error: accErr.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const enqueued: Array<{ account_id: string; run_id: string }> = [];
        const skipped: Array<{ account_id: string; reason: string }> = [];

        for (const acc of accounts ?? []) {
          if (enqueued.length >= MAX_ENQUEUE_PER_TICK) break;
          if (!acc.workflow_id) {
            skipped.push({ account_id: acc.id, reason: "nincs workflow" });
            continue;
          }
          if (acc.quarantined_until && new Date(acc.quarantined_until) > new Date()) {
            skipped.push({ account_id: acc.id, reason: "karanténban" });
            continue;
          }
          const days = acc.warmup_days_completed ?? 0;
          if (days < MIN_WARMUP_DAYS && acc.warmup_status !== "ready") {
            skipped.push({ account_id: acc.id, reason: `még csak ${days} melegítési nap` });
            continue;
          }

          const tz = resolveTimezone(acc.locale, acc.language);
          if (!isLocalDaytime(tz)) {
            skipped.push({ account_id: acc.id, reason: `helyi idő szerint nem nappal (${tz})` });
            continue;
          }

          // Bármilyen futás fut/sorban áll ezen a workflow-n? Akkor kihagyjuk.
          const { data: lastRuns } = await supabaseAdmin
            .from("brain_workflow_runs")
            .select("id, status, created_at, spec_snapshot")
            .eq("workflow_id", acc.workflow_id)
            .order("created_at", { ascending: false })
            .limit(6);

          const running = (lastRuns ?? []).find((r) =>
            ["queued", "scheduled", "running"].includes(r.status),
          );
          if (running) {
            skipped.push({ account_id: acc.id, reason: `fut vagy sorban áll (${running.status})` });
            continue;
          }

          const lastKarma = (lastRuns ?? []).find(
            (r) =>
              ((r.spec_snapshot as Record<string, unknown> | null)?.["brain_task"] as
                | Record<string, unknown>
                | undefined)?.["task_type"] === "reddit_karma_build",
          );
          if (lastKarma) {
            const age = Date.now() - new Date(lastKarma.created_at).getTime();
            const gap = ["succeeded", "completed"].includes(lastKarma.status)
              ? MIN_GAP_MS
              : RETRY_AFTER_FAIL_MS;
            if (age < gap) {
              skipped.push({ account_id: acc.id, reason: "ma már volt karma-futás" });
              continue;
            }
          }

          if (Math.random() > HOURLY_CHANCE) {
            skipped.push({ account_id: acc.id, reason: "véletlen eltolás erre az órára" });
            continue;
          }

          const { data: wf } = await supabaseAdmin
            .from("workflows")
            .select("id, spec")
            .eq("id", acc.workflow_id)
            .maybeSingle();
          if (!wf) {
            skipped.push({ account_id: acc.id, reason: "workflow nem található" });
            continue;
          }

          const spec = (wf.spec ?? {}) as Record<string, unknown>;
          const subs = Array.isArray(acc.target_subreddits)
            ? (acc.target_subreddits as string[])
            : [];

          const specSnapshot = {
            ...spec,
            monitor_type: "reddit-account",
            platform: "reddit",
            start_url: "https://www.reddit.com/",
            locale: acc.locale,
            language: acc.language,
            target_subreddits: subs.length ? subs : (spec["target_subreddits"] ?? []),
            brain_task: {
              platform: "reddit",
              task_type: "reddit_karma_build",
              duration_min: 28 + Math.floor(Math.random() * 20),
              // Az érettebb fiók többet kommentelhet.
              max_comments: days >= 10 ? 2 + (Math.random() < 0.4 ? 1 : 0) : 1,
              language: acc.language ?? acc.locale ?? "en",
            },
          };

          const { data: run, error: rErr } = await supabaseAdmin
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

          if (rErr || !run) {
            skipped.push({ account_id: acc.id, reason: rErr?.message ?? "insert hiba" });
            continue;
          }
          enqueued.push({ account_id: acc.id, run_id: run.id });
        }

        return Response.json({
          ok: true,
          accounts: accounts?.length ?? 0,
          enqueued_count: enqueued.length,
          enqueued,
          skipped,
        });
      },
    },
  },
});
