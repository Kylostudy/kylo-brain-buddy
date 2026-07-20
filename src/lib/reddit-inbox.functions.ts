// Reddit Inbox — kommentek gyűjtése, fordítás, válaszjavaslat.
// A publikus Reddit JSON végpontokat használjuk (bejelentkezés nélkül),
// és csak azokat a válaszokat mentjük el, amelyek a fiók saját kommentjeire érkeztek.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const REDDIT_UA = "KyloBrain/1.0 (Reddit inbox monitor)";

type RedditListingChild = {
  kind: string;
  data: Record<string, unknown> & {
    id?: string;
    name?: string;
    parent_id?: string;
    link_id?: string;
    author?: string;
    body?: string;
    subreddit?: string;
    permalink?: string;
    link_title?: string;
    created_utc?: number;
    replies?: unknown;
  };
};
type RedditListing = {
  kind: string;
  data: { children: RedditListingChild[] };
};

async function redditFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": REDDIT_UA } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error("reddit fetch error", url, err);
    return null;
  }
}

function collectReplies(node: unknown, out: RedditListingChild[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as { data?: { children?: RedditListingChild[] } };
  const children = n.data?.children ?? [];
  for (const child of children) {
    if (child.kind !== "t1") continue;
    out.push(child);
    if (child.data?.replies) collectReplies(child.data.replies, out);
  }
}

// ------- Gemini -------
async function geminiJSON<T>(prompt: string, schema: unknown): Promise<T | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const ANALYZE_SCHEMA = {
  type: "OBJECT",
  properties: {
    body_hu: { type: "STRING" },
    suggested_reply_hu: { type: "STRING" },
    suggested_reply_en: { type: "STRING" },
  },
  required: ["body_hu", "suggested_reply_hu", "suggested_reply_en"],
};

async function analyzeComment(body: string, contextTitle: string, subreddit: string) {
  const prompt = `Egy Reddit felhasználó választ írt egy kommentemre. Segíts feldolgozni.

SUBREDDIT: ${subreddit}
POSZT CÍME: ${contextTitle}
KOMMENT (angolul):
"""
${body}
"""

Feladat:
1) body_hu: fordítsd le a kommentet természetes magyarra.
2) suggested_reply_hu: írj egy rövid, barátságos, EMBERI hangvételű magyar válaszjavaslatot (2-4 mondat). Ne legyen marketinges vagy AI-szerű. Ne használj emojikat.
3) suggested_reply_en: fordítsd le a magyar javaslatot természetes, laza angolra, hogy másolható legyen Redditbe.`;
  return await geminiJSON<{
    body_hu: string;
    suggested_reply_hu: string;
    suggested_reply_en: string;
  }>(prompt, ANALYZE_SCHEMA);
}

// ============= Server functions =============

export const listRedditAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("reddit_accounts")
      .select("id, workflow_id, username, locale, karma, account_created_at, status, notes, last_checked_at")
      .order("created_at", { ascending: true });
    if (data.workflowId) q = q.eq("workflow_id", data.workflowId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listRedditWorkflows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("workflows")
      .select("id, name, spec")
      .eq("module", "brain")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).filter((w) => {
      const s = w.spec as Record<string, unknown> | null;
      return s?.platform === "reddit";
    });
  });

