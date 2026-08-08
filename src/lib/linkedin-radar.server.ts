// LinkedIn radar — a saját posztjaink alatti hozzászólásokat és az
// értesítéseket dolgozza fel, ugyanazzal a logikával, mint a Reddit-őrjárat:
//   1) A worker (bejelentkezve, mentett sütikkel) beolvassa a tételeket.
//   2) Itt Geminivel magyar fordítást + MAGYAR válaszjavaslatot készítünk.
//   3) Telegramon kimegy; te magyarul válaszolsz a buborékra.
//   4) A webhook lefordítja angolra és jóváhagyottként elmenti.
//
// Semmit nem posztol ki automatikusan — csak javasol.

import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendTelegram } from "@/lib/reddit-post-patrol.server";

export type LinkedInRadarItem = {
  external_id: string;
  kind?: string; // comment | reaction | mention | invite | other
  author?: string;
  author_headline?: string;
  context_title?: string;
  permalink?: string;
  body?: string;
  posted_at?: string | null;
};

async function sb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as ReturnType<typeof createClient<Database>>;
}

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
    const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    body_hu: { type: "STRING" },
    suggested_reply_hu: { type: "STRING" },
    suggested_reply_en: { type: "STRING" },
    needs_reply: { type: "BOOLEAN" },
  },
  required: ["body_hu", "suggested_reply_hu", "suggested_reply_en", "needs_reply"],
};

type Analysis = {
  body_hu: string;
  suggested_reply_hu: string;
  suggested_reply_en: string;
  needs_reply: boolean;
};

async function analyze(item: LinkedInRadarItem): Promise<Analysis | null> {
  const prompt = `Valaki reagált a LinkedIn tartalmamra. Segíts feldolgozni.

TÍPUS: ${item.kind ?? "comment"}
POSZT / KONTEXTUS: ${item.context_title ?? "(ismeretlen)"}
SZERZŐ: ${item.author ?? "(ismeretlen)"} ${item.author_headline ? `— ${item.author_headline}` : ""}
SZÖVEG:
"""
${(item.body ?? "").slice(0, 3000)}
"""

Feladat:
1) body_hu: fordítsd le természetes magyarra (ha már magyar, hagyd úgy).
2) suggested_reply_hu: rövid (2-4 mondat), barátságos, szakmai, EMBERI magyar válaszjavaslat LinkedIn-stílusban. Ne legyen marketinges, ne legyen AI-szagú, ne ígérj olyat, amit nem tudsz.
3) suggested_reply_en: ugyanez természetes, szakmai angolul.
4) needs_reply: igaz, ha érdemes válaszolni (kérdés, szakmai észrevétel, érdeklődés). Hamis, ha csak reakció / "gratulálok" típusú, vagy spam.`;
  return await geminiJSON<Analysis>(prompt, SCHEMA);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export async function processLinkedInItems(args: {
  tenantId: string;
  workflowId: string | null;
  ownName?: string | null;
  items: LinkedInRadarItem[];
}): Promise<{ saved: number; notified: number; skipped: number }> {
  const db = await sb();
  let saved = 0;
  let notified = 0;
  let skipped = 0;

  // Biztonsági háló: ha a worker mégis zajt küldene (profilmegtekintés,
  // "ismerheted", saját poszt statisztika, hírajánló), arról nem szólunk.
  const NOISE =
    /(viewed your profile|megnézte a profilod|you may know|ismerheted|powered by premium|see all views|impressions so far|megjelenítés|view more analytics|is hiring|trending|top news|work anniversary)/i;

  for (const item of args.items) {
    if (!item.external_id) continue;
    if (NOISE.test(item.body ?? "")) {
      skipped += 1;
      continue;
    }

    const { data: existing } = await db
      .from("linkedin_comments")
      .select("id")
      .eq("tenant_id", args.tenantId)
      .eq("external_id", item.external_id)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    const analysis = (item.body ?? "").trim() ? await analyze(item) : null;

    const { data: inserted } = await db
      .from("linkedin_comments")
      .insert({
        tenant_id: args.tenantId,
        workflow_id: args.workflowId,
        external_id: item.external_id,
        source: "linkedin_scan",
        kind: item.kind ?? "comment",
        author: item.author ?? null,
        author_headline: item.author_headline ?? null,
        context_title: item.context_title ?? null,
        permalink: item.permalink ?? null,
        body_en: item.body ?? "",
        body_hu: analysis?.body_hu ?? null,
        suggested_reply_hu: analysis?.suggested_reply_hu ?? null,
        suggested_reply_en: analysis?.suggested_reply_en ?? null,
        needs_reply: analysis?.needs_reply !== false,
        reply_status: "pending",
        posted_at: item.posted_at ?? null,
      })
      .select("id")
      .single();

    if (!inserted) continue;
    saved += 1;

    const needsReply = analysis?.needs_reply !== false;
    const accountLabel = args.ownName ? args.ownName : "LinkedIn profil";
    const text = [
      needsReply
        ? `🔵 LINKEDIN · ${item.kind ?? "hozzászólás"} · fiók: ${accountLabel}`
        : `⚪ LINKEDIN · ${item.kind ?? "hozzászólás"} · fiók: ${accountLabel} — szerintem NEM kell válasz`,
      item.context_title ? `Poszt: ${truncate(item.context_title, 90)}` : "",
      item.author ? `Írta: ${item.author}${item.author_headline ? ` (${truncate(item.author_headline, 60)})` : ""}` : "",
      ``,
      `EREDETI:`,
      truncate(item.body ?? "(nincs szöveg)", 700),
      ``,
      `MAGYARUL:`,
      truncate(analysis?.body_hu ?? "(nem sikerült lefordítani)", 700),
      ``,
      needsReply ? `JAVASOLT VÁLASZ (magyar):` : `MIÉRT NEM JAVASLOM:`,
      needsReply
        ? (analysis?.suggested_reply_hu ?? "(nincs javaslat)")
        : "Nem kérdés, csak visszajelzés vagy reakció. De ha mégis akarsz, csak válaszolj erre az üzenetre.",
      ``,
      item.permalink ?? "",
      ``,
      `↩️ Válaszolj ERRE az üzenetre magyarul — lefordítom angolra és előkészítem kiküldésre. Ha nem kell válasz, írd: nem`,
    ]
      .filter((l) => l !== undefined)
      .join("\n");

    const tg = await sendTelegram(text, {
      topic: "linkedin_comment",
      platform: "linkedin",
      ref_table: "linkedin_comments",
      ref_id: inserted.id,
      label: item.author ? `LinkedIn · ${item.author}` : "LinkedIn",
      payload: {
        title: item.context_title ?? null,
        url: item.permalink ?? null,
        kind: item.kind ?? "comment",
      },
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

/** Az aktív LinkedIn workflow (tenant + id) — a worker-ingest ehhez köti a tételeket. */
export async function linkedInRadarTarget(): Promise<{
  tenantId: string | null;
  workflowId: string | null;
}> {
  const db = await sb();
  const { data } = await db
    .from("workflows")
    .select("id, tenant_id, updated_at")
    .eq("platform", "linkedin")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { tenantId: data?.tenant_id ?? null, workflowId: data?.id ?? null };
}
