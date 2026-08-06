// Poszt-őrjárat — a saját Reddit posztjaink alatt figyeli az új kommenteket.
//
// Menete:
//  1) A figyelt poszt publikus JSON-ját letöltjük (bejelentkezés nélkül).
//  2) Az új, nem tőlünk származó kommenteket elmentjük a reddit_comments táblába.
//  3) Geminivel magyar fordítást + magyar/angol válaszjavaslatot készítünk.
//  4) Telegramon kiküldjük neked. Te magyarul VÁLASZOLSZ az üzenetre,
//     a webhook lefordítja angolra és jóváhagyottként elmenti.
//
// Semmit nem posztol ki automatikusan — csak javasol.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const REDDIT_UA = "KyloBrain/1.0 (post patrol)";

type Json = Record<string, unknown>;

async function sb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as ReturnType<typeof createClient<Database>>;
}

async function redditFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": REDDIT_UA } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error("post-patrol reddit fetch hiba", url, err);
    return null;
  }
}

function collectComments(node: unknown, out: Json[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as { data?: { children?: Array<{ kind?: string; data?: Json }> } };
  for (const child of n.data?.children ?? []) {
    if (child.kind !== "t1" || !child.data) continue;
    out.push(child.data);
    if (child.data["replies"]) collectComments(child.data["replies"], out);
  }
}

// ---------- Gemini ----------
async function geminiJSON<T>(prompt: string, schema: unknown): Promise<T | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
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
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
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
    needs_reply: { type: "BOOLEAN" },
  },
  required: ["body_hu", "suggested_reply_hu", "suggested_reply_en", "needs_reply"],
};

export type CommentAnalysis = {
  body_hu: string;
  suggested_reply_hu: string;
  suggested_reply_en: string;
  needs_reply: boolean;
};

async function analyzeComment(
  body: string,
  postTitle: string,
  subreddit: string,
): Promise<CommentAnalysis | null> {
  const prompt = `Valaki kommentelt a Reddit posztom alá. Segíts feldolgozni.

SUBREDDIT: r/${subreddit}
POSZT CÍME: ${postTitle}
KOMMENT:
"""
${body}
"""

Feladat:
1) body_hu: fordítsd le természetes magyarra.
2) suggested_reply_hu: rövid (2-4 mondat), barátságos, EMBERI magyar válaszjavaslat. Ne legyen marketinges, ne legyen AI-szagú, ne használj emojit, ne ígérj olyat, amit nem tudsz.
3) suggested_reply_en: ugyanez laza, természetes angolul (Reddit-stílus, kisbetűs kezdés is oké).
4) needs_reply: igaz, ha érdemes válaszolni (kérdés, vita, érdeklődés). Hamis, ha csak "nice" típusú komment, vagy nyilvánvaló spam/troll.`;
  return await geminiJSON<CommentAnalysis>(prompt, ANALYZE_SCHEMA);
}

// ---------- Telegram ----------
/**
 * Minden kimenő üzenethez elmentjük, hogy MIRŐL szólt (platform, felület,
 * melyik adatsorra hivatkozik). Így amikor a felhasználó a Telegramban
 * ráválaszol a buborékra, a webhook pontosan be tudja azonosítani.
 */
export type TelegramMeta = {
  topic?: string;
  platform?: string | null;
  ref_table?: string | null;
  ref_id?: string | null;
  label?: string | null;
  payload?: Record<string, unknown>;
};

