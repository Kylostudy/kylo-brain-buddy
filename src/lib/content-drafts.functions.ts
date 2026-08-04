// Tartalom Stúdió — beillesztett szövegek (poszt, komment, bármi) tárolása és
// kiküldése egy kiválasztott workflow-nak, hogy a worker EMBERI módon gépelje be.
// Szándékosan általános: a "kind" mező miatt később nem csak Reddit posztra jó.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DraftKind =
  | "reddit_post"
  | "reddit_comment"
  | "linkedin_post"
  | "generic_text";

export const listContentDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("content_drafts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveContentDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      kind: string;
      title: string;
      body: string;
      target_workflow_id?: string | null;
      target_ref?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    if (!data.body.trim()) throw new Error("A szöveg nem lehet üres.");
    if (data.id) {
      const { error } = await context.supabase
        .from("content_drafts")
        .update({
          kind: data.kind,
          title: data.title,
          body: data.body,
          target_workflow_id: data.target_workflow_id ?? null,
          target_ref: data.target_ref ?? null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) throw new Error("tenant_id hiányzik");
    const { data: row, error } = await context.supabase
      .from("content_drafts")
      .insert({
        tenant_id: tenantId,
        kind: data.kind,
        title: data.title,
        body: data.body,
        target_workflow_id: data.target_workflow_id ?? null,
        target_ref: data.target_ref ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteContentDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("content_drafts")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * A szöveget sorba állítja a kiválasztott workflow-hoz: a worker nyitja a
 * böngészőt, beírja emberi tempóban, és (ha submit=true) el is küldi.
 */
export const queueContentDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; submit?: boolean; dry_run?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { data: draft, error } = await context.supabase
      .from("content_drafts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!draft) throw new Error("A szöveg nem található.");
    if (!draft.target_workflow_id) throw new Error("Válassz cél-workflow-t!");

    const { data: wf } = await context.supabase
      .from("workflows")
      .select("id, tenant_id, spec, platform")
      .eq("id", draft.target_workflow_id)
      .maybeSingle();
    if (!wf) throw new Error("A cél-workflow nem található.");

    const { data: cred } = await context.supabase
      .from("workflow_credentials")
      .select("proxy_id")
      .eq("workflow_id", wf.id)
      .maybeSingle();

    const spec = (wf.spec ?? {}) as Record<string, unknown>;
    const platform = (wf.platform ?? "reddit").toLowerCase();
    const isLinkedIn = platform === "linkedin" || draft.kind === "linkedin_post";

    const taskType = isLinkedIn
      ? "linkedin_post"
      : draft.kind === "reddit_comment"
        ? "reddit_comment"
        : "reddit_post";

    const startUrl = isLinkedIn
      ? "https://www.linkedin.com/feed/"
      : "https://www.reddit.com/";

    const specSnapshot = {
      ...spec,
      platform: isLinkedIn ? "linkedin" : platform,
      start_url: startUrl,
      brain_task: {
        platform: isLinkedIn ? "linkedin" : platform,
        task_type: taskType,
        draft_id: draft.id,
        title: draft.title,
        body: draft.body,
        subreddit: isLinkedIn ? null : (draft.target_ref ?? null),
        target_ref: draft.target_ref ?? null,
        submit: data.submit !== false,
        dry_run: !!data.dry_run,
      },
    };


    const { data: run, error: rErr } = await context.supabase
      .from("brain_workflow_runs")
      .insert({
        workflow_id: wf.id,
        tenant_id: wf.tenant_id,
        runner: "docker",
        status: "queued",
        module: "brain",
        proxy_id: cred?.proxy_id ?? null,
        spec_snapshot: specSnapshot as never,
      })
      .select("id")
      .single();
    if (rErr || !run) throw new Error(rErr?.message ?? "Nem sikerült sorba állítani.");

    await context.supabase
      .from("content_drafts")
      .update({
        status: data.dry_run ? "dry_run" : "queued",
        last_run_id: run.id,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    return { run_id: run.id };
  });

/**
 * Az esti posztoláshoz: a napló alapján rangsorolja a Reddit fiókokat
 * és megmondja, melyik a legérettebb.
 */
export const recommendMatureRedditAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: accounts, error } = await context.supabase
      .from("reddit_accounts")
      .select(
        "id, username, language, locale, workflow_id, warmup_status, warmup_days_completed, subreddits_joined, karma, status",
      )
      .eq("status", "active");
    if (error) throw new Error(error.message);

    const { data: logs } = await context.supabase
      .from("reddit_warmup_log")
      .select("account_id, activity_date, scroll_minutes, upvotes, comments");

    const byAccount = new Map<
      string,
      { days: Set<string>; minutes: number; upvotes: number; comments: number; last?: string }
    >();
    for (const l of logs ?? []) {
      const key = l.account_id as string;
      const cur =
        byAccount.get(key) ?? { days: new Set<string>(), minutes: 0, upvotes: 0, comments: 0 };
      cur.days.add(l.activity_date as string);
      cur.minutes += l.scroll_minutes ?? 0;
      cur.upvotes += l.upvotes ?? 0;
      cur.comments += l.comments ?? 0;
      const d = l.activity_date as string;
      if (!cur.last || d > cur.last) cur.last = d;
      byAccount.set(key, cur);
    }

    const ranked = (accounts ?? [])
      .map((a) => {
        const s = byAccount.get(a.id);
        const days = s?.days.size ?? a.warmup_days_completed ?? 0;
        const minutes = s?.minutes ?? 0;
        const upvotes = s?.upvotes ?? 0;
        const subs = Array.isArray(a.subreddits_joined)
          ? (a.subreddits_joined as string[])
          : [];
        // Érettségi pontszám: a napok a legfontosabbak, utána az aktivitás.
        const score =
          days * 10 + Math.min(minutes / 30, 20) + Math.min(upvotes / 5, 20) + subs.length;
        return {
          account_id: a.id,
          username: a.username,
          language: a.language,
          locale: a.locale,
          workflow_id: a.workflow_id,
          warmup_status: a.warmup_status,
          days,
          minutes,
          upvotes,
          comments: s?.comments ?? 0,
          last_activity: s?.last ?? null,
          subreddits: subs,
          score: Math.round(score),
          ready: days >= 14,
        };
      })
      .sort((x, y) => y.score - x.score);

    return { best: ranked[0] ?? null, ranked };
  });
