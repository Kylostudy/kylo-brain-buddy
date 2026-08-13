// Reddit válasz-kiküldő ütemező.
//
// Ez volt a hiányzó láncszem: a Telegramon JÓVÁHAGYOTT válaszok eddig csak
// elmentődtek az adatbázisba, de senki nem tette ki őket. Ez a cron
// félóránként fog egy jóváhagyott választ, és sorba állítja a workernek
// (reddit_comment feladat), majd a worker visszajelez, hogy kiment.
//
// Biztonsági korlátok:
//  - gazdi-ablakban nem indul,
//  - fiókonként max. napi 3 válasz,
//  - körönként max. 2 válasz, és csak akkor, ha a fiók épp nem dolgozik.
//
// Auth: apikey header a publishable kulccsal.
import { createFileRoute } from "@tanstack/react-router";
import { isOwnerBlackout } from "@/lib/scheduling/quiet-windows";

const MAX_PER_RUN = 2;
const MAX_PER_ACCOUNT_PER_DAY = 3;

type Pending = {
  ref_table: "lead_alerts" | "reddit_comments";
  ref_id: string;
  permalink: string;
  body: string;
  subreddit: string | null;
};

export const Route = createFileRoute("/api/public/cron/reddit-reply-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
        const provided = request.headers.get("apikey")?.trim();
        if (!expected || !provided || provided !== expected) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        if (isOwnerBlackout()) {
          return Response.json({ ok: true, skipped: "gazdi-ablak" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // --- 1) Mi vár kiküldésre? ---
        const pending: Pending[] = [];

        const { data: alerts } = await supabaseAdmin
          .from("lead_alerts")
          .select("id, permalink, subreddit, approved_reply_en, approved_reply_hu")
          .eq("status", "approved")
          .is("posted_at", null)
          .not("permalink", "is", null)
          .gte("approved_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
          .order("approved_at", { ascending: true })
          .limit(10);

        for (const a of alerts ?? []) {
          const body = (a.approved_reply_en ?? "").trim();
          if (!body || !a.permalink) continue;
          pending.push({
            ref_table: "lead_alerts",
            ref_id: a.id,
            permalink: a.permalink,
            body,
            subreddit: a.subreddit ?? null,
          });
        }

        const { data: comments } = await supabaseAdmin
          .from("reddit_comments")
          .select("id, permalink, subreddit, approved_reply_en")
          .eq("reply_status", "approved")
          .is("posted_at", null)
          .not("permalink", "is", null)
          .gte("approved_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
          .order("approved_at", { ascending: true })
          .limit(10);

        for (const c of comments ?? []) {
          const body = (c.approved_reply_en ?? "").trim();
          if (!body || !c.permalink) continue;
          pending.push({
            ref_table: "reddit_comments",
            ref_id: c.id,
            permalink: c.permalink,
            body,
            subreddit: c.subreddit ?? null,
          });
        }

        if (pending.length === 0) {
          return Response.json({ ok: true, pending: 0, enqueued: [] });
        }

        // --- 2) Melyik fiókkal küldjük ki? ---
        const nowIso = new Date().toISOString();
        const { data: accounts } = await supabaseAdmin
          .from("reddit_accounts")
          .select("id, tenant_id, workflow_id, proxy_id, username, warmup_days_completed")
          .eq("status", "active")
          .not("workflow_id", "is", null)
          .or(`quarantined_until.is.null,quarantined_until.lt.${nowIso}`)
          .order("warmup_days_completed", { ascending: false })
          .limit(10);

        if (!accounts?.length) {
          return Response.json({ ok: true, pending: pending.length, skipped: "nincs alkalmas fiók" });
        }

        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const enqueued: string[] = [];
        const skipped: Array<{ account: string; reason: string }> = [];
        let idx = 0;

        for (const acc of accounts) {
          if (enqueued.length >= MAX_PER_RUN || idx >= pending.length) break;
          if (!acc.workflow_id) continue;

          const { data: runs } = await supabaseAdmin
            .from("brain_workflow_runs")
            .select("id, status, created_at, spec_snapshot")
            .eq("workflow_id", acc.workflow_id)
            .order("created_at", { ascending: false })
            .limit(40);

          const busy = (runs ?? []).find((r) =>
            ["queued", "scheduled", "running"].includes(r.status),
          );
          if (busy) {
            skipped.push({ account: acc.username ?? acc.id, reason: `fut vagy sorban áll` });
            continue;
          }

          const repliesToday = (runs ?? []).filter((r) => {
            if (r.created_at < dayAgo) return false;
            const task = (r.spec_snapshot as Record<string, unknown> | null)?.["brain_task"] as
              | Record<string, unknown>
              | undefined;
            return task?.["task_type"] === "reddit_comment";
          }).length;
          if (repliesToday >= MAX_PER_ACCOUNT_PER_DAY) {
            skipped.push({ account: acc.username ?? acc.id, reason: "napi keret betelt" });
            continue;
          }

          const item = pending[idx];
          idx += 1;

          const { data: wf } = await supabaseAdmin
            .from("workflows")
            .select("spec")
            .eq("id", acc.workflow_id)
            .maybeSingle();

          const { data: run, error } = await supabaseAdmin
            .from("brain_workflow_runs")
            .insert({
              workflow_id: acc.workflow_id,
              tenant_id: acc.tenant_id,
              runner: "docker",
              status: "queued",
              module: "brain",
              proxy_id: acc.proxy_id,
              spec_snapshot: {
                ...((wf?.spec ?? {}) as Record<string, unknown>),
                platform: "reddit",
                start_url: item.permalink,
                brain_task: {
                  platform: "reddit",
                  task_type: "reddit_comment",
                  permalink: item.permalink,
                  subreddit: item.subreddit,
                  body: item.body,
                  ref_table: item.ref_table,
                  ref_id: item.ref_id,
                },
              } as never,
            })
            .select("id")
            .single();

          if (error || !run) {
            skipped.push({ account: acc.username ?? acc.id, reason: error?.message ?? "insert hiba" });
            idx -= 1;
            continue;
          }

          if (item.ref_table === "lead_alerts") {
            await supabaseAdmin.from("lead_alerts").update({ status: "queued" }).eq("id", item.ref_id);
          } else {
            await supabaseAdmin
              .from("reddit_comments")
              .update({ reply_status: "queued" })
              .eq("id", item.ref_id);
          }
          enqueued.push(run.id);
        }

        return Response.json({ ok: true, pending: pending.length, enqueued, skipped });
      },
    },
  },
});