export async function sendTelegram(
  text: string,
  meta?: TelegramMeta,
): Promise<{ messageId: number | null; chatId: number | null }> {

  const lovableKey = process.env.LOVABLE_API_KEY;
  const telegramKey = process.env.TELEGRAM_API_KEY;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!lovableKey || !telegramKey || !chatId) {
    console.warn("Poszt-őrjárat: Telegram nincs beállítva, értesítés kimarad.");
    return { messageId: null, chatId: null };
  }
  const res = await fetch(
    "https://connector-gateway.lovable.dev/telegram/sendMessage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": telegramKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  );
  if (!res.ok) {
    console.error("Telegram sendMessage hiba", res.status, await res.text());
    return { messageId: null, chatId: null };
  }
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    result?: { message_id?: number; chat?: { id?: number } };
  };
  if (json.ok === false) {
    console.error("Telegram sendMessage hiba", json.error);
    return { messageId: null, chatId: null };
  }
  const messageId = json.result?.message_id ?? null;
  const outChatId = json.result?.chat?.id ?? null;

  // Napló: melyik üzenet mire vonatkozott (válasz-azonosításhoz).
  if (messageId) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("telegram_outbox").upsert(
        {
          message_id: messageId,
          chat_id: outChatId,
          topic: meta?.topic ?? "generic",
          platform: meta?.platform ?? null,
          ref_table: meta?.ref_table ?? null,
          ref_id: meta?.ref_id ?? null,
          label: meta?.label ?? null,
          payload: (meta?.payload ?? {}) as never,
        },
        { onConflict: "message_id" },
      );
    } catch (e) {
      console.error("telegram_outbox mentés sikertelen:", e);
    }
  }

  return { messageId, chatId: outChatId };
}


function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---------- Egy figyelt poszt átvizsgálása ----------
export type PatrolWatch = {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  account_id: string | null;
  permalink: string;
  title: string | null;
  subreddit: string | null;
};

