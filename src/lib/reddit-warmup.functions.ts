// Reddit Warmup — fiókok warmup állapotának kezelése és napi napló
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// -------- Accounts --------
export const listRedditWarmupAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reddit_accounts")
      .select("id, username, language, locale, proxy_id, warmup_status, warmup_started_at, warmup_days_completed, ready_at, karma, subreddits_joined, target_subreddits, notes, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertRedditWarmupAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id?: string;
    workflow_id?: string;
    username?: string | null;
    language: string;
    locale: string;
    proxy_id?: string | null;
    target_subreddits?: string[];
    notes?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("reddit_accounts")
        .update({
          username: data.username ?? null,
          language: data.language,
          locale: data.locale,
          proxy_id: data.proxy_id ?? null,
          target_subreddits: data.target_subreddits ?? [],
          notes: data.notes ?? null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    // Új fiókhoz kell egy workflow — használjuk a legelső brain workflow-t vagy adjuk meg
    if (!data.workflow_id) throw new Error("workflow_id kötelező új fiókhoz");
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) throw new Error("tenant_id hiányzik");
    const { data: row, error } = await context.supabase
      .from("reddit_accounts")
      .insert({
        tenant_id: tenantId,
        workflow_id: data.workflow_id,
        username: data.username ?? null,
        language: data.language,
        locale: data.locale,
        proxy_id: data.proxy_id ?? null,
        target_subreddits: data.target_subreddits ?? [],
        notes: data.notes ?? null,
        warmup_status: "not_started",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const startRedditWarmup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { account_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reddit_accounts")
      .update({
        warmup_status: "in_progress",
        warmup_started_at: new Date().toISOString(),
        warmup_days_completed: 0,
      })
      .eq("id", data.account_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markRedditWarmupReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { account_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reddit_accounts")
      .update({ warmup_status: "ready", ready_at: new Date().toISOString() })
      .eq("id", data.account_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Warmup log --------
export const listRedditWarmupLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { account_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reddit_warmup_log")
      .select("*")
      .eq("account_id", data.account_id)
      .order("activity_date", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const logRedditWarmupDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    account_id: string;
    activity_date?: string;
    scroll_minutes: number;
    upvotes: number;
    comments: number;
    joined_subreddits?: string[];
    notes?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) throw new Error("tenant_id hiányzik");
    const today = data.activity_date ?? new Date().toISOString().slice(0, 10);
    const { error } = await context.supabase
      .from("reddit_warmup_log")
      .upsert({
        tenant_id: tenantId,
        account_id: data.account_id,
        activity_date: today,
        scroll_minutes: data.scroll_minutes,
        upvotes: data.upvotes,
        comments: data.comments,
        joined_subreddits: data.joined_subreddits ?? [],
        notes: data.notes ?? null,
      }, { onConflict: "account_id,activity_date" });
    if (error) throw new Error(error.message);

    // Frissítjük a days_completed számlálót és a subreddits_joined listát
    const { data: logs } = await context.supabase
      .from("reddit_warmup_log")
      .select("joined_subreddits")
      .eq("account_id", data.account_id);
    const daysCompleted = logs?.length ?? 0;
    const allSubs = new Set<string>();
    for (const l of logs ?? []) {
      const arr = (l.joined_subreddits as string[] | null) ?? [];
      for (const s of arr) allSubs.add(s);
    }
    await context.supabase
      .from("reddit_accounts")
      .update({
        warmup_days_completed: daysCompleted,
        subreddits_joined: Array.from(allSubs),
      })
      .eq("id", data.account_id);
    return { ok: true, days_completed: daysCompleted };
  });

// -------- Story Bank --------
export const listRedditStories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reddit_story_bank")
      .select("*")
      .order("language", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertRedditStory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; language: string; title: string; body: string; notes?: string | null }) => d)
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("reddit_story_bank")
        .update({ language: data.language, title: data.title, body: data.body, notes: data.notes ?? null })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: prof } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) throw new Error("tenant_id hiányzik");
    const { data: row, error } = await context.supabase
      .from("reddit_story_bank")
      .insert({ tenant_id: tenantId, language: data.language, title: data.title, body: data.body, notes: data.notes ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteRedditStory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("reddit_story_bank").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Segéd: proxyk és workflow-k --------
export const listProxiesForWarmup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("proxies")
      .select("id, label, country, provider, is_active")
      .order("country", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listBrainWorkflowsForWarmup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("workflows")
      .select("id, name, platform")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
