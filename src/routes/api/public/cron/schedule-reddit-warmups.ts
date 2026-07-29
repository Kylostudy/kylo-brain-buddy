// Napi Reddit fiók-melegítés ütemező — óránként fut, pg_cron hívja.
//
// Minden aktív Reddit fiókhoz (public.reddit_accounts) naponta EGY bemelegítő
// futást tesz sorba (brain_workflow_runs, status=queued). A VPS worker a
// /worker/claim endpointon veszi fel, így az ütemezés az adatbázisban él:
// a worker újraépítése/újraindítása után is folytatódik.
//
// Nem fix időpontban indul: a jogosult fiókok óránként véletlen eséllyel
// indulnak, hogy ne legyen felismerhető minta.
//
// Auth: apikey header a Supabase publishable kulcsával.

import { createFileRoute } from "@tanstack/react-router";
import {
  isLocalDaytime,
  isOwnerBlackout,
  isRedditBoostActive,
  resolveTimezone,
} from "@/lib/scheduling/quiet-windows";

// Egy tickben max ennyi bemelegítés indul (a worker terhelése miatt).
const MAX_ENQUEUE_PER_TICK = 3;
// "Teljes gáz" ablakban ennyi indulhat egy tickben.
const MAX_ENQUEUE_PER_TICK_BOOST = 6;
// Két bemelegítés között legalább ennyi idő teljen el ugyanazon a fiókon.
const MIN_GAP_MS = 20 * 60 * 60 * 1000; // 20 óra
const MIN_GAP_MS_BOOST = 6 * 60 * 60 * 1000; // 6 óra a teljes gáz ablakban
// Sikertelen futás után ennyivel próbálkozunk újra (pl. VPS újraépítés).
const RETRY_AFTER_FAIL_MS = 60 * 60 * 1000; // 1 óra
// Óránkénti indítási esély a jogosult fiókoknál (mintakerülés).
const HOURLY_CHANCE = 0.35;
const HOURLY_CHANCE_BOOST = 0.8;


export const Route = createFileRoute("/api/public/cron/schedule-reddit-warmups")({
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

        const boost = isRedditBoostActive();
        const maxPerTick = boost ? MAX_ENQUEUE_PER_TICK_BOOST : MAX_ENQUEUE_PER_TICK;
        const minGapMs = boost ? MIN_GAP_MS_BOOST : MIN_GAP_MS;
        const hourlyChance = boost ? HOURLY_CHANCE_BOOST : HOURLY_CHANCE;

        // Gazdi-ablak: 17:00–23:00 budapesti idő között semmi nem indul.
        // A "teljes gáz" ablak alatt ezt ideiglenesen felülírjuk.
        if (!boost && isOwnerBlackout()) {
          return Response.json({
            ok: true,
            skipped: "esti gazdi-ablak (17-23 budapesti idő)",
            enqueued: [],
          });
        }


        const { data: accounts, error: accErr } = await supabaseAdmin
          .from("reddit_accounts")
          .select(
            "id, tenant_id, workflow_id, username, language, locale, proxy_id, target_subreddits, status",
          )
          .eq("status", "active");

        if (accErr) {
          return new Response(JSON.stringify({ error: accErr.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const enqueued: Array<{ account_id: string; workflow_id: string; run_id: string }> = [];
        const skipped: Array<{ account_id: string; reason: string }> = [];

        for (const acc of accounts ?? []) {
          if (enqueued.length >= maxPerTick) break;
          if (!acc.workflow_id) {
            skipped.push({ account_id: acc.id, reason: "nincs workflow" });
            continue;
          }

          // Helyi nappal: a fiók saját országa szerint 09:00–21:00 között
          // melegítünk, hogy ne éjjel görgessen (pl. szingapúri fiók).
          const accountTz = resolveTimezone(acc.locale, acc.language);
          if (!isLocalDaytime(accountTz)) {
            skipped.push({
              account_id: acc.id,
              reason: `helyi idő szerint nem nappal (${accountTz})`,
            });
            continue;
          }


          // Az adott fiók legutóbbi bemelegítő futása.
          const { data: lastRuns } = await supabaseAdmin
            .from("brain_workflow_runs")
            .select("id, status, created_at")
            .eq("workflow_id", acc.workflow_id)
            .order("created_at", { ascending: false })
            .limit(1);
          const last = lastRuns?.[0];

          if (last) {
            const age = Date.now() - new Date(last.created_at).getTime();
            if (["queued", "scheduled", "running"].includes(last.status)) {
              skipped.push({ account_id: acc.id, reason: `fut vagy sorban áll (${last.status})` });
              continue;
            }
            const gap = last.status === "succeeded" || last.status === "completed"
              ? minGapMs
              : RETRY_AFTER_FAIL_MS;
            if (age < gap) {
              skipped.push({ account_id: acc.id, reason: "még nem esedékes" });
              continue;
            }
          }

          if (Math.random() > hourlyChance) {
            skipped.push({ account_id: acc.id, reason: "véletlen eltolás erre az órára" });
            continue;
          }

          const { data: wf } = await supabaseAdmin
            .from("workflows")
            .select("id, spec, region, language")
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
          // 22–40 perc, hogy ne legyen két egyforma hosszú bemelegítés.
          const durationMin = 22 + Math.floor(Math.random() * 19);

          const specSnapshot = {
            ...spec,
            is_warmup: true,
            monitor_type: "reddit-account",
            platform: "reddit",
            start_url: "https://www.reddit.com/",
            locale: acc.locale,
            language: acc.language,
            target_subreddits: subs.length ? subs : (spec.target_subreddits ?? []),
            brain_task: {
              platform: "reddit",
              task_type: "reddit_warmup",
              duration_min: durationMin,
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

          await supabaseAdmin
            .from("reddit_accounts")
            .update({ last_checked_at: new Date().toISOString() })
            .eq("id", acc.id);

          enqueued.push({ account_id: acc.id, workflow_id: acc.workflow_id, run_id: run.id });
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