export async function patrolWatch(watch: PatrolWatch): Promise<{
  newComments: number;
  notified: number;
  error?: string;
}> {
  const db = await sb();
  if (!watch.workflow_id) {
    return { newComments: 0, notified: 0, error: "A figyelt poszthoz nincs workflow rendelve." };
  }
  const workflowId = watch.workflow_id;
  const path = watch.permalink.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
  const thread = await redditFetch<Array<{ data?: { children?: Array<{ data?: Json }> } }>>(
    `https://www.reddit.com${path}.json?limit=200&depth=6&raw_json=1`,
  );
  if (!Array.isArray(thread) || thread.length < 2) {
    return { newComments: 0, notified: 0, error: "A poszt nem tölthető le (törölve vagy privát?)" };
  }

  const post = thread[0]?.data?.children?.[0]?.data ?? {};
  const postTitle = (post["title"] as string | undefined) ?? watch.title ?? "";
  const subreddit = (post["subreddit"] as string | undefined) ?? watch.subreddit ?? "";
  const postAuthor = (post["author"] as string | undefined) ?? "";

  // Saját felhasználónév (ne értesítsünk a saját kommentünkről)
  let ownUsername = postAuthor;
  if (watch.account_id) {
    const { data: acc } = await db
      .from("reddit_accounts")
      .select("username")
      .eq("id", watch.account_id)
      .maybeSingle();
    if (acc?.username) ownUsername = acc.username;
  }

  const comments: Json[] = [];
  collectComments(thread[1], comments);

  let newComments = 0;
  let notified = 0;

  for (const c of comments) {
    const externalId = c["name"] as string | undefined;
    const body = c["body"] as string | undefined;
    const author = c["author"] as string | undefined;
    if (!externalId || !body || !author) continue;
    if (author === ownUsername || author === "AutoModerator" || author === "[deleted]") continue;

    const { data: existing } = await db
      .from("reddit_comments")
      .select("id")
      .eq("tenant_id", watch.tenant_id)
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) continue;

    const analysis = await analyzeComment(body, postTitle, subreddit);
    const permalink = (c["permalink"] as string | undefined) ?? watch.permalink;
    const createdUtc = c["created_utc"] as number | undefined;

    const { data: inserted } = await db
      .from("reddit_comments")
      .insert({
        tenant_id: watch.tenant_id,
        workflow_id: workflowId,
        account_id: watch.account_id,
        watch_id: watch.id,
        source: "post_patrol",
        external_id: externalId,
        permalink: permalink.startsWith("http")
          ? permalink
          : `https://www.reddit.com${permalink}`,
        subreddit,
        author,
        context_title: postTitle,
        body_en: body,
        body_hu: analysis?.body_hu ?? null,
        suggested_reply_hu: analysis?.suggested_reply_hu ?? null,
        suggested_reply_en: analysis?.suggested_reply_en ?? null,
        reply_status: "pending",
        posted_at: createdUtc ? new Date(createdUtc * 1000).toISOString() : null,
      })
      .select("id")
      .single();

    newComments += 1;
    if (!inserted) continue;

    const needsReply = analysis?.needs_reply !== false;

    const link = permalink.startsWith("http")
      ? permalink
      : `https://www.reddit.com${permalink}`;
    const accountLabel = ownUsername ? `u/${ownUsername}` : "ismeretlen fiók";
    const text = [
      needsReply
        ? `🟠 REDDIT · r/${subreddit} · fiók: ${accountLabel}`
        : `⚪ REDDIT · r/${subreddit} · fiók: ${accountLabel} — szerintem NEM kell válasz`,
      `Poszt: ${truncate(postTitle, 90)}`,
      `Kommentelő: u/${author}`,
      ``,
      `EREDETI:`,
      truncate(body, 700),
      ``,
      `MAGYARUL:`,
      truncate(analysis?.body_hu ?? "(nem sikerült lefordítani)", 700),
      ``,
      needsReply ? `JAVASOLT VÁLASZ (magyar):` : `MIÉRT NEM JAVASLOM:`,
      needsReply
        ? (analysis?.suggested_reply_hu ?? "(nincs javaslat)")
        : "Nem kérdés, nem vita — sima visszajelzés, spam vagy troll. De ha mégis akarsz, csak válaszolj erre az üzenetre.",
      ``,
      `${link}`,
      ``,
      `↩️ Válaszolj ERRE az üzenetre magyarul — lefordítom angolra és előkészítem kiküldésre. Ha nem kell válasz, írd: nem`,
    ].join("\n");


    const tg = await sendTelegram(text, {
      topic: "reddit_comment",
      platform: "reddit",
      ref_table: "reddit_comments",
      ref_id: inserted.id,
      label: `r/${subreddit} · u/${author}`,
      payload: { post_title: postTitle, permalink: link, own_account: ownUsername },
    });

    if (tg.messageId) {
      await db
        .from("reddit_comments")
        .update({ telegram_message_id: tg.messageId, telegram_chat_id: tg.chatId })
        .eq("id", inserted.id);
      notified += 1;
    }
  }

  await db
    .from("reddit_post_watches")
    .update({
      last_scanned_at: new Date().toISOString(),
      title: postTitle || watch.title,
      subreddit: subreddit || watch.subreddit,
    })
    .eq("id", watch.id);

  return { newComments, notified };
}

export async function patrolAllActive(): Promise<{
  watches: number;
  newComments: number;
  notified: number;
}> {
  const db = await sb();
  const { data: watches } = await db
    .from("reddit_post_watches")
    .select("id, tenant_id, workflow_id, account_id, permalink, title, subreddit")
    .eq("active", true);

  let newComments = 0;
  let notified = 0;
  for (const w of watches ?? []) {
    const r = await patrolWatch(w as PatrolWatch);
    newComments += r.newComments;
    notified += r.notified;
  }
  return { watches: watches?.length ?? 0, newComments, notified };
}

// Magyar → angol fordítás a Telegram-válaszokhoz.
export async function translateToEnglish(hungarian: string): Promise<string> {
  const prompt = `Fordítsd le a következő magyar üzenetet természetes, laza, EMBERI hangvételű angolra Reddit-válaszhoz. Ne használj emojit, ne legyen marketinges. Csak a tiszta angol szöveget add vissza.

MAGYAR:
"""
${hungarian}
"""`;
  const r = await geminiJSON<{ english: string }>(prompt, {
    type: "OBJECT",
    properties: { english: { type: "STRING" } },
    required: ["english"],
  });
  return r?.english ?? "";
}
