// Reddit bemelegítés naplózása — a worker futás eredményéből tölti fel a
// reddit_warmup_log táblát és frissíti a fiók haladását (napok, subredditek,
// érettségi állapot). Csak szerveroldalon fut (service role kliens).

import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Sb = ReturnType<typeof createClient<Database>>;

export type RedditWarmupResult = {
  duration_sec?: number;
  upvotes?: number;
  comments?: number;
  posts_read?: number;
  subreddits_visited?: string[];
  logged_in?: boolean;
};

// Ennyi naplózott nap után tekintjük a fiókot posztolásra érettnek.
export const READY_AFTER_DAYS = 14;

export function extractWarmupResult(
  result: Record<string, unknown> | null | undefined,
): RedditWarmupResult | null {
  if (!result || typeof result !== "object") return null;
  const raw = (result as { reddit_warmup?: unknown }).reddit_warmup;
  if (!raw || typeof raw !== "object") return null;
  return raw as RedditWarmupResult;
}

/**
 * Egy befejezett Reddit bemelegítő futást naplóz.
 * Ha aznap már volt futás, összeadja az értékeket.
 */
export async function syncRedditWarmupRun(
  sb: Sb,
  input: {
    workflowId: string | null;
    finishedAt?: string | null;
    result: Record<string, unknown> | null | undefined;
  },
): Promise<{ logged: boolean; account_id?: string; days_completed?: number }> {
  if (!input.workflowId) return { logged: false };
  const warmup = extractWarmupResult(input.result);
  if (!warmup) return { logged: false };

  const { data: acc } = await sb
    .from("reddit_accounts")
    .select("id, tenant_id, warmup_status, warmup_started_at, subreddits_joined")
    .eq("workflow_id", input.workflowId)
    .maybeSingle();
  if (!acc) return { logged: false };

  const when = input.finishedAt ? new Date(input.finishedAt) : new Date();
  const day = when.toISOString().slice(0, 10);
  const minutes = Math.max(1, Math.round((warmup.duration_sec ?? 0) / 60));
  const subs = Array.isArray(warmup.subreddits_visited)
    ? warmup.subreddits_visited.filter((s): s is string => typeof s === "string")
    : [];

  const { data: existing } = await sb
    .from("reddit_warmup_log")
    .select("id, scroll_minutes, upvotes, comments, joined_subreddits")
    .eq("account_id", acc.id)
    .eq("activity_date", day)
    .maybeSingle();

  const mergedSubs = Array.from(
    new Set([
      ...(((existing?.joined_subreddits as string[] | null) ?? []) as string[]),
      ...subs,
    ]),
  );

  const row = {
    tenant_id: acc.tenant_id,
    account_id: acc.id,
    activity_date: day,
    scroll_minutes: (existing?.scroll_minutes ?? 0) + minutes,
    upvotes: (existing?.upvotes ?? 0) + (warmup.upvotes ?? 0),
    comments: (existing?.comments ?? 0) + (warmup.comments ?? 0),
    joined_subreddits: mergedSubs as never,
    notes: `automatikus napló — ${warmup.posts_read ?? 0} poszt olvasva${
      warmup.logged_in === false ? " (nem volt bejelentkezve)" : ""
    }`,
  };

  if (existing?.id) {
    await sb.from("reddit_warmup_log").update(row as never).eq("id", existing.id);
  } else {
    await sb.from("reddit_warmup_log").insert(row as never);
  }

  // Fiók haladás újraszámolása a napló alapján.
  const { data: logs } = await sb
    .from("reddit_warmup_log")
    .select("activity_date, joined_subreddits")
    .eq("account_id", acc.id);

  const days = new Set((logs ?? []).map((l) => l.activity_date as string));
  const allSubs = new Set<string>();
  for (const l of logs ?? []) {
    for (const s of ((l.joined_subreddits as string[] | null) ?? [])) allSubs.add(s);
  }
  const daysCompleted = days.size;
  const status =
    acc.warmup_status === "ready"
      ? "ready"
      : daysCompleted >= READY_AFTER_DAYS
        ? "ready"
        : "in_progress";

  await sb
    .from("reddit_accounts")
    .update({
      warmup_days_completed: daysCompleted,
      subreddits_joined: Array.from(allSubs) as never,
      warmup_status: status,
      warmup_started_at:
        acc.warmup_started_at ??
        (Array.from(days).sort()[0]
          ? new Date(`${Array.from(days).sort()[0]}T00:00:00Z`).toISOString()
          : when.toISOString()),
      ready_at: status === "ready" ? when.toISOString() : null,
      last_checked_at: when.toISOString(),
    } as never)
    .eq("id", acc.id);

  return { logged: true, account_id: acc.id, days_completed: daysCompleted };
}
