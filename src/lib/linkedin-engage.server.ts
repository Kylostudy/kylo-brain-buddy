// LinkedIn „idegen posztok” stratégia — ugyanaz a logika, mint a Reddit
// érdeklődés-radarnál, csak LinkedIn-re:
//   1) A worker bejelentkezve végignéz pár szakmai kulcsszót / a hírfolyamot.
//   2) Itt Geminivel eldöntjük, érdemes-e hozzászólni, és MAGYAR hozzászólás-
//      javaslatot írunk (angol változattal együtt).
//   3) Telegramra kimegy 🟣 fejléccel; te magyarul döntesz („mehet” / saját szöveg / „nem”).
//   4) A jóváhagyott hozzászólást a worker teszi ki — automatikusan SOHA.

import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendTelegram } from "@/lib/reddit-post-patrol.server";

export type LinkedInFeedPost = {
  external_id: string;
  author?: string;
  author_headline?: string;
  permalink?: string;
  body?: string;
  reactions?: number;
  comments?: number;
  posted_at?: string | null;
};

async function sb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as ReturnType<typeof createClient<Database>>;
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    relevance: { type: "INTEGER" },
    body_hu: { type: "STRING" },
    angle_hu: { type: "STRING" },
    comment_hu: { type: "STRING" },
    comment_en: { type: "STRING" },
  },
  required: ["relevance", "body_hu", "angle_hu", "comment_hu", "comment_en"],
};

type Analysis = {
  relevance: number;
  body_hu: string;
  angle_hu: string;
  comment_hu: string;
  comment_en: string;
};

async function analyze(post: LinkedInFeedPost, positioning: string): Promise<Analysis | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const prompt = `Egy LinkedIn poszt alatt szeretnék szakmailag hozzászólni.

KI VAGYOK: ${positioning}

A POSZT SZERZŐJE: ${post.author ?? "(ismeretlen)"} ${post.author_headline ? `— ${post.author_headline}` : ""}
A POSZT SZÖVEGE:
"""
${(post.body ?? "").slice(0, 3000)}
"""

Feladat (magyarul gondolkodj):
1) relevance: 0-100. Mennyire érdemes ez alatt megszólalnom? Magas, ha nyelvtanulás, IELTS/TOEFL/Cambridge, EdTech, oktatási technológia, tanulásmódszertan, AI az oktatásban a téma. Alacsony, ha toborzás, önreklám, politika, semmitmondó motivációs poszt, vagy Kína/Oroszország piac.
2) body_hu: a poszt rövid magyar összefoglalása (2-3 mondat).
3) angle_hu: egy mondatban, miért érdemes megszólalni.
4) comment_hu: konkrét, EMBERI hozzászólás-javaslat magyarul, 2-4 mondat. Adjon hozzá valódi szakmai értéket vagy tapasztalatot. TILOS: reklám, link, terméknév emlegetése, „nagyszerű poszt!” típusú üresség, AI-szagú fogalmazás.
5) comment_en: ugyanez természetes, szakmai angolul (ez megy majd ki).`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
          },
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return JSON.parse(raw) as Analysis;
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const MIN_RELEVANCE = 60;

export async function processLinkedInFeedPosts(args: {
  tenantId: string;
  workflowId: string | null;
  positioning?: string | null;
  posts: LinkedInFeedPost[];
}): Promise<{ saved: number; notified: number; skipped: number }> {
  const db = await sb();
  const positioning =
    args.positioning?.trim() ||
    "Angol nyelvvizsga-felkészítéssel (IELTS/TOEFL/Cambridge) és EdTech fejlesztéssel foglalkozom, saját tanulóplatformot építek.";

  let saved = 0;
  let notified = 0;
  let skipped = 0;

  for (const post of args.posts) {
    if (!post.external_id || !(post.body ?? "").trim()) continue;

    const { data: existing } = await db
      .from("linkedin_comments")
      .select("id")
      .eq("tenant_id", args.tenantId)
      .eq("external_id", post.external_id)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    const analysis = await analyze(post, positioning);
    if (!analysis || analysis.relevance < MIN_RELEVANCE) {
      skipped += 1;
      continue;
    }

    const { data: inserted } = await db
      .from("linkedin_comments")
      .insert({
        tenant_id: args.tenantId,
        workflow_id: args.workflowId,
        external_id: post.external_id,
        source: "engage_scan",
        kind: "feed_post",
        author: post.author ?? null,
        author_headline: post.author_headline ?? null,
        context_title: truncate(post.body ?? "", 300),
        permalink: post.permalink ?? null,
        body_en: post.body ?? "",
        body_hu: analysis.body_hu,
        suggested_reply_hu: analysis.comment_hu,
        suggested_reply_en: analysis.comment_en,
        needs_reply: true,
        reply_status: "pending",
        posted_at: post.posted_at ?? null,
      })
      .select("id")
      .single();

    if (!inserted) continue;
    saved += 1;

    const text = [
      `🟣 LINKEDIN JAVASLAT · idegen poszt · pont: ${analysis.relevance}`,
      post.author ? `Szerző: ${post.author}${post.author_headline ? ` (${truncate(post.author_headline, 60)})` : ""}` : "",
      ``,
      `MIRŐL SZÓL:`,
      truncate(analysis.body_hu, 600),
      ``,
      `MIÉRT ÉRDEMES MEGSZÓLALNI:`,
      truncate(analysis.angle_hu, 300),
      ``,
      `JAVASOLT HOZZÁSZÓLÁS (magyar):`,
      analysis.comment_hu,
      ``,
      post.permalink ?? "",
      ``,
      `↩️ „mehet” = kiteszem angolul · saját magyar szöveg = azt fordítom le és teszem ki · „nem” = kihagyjuk`,
    ]
      .filter((l) => l !== undefined)
      .join("\n");

    const tg = await sendTelegram(text, {
      topic: "linkedin_comment",
      platform: "linkedin",
      ref_table: "linkedin_comments",
      ref_id: inserted.id,
      label: post.author ? `LinkedIn · ${post.author}` : "LinkedIn",
      payload: { url: post.permalink ?? null, kind: "feed_post", score: analysis.relevance },
    });

    if (tg.messageId) {
      await db
        .from("linkedin_comments")
        .update({ telegram_message_id: tg.messageId, telegram_chat_id: tg.chatId })
        .eq("id", inserted.id);
      notified += 1;
    }
  }

  return { saved, notified, skipped };
}