export const upsertRedditAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        workflowId: z.string().uuid(),
        username: z.string().min(1).max(50),
        locale: z.string().min(2).max(10).optional(),
        notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // find tenant_id via profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    const tenantId = profile?.tenant_id;
    if (!tenantId) throw new Error("Nincs tenant azonosító.");

    if (data.id) {
      const { error } = await supabase
        .from("reddit_accounts")
        .update({
          username: data.username.trim(),
          locale: data.locale ?? "en-US",
          notes: data.notes ?? null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: inserted, error } = await supabase
      .from("reddit_accounts")
      .insert({
        tenant_id: tenantId,
        workflow_id: data.workflowId,
        username: data.username.trim(),
        locale: data.locale ?? "en-US",
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

export const deleteRedditAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("reddit_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listRedditComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid().optional(),
        status: z.enum(["pending", "answered", "ignored", "all"]).default("pending"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("reddit_comments")
      .select(
        "id, workflow_id, account_id, permalink, subreddit, author, context_title, body_en, body_hu, suggested_reply_hu, suggested_reply_en, reply_status, posted_at, collected_at",
      )
      .order("collected_at", { ascending: false })
      .limit(200);
    if (data.workflowId) q = q.eq("workflow_id", data.workflowId);
    if (data.status !== "all") q = q.eq("reply_status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateRedditCommentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "answered", "ignored"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: { reply_status: "pending" | "answered" | "ignored"; answered_at?: string } = {
      reply_status: data.status,
    };
    if (data.status === "answered") patch.answered_at = new Date().toISOString();
    const { error } = await context.supabase
      .from("reddit_comments")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// A felhasználó magyar szövegét angolra fordítja Geminivel.
export const translateReplyToEnglish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(1).max(4000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const prompt = `Fordítsd le a következő magyar üzenetet természetes, laza, EMBERI hangvételű angolra Reddit válaszhoz. Ne használj emojikat, ne legyen marketinges. Csak a tiszta angol szöveget add vissza, semmi mást.

MAGYAR:
"""
${data.text}
"""`;
    const result = await geminiJSON<{ english: string }>(prompt, {
      type: "OBJECT",
      properties: { english: { type: "STRING" } },
      required: ["english"],
    });
    return { english: result?.english ?? "" };
  });

// Reddit fiók frissítése: karma, létrehozás, új replyk begyűjtése.
export const refreshRedditAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: acc, error } = await supabase
      .from("reddit_accounts")
      .select("id, tenant_id, workflow_id, username")
      .eq("id", data.accountId)
      .single();
    if (error || !acc) throw new Error(error?.message ?? "Fiók nem található");
    if (!acc.username) throw new Error("Ehhez a fiókhoz nincs Reddit felhasználónév megadva.");

    const username = acc.username;

    // 1) About → karma / created
    const about = await redditFetch<{
      data?: { total_karma?: number; created_utc?: number };
    }>(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`);
    const karma = about?.data?.total_karma ?? null;
    const createdUtc = about?.data?.created_utc ?? null;

    // 2) Legutóbbi 15 saját komment
    const myComments = await redditFetch<RedditListing>(
      `https://www.reddit.com/user/${encodeURIComponent(username)}/comments/.json?limit=15`,
    );
    const myCommentNames = new Set<string>();
    const permalinksToCheck: string[] = [];
    for (const c of myComments?.data.children ?? []) {
      if (c.kind !== "t1") continue;
      const name = c.data.name;
      const link = c.data.permalink;
      if (typeof name === "string") myCommentNames.add(name);
      if (typeof link === "string") permalinksToCheck.push(link);
    }

    // 3) Minden ilyen saját komment thread-jét letöltjük, keressük a válaszokat.
    let newSaved = 0;
    for (const link of permalinksToCheck.slice(0, 10)) {
      const thread = await redditFetch<RedditListing[]>(
        `https://www.reddit.com${link}.json?limit=100&depth=5`,
      );
      if (!Array.isArray(thread) || thread.length < 2) continue;

      // Poszt címe az első listából
      const linkChild = thread[0]?.data?.children?.[0];
      const contextTitle =
        (linkChild?.data?.["title"] as string | undefined) ?? "";
      const subreddit = (linkChild?.data?.["subreddit"] as string | undefined) ?? "";

      const allReplies: RedditListingChild[] = [];
      collectReplies(thread[1], allReplies);

      // Csak azok a kommentek, amelyeknek a parent_id egy MI kommentünk (t1_ prefix).
      const replies = allReplies.filter((r) => {
        const parent = r.data.parent_id;
        return typeof parent === "string" && myCommentNames.has(parent) && r.data.author !== username;
      });

      for (const r of replies) {
        const externalId = r.data.name;
        const body = r.data.body;
        if (!externalId || !body) continue;

        // Már megvan?
        const { data: existing } = await supabase
          .from("reddit_comments")
          .select("id")
          .eq("workflow_id", acc.workflow_id)
          .eq("external_id", externalId)
          .maybeSingle();
        if (existing) continue;

        // AI elemzés
        const analysis = await analyzeComment(body, contextTitle, subreddit);

        const { error: insErr } = await supabase.from("reddit_comments").insert({
          tenant_id: acc.tenant_id,
          workflow_id: acc.workflow_id,
          account_id: acc.id,
          external_id: externalId,
          permalink: `https://www.reddit.com${r.data.permalink ?? ""}`,
          subreddit,
          author: r.data.author ?? null,
          context_title: contextTitle || null,
          body_en: body,
          body_hu: analysis?.body_hu ?? null,
          suggested_reply_hu: analysis?.suggested_reply_hu ?? null,
          suggested_reply_en: analysis?.suggested_reply_en ?? null,
          posted_at: r.data.created_utc
            ? new Date(r.data.created_utc * 1000).toISOString()
            : null,
        });
        if (!insErr) newSaved += 1;
      }
    }

    await supabase
      .from("reddit_accounts")
      .update({
        karma,
        account_created_at: createdUtc ? new Date(createdUtc * 1000).toISOString() : null,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", acc.id);

    return { newSaved, karma };
  });
