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
    const drafts = data ?? [];

    // A vázlat státusza ne ragadjon "queued"-ben: a hozzá tartozó futás
    // tényleges állapotából frissítjük (kiment / hibázott / fut).
    const runIds = drafts
      .filter((d) => d.last_run_id && (d.status === "queued" || d.status === "dry_run"))
      .map((d) => d.last_run_id as string);
    if (runIds.length === 0) return drafts;

    const { data: runs } = await context.supabase
      .from("brain_workflow_runs")
      .select("id, status, error, finished_at")
      .in("id", runIds);
    const byRun = new Map((runs ?? []).map((r) => [r.id, r]));

    for (const d of drafts) {
      const run = d.last_run_id ? byRun.get(d.last_run_id as string) : undefined;
      if (!run) continue;
      let next: string | null = null;
      if (run.status === "succeeded") next = d.status === "dry_run" ? "dry_run_done" : "posted";
      else if (run.status === "failed" || run.status === "cancelled") next = "failed";
      else if (run.status === "running") next = "running";
      if (next && next !== d.status) {
        d.status = next;
        await context.supabase
          .from("content_drafts")
          .update({ status: next })
          .eq("id", d.id);
      }
    }
    return drafts;
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
      media_path?: string | null;
      media_name?: string | null;
      media_mime?: string | null;
      media_size?: number | null;
      media_slot?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    if (!data.body.trim() && !data.media_path) {
      throw new Error("Adj meg szöveget vagy tölts fel egy fájlt.");
    }
    const media = {
      media_path: data.media_path ?? null,
      media_name: data.media_name ?? null,
      media_mime: data.media_mime ?? null,
      media_size: data.media_size ?? null,
      media_slot: data.media_slot ?? null,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("content_drafts")
        .update({
          kind: data.kind,
          title: data.title,
          body: data.body,
          target_workflow_id: data.target_workflow_id ?? null,
          target_ref: data.target_ref ?? null,
          ...media,
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
        ...media,
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
    const { queueDraftToWorker } = await import("@/lib/content-queue.server");
    return queueDraftToWorker(context.supabase as never, data.id, {
      submit: data.submit,
      dry_run: data.dry_run,
    });
  });

/**
 * Időzített kiküldés: csak beállítja az időpontot, a cron indítja majd el.
 * scheduled_for = null → az időzítés törlése.
 */
export const scheduleContentDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; scheduled_for: string | null; submit?: boolean }) => d)
  .handler(async ({ data, context }) => {
    if (data.scheduled_for) {
      const when = new Date(data.scheduled_for);
      if (Number.isNaN(when.getTime())) throw new Error("Érvénytelen időpont.");
      const { error } = await context.supabase
        .from("content_drafts")
        .update({
          scheduled_for: when.toISOString(),
          scheduled_submit: data.submit !== false,
          status: "scheduled",
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, scheduled_for: when.toISOString() };
    }
    const { error } = await context.supabase
      .from("content_drafts")
      .update({ scheduled_for: null, status: "draft" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, scheduled_for: null };
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
