// Poszt-őrjárat — kliensről hívható szerverfüggvények.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function tenantIdOf(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .single();
  const tenantId = data?.tenant_id as string | undefined;
  if (!tenantId) throw new Error("Nincs tenant azonosító.");
  return tenantId;
}

export const listPostWatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reddit_post_watches")
      .select(
        "id, workflow_id, account_id, permalink, title, subreddit, language, active, last_scanned_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const addPostWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        permalink: z.string().min(10).max(500),
        workflowId: z.string().uuid(),
        accountId: z.string().uuid().optional(),
        language: z.string().min(2).max(10).default("en"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenantIdOf(context.supabase as never, context.userId);
    const { data: row, error } = await context.supabase
      .from("reddit_post_watches")
      .insert({
        tenant_id: tenantId,
        workflow_id: data.workflowId,
        account_id: data.accountId ?? null,
        permalink: data.permalink.trim(),
        language: data.language,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const setPostWatchActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reddit_post_watches")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePostWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reddit_post_watches")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Azonnali átvizsgálás egy figyelt posztra (vagy mindre).
export const runPatrolNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ watchId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { patrolWatch, patrolAllActive } = await import("@/lib/reddit-post-patrol.server");
    if (!data.watchId) return await patrolAllActive();
    const { data: watch, error } = await context.supabase
      .from("reddit_post_watches")
      .select("id, tenant_id, workflow_id, account_id, permalink, title, subreddit")
      .eq("id", data.watchId)
      .single();
    if (error || !watch) throw new Error(error?.message ?? "Nincs ilyen figyelt poszt.");
    const r = await patrolWatch(watch);
    return { watches: 1, ...r };
  });

// Telegram-teszt: küld egy üzenetet, hogy lássuk, működik-e a csatorna.
export const sendTelegramTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { sendTelegram } = await import("@/lib/reddit-post-patrol.server");
    const r = await sendTelegram(
      "🧪 Kylo Poszt-őrjárat teszt.\n\n↩️ Válaszolj erre az üzenetre magyarul — ha megjön a visszaigazolás, a csatorna él.",
    );
    if (!r.messageId) {
      throw new Error(
        "Nem sikerült Telegram üzenetet küldeni. Ellenőrizd a Telegram kapcsolatot és a TELEGRAM_CHAT_ID beállítást.",
      );
    }
    return { ok: true, messageId: r.messageId };
  });

// Poszt-őrjárat kommentek listázása (jóváhagyott válasszal együtt).
export const listPatrolComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        status: z.enum(["pending", "approved", "answered", "ignored", "all"]).default("all"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("reddit_comments")
      .select(
        "id, permalink, subreddit, author, context_title, body_en, body_hu, suggested_reply_hu, suggested_reply_en, approved_reply_en, approved_at, reply_status, posted_at, collected_at",
      )
      .eq("source", "post_patrol")
      .order("collected_at", { ascending: false })
      .limit(200);
    if (data.status !== "all") q = q.eq("reply_status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const markPatrolCommentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "answered", "ignored"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch = {
      reply_status: data.status,
      ...(data.status === "answered" ? { answered_at: new Date().toISOString() } : {}),
    };
    const { error } = await context.supabase
      .from("reddit_comments")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
