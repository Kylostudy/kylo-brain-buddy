// Érdeklődés-radar (Lead Radar) — READ-ONLY.
//
// Néhány percenként végigfut az angol nyelvvizsga-témájú subredditeken,
// megkeresi a FRISS kérdéseket, Geminivel pontozza, hogy tényleg olyan
// kérdés-e, amire a Kylo.study hasznos választ tud adni, és ha igen,
// AZONNAL szól Telegramon egy kész angol válaszvázlattal.
//
// Semmit nem posztol ki. A válasz mindig kézi.

import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendTelegram } from "@/lib/reddit-post-patrol.server";

const REDDIT_UA = "KyloBrain/1.0 (lead radar, read-only)";

// Ennél frissebb posztokkal foglalkozunk — a gyors válasz a lényeg.
const MAX_AGE_MINUTES = 90;
// Ennél magasabb pontszám felett szólunk.
const ALERT_THRESHOLD = 65;
const MAX_ALERTS_PER_RUN = 4;

const FALLBACK_SUBREDDITS = [
  "IELTS",
  "TOEFL",
  "ToeflAdvice",
  "CambridgeExams",
  "EnglishLearning",
  "learnenglish",
  "ENGLISH",
  "EnglishGrammar",
  "languagelearning",
];

// Előszűrő: csak akkor kérdezzük meg a modellt, ha a szöveg egyáltalán
// vizsga/tanulás-szagú. Így olcsó marad a radar.
const KEYWORDS = [
  "ielts", "toefl", "cambridge", "cae", "cpe", "b2 first", "fce", "pte", "duolingo english",
  "band score", "writing task", "speaking part", "reading section", "listening section",
  "exam", "test prep", "mock test", "practice test", "score", "grammar", "essay",
  "how do i improve", "how can i improve", "study plan", "tutor", "feedback on my writing",
];

type Json = Record<string, unknown>;
type Listing = { data?: { children?: Array<{ data?: Json }> } };

async function sb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as ReturnType<typeof createClient<Database>>;
}

// Ha a Reddit blokkol vagy HTML-t ad JSON helyett, azt külön számoljuk,
// hogy a radar sose "csendben" adjon nullát.
let blockedCount = 0;

async function redditFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": REDDIT_UA, Accept: "application/json" },
    });
    if (!res.ok) {
      blockedCount++;
      console.warn("lead-radar: Reddit válasz", res.status, url);
      return null;
    }
    const text = await res.text();
    if (!text.trimStart().startsWith("{") && !text.trimStart().startsWith("[")) {
      blockedCount++;
      console.warn("lead-radar: a Reddit HTML-t adott JSON helyett (blokkolás?)", url);
      return null;
    }
    return JSON.parse(text) as T;
  } catch (err) {
    blockedCount++;
    console.error("lead-radar reddit fetch hiba", url, err);
    return null;
  }
}


type Candidate = {
  id: string;
  subreddit: string;
  title: string;
  body: string;
  permalink: string;
  author: string;
  createdUtc: number;
};

function looksRelevant(text: string): boolean {
  const t = text.toLowerCase();
  return KEYWORDS.some((k) => t.includes(k));
}

async function collect(subreddit: string): Promise<Candidate[]> {
  const listing = await redditFetch<Listing>(
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?limit=25&raw_json=1`,
  );
  const now = Date.now() / 1000;
  const out: Candidate[] = [];
  for (const child of listing?.data?.children ?? []) {
    const d = child.data ?? {};
    if (d["stickied"] || d["over_18"]) continue;
    const createdUtc = Number(d["created_utc"] ?? 0);
    if (!createdUtc || now - createdUtc > MAX_AGE_MINUTES * 60) continue;
    const title = String(d["title"] ?? "");
    const body = String(d["selftext"] ?? "").slice(0, 1500);
    if (!looksRelevant(`${title}\n${body}`)) continue;
    out.push({
      id: String(d["id"] ?? ""),
      subreddit: String(d["subreddit"] ?? subreddit),
      title,
      body,
      permalink: `https://www.reddit.com${String(d["permalink"] ?? "")}`,
      author: String(d["author"] ?? ""),
      createdUtc,
    });
  }
  return out;
}

const SCORE_SCHEMA = {
  type: "OBJECT",
  properties: {
    score: { type: "INTEGER" },
    reason_hu: { type: "STRING" },
    reply_en: { type: "STRING" },
  },
  required: ["score", "reason_hu", "reply_en"],
};

async function scoreCandidate(c: Candidate): Promise<{
  score: number;
  reason_hu: string;
  reply_en: string;
} | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const prompt = `Egy angol nyelvvizsgára / angoltanulásra fókuszáló tanulóplatform (Kylo.study) nevében figyelem a Redditet.
A platform tud: nyelvvizsga-szimuláció (IELTS, TOEFL, Cambridge), százalékos értékelés, soronkénti magyarázat, szótanulás vonzatokkal, esszé- és beszédgyakorlás. NEM oldja meg a feladatot a tanuló helyett, hanem megtanítja.

POSZT (r/${c.subreddit})
Cím: ${c.title}
Szöveg: ${c.body || "(nincs szövegtörzs)"}

Feladat:
1) score (0-100): mennyire olyan KÉRDÉS ez, amire egy gyors, hasznos, szakértő válasz valódi értéket ad, és ahol a mi tudásunk releváns. 0, ha nem kérdés, ha panasz/mém/politika, vagy ha nem angoltanulás.
2) reason_hu: egy mondat magyarul, miért érdemes (vagy nem érdemes) válaszolni.
3) reply_en: rövid (3-5 mondat), természetes, segítőkész angol válaszvázlat Reddit-stílusban. SEMMILYEN link, márkanév, termékajánlás vagy reklám. Konkrét, gyakorlati tanács legyen.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            responseMimeType: "application/json",
            responseSchema: SCORE_SCHEMA,
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
    return JSON.parse(raw) as { score: number; reason_hu: string; reply_en: string };
  } catch {
    return null;
  }
}

// Reklámszűrő: ha a modell mégis linket vagy márkát írna, kivesszük.
function sanitize(reply: string): string {
  return reply
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bkylo(\.study)?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function runLeadRadar(): Promise<{
  scanned: number;
  candidates: number;
  alerted: number;
}> {
  const db = await sb();

  const { data: watches } = await db
    .from("reddit_readonly_watches")
    .select("tenant_id, subreddits");

  const tenantId = watches?.[0]?.tenant_id ?? null;
  if (!tenantId) {
    console.warn("lead-radar: nincs tenant (reddit_readonly_watches üres)");
    return { scanned: 0, candidates: 0, alerted: 0 };
  }

  const subs = new Set<string>(FALLBACK_SUBREDDITS);
  for (const w of watches ?? []) {
    for (const s of (w.subreddits as string[] | null) ?? []) subs.add(s);
  }

  const candidates: Candidate[] = [];
  for (const s of subs) {
    candidates.push(...(await collect(s)));
  }

  // Már ismert posztokat kihagyjuk.
  const ids = candidates.map((c) => c.id);
  const known = new Set<string>();
  if (ids.length) {
    const { data: existing } = await db
      .from("lead_alerts")
      .select("post_id")
      .eq("tenant_id", tenantId)
      .in("post_id", ids);
    for (const e of existing ?? []) known.add(e.post_id);
  }

  const fresh = candidates
    .filter((c) => c.id && !known.has(c.id))
    .sort((a, b) => b.createdUtc - a.createdUtc)
    .slice(0, 12);

  let alerted = 0;
  for (const c of fresh) {
    if (alerted >= MAX_ALERTS_PER_RUN) break;
    const verdict = await scoreCandidate(c);
    if (!verdict) continue;

    const reply = sanitize(verdict.reply_en);
    const worth = verdict.score >= ALERT_THRESHOLD;

    const { data: row } = await db
      .from("lead_alerts")
      .insert({
        tenant_id: tenantId,
        source: "reddit",
        subreddit: c.subreddit,
        post_id: c.id,
        permalink: c.permalink,
        title: c.title,
        author: c.author,
        excerpt: c.body.slice(0, 500),
        score: verdict.score,
        reason_hu: verdict.reason_hu,
        suggested_reply_en: reply,
        status: worth ? "new" : "skipped",
      })
      .select("id")
      .single();

    if (!worth || !row) continue;

    const ageMin = Math.round((Date.now() / 1000 - c.createdUtc) / 60);
    const { messageId } = await sendTelegram(
      [
        `🎯 ÉRDEKLŐDÉS · r/${c.subreddit} · ${verdict.score}/100 · ${ageMin} perce`,
        ``,
        `„${c.title}”`,
        `u/${c.author}`,
        ``,
        `Miért: ${verdict.reason_hu}`,
        ``,
        `Válaszvázlat (angol):`,
        reply,
        ``,
        c.permalink,
        ``,
        `↩️ Válaszolj erre az üzenetre, ha átírnád a választ.`,
      ].join("\n"),
      {
        topic: "lead_alert",
        platform: "reddit",
        ref_table: "lead_alerts",
        ref_id: row.id,
        label: `r/${c.subreddit}`,
        payload: { permalink: c.permalink, score: verdict.score },
      },
    );

    if (messageId) {
      await db.from("lead_alerts").update({ telegram_message_id: messageId }).eq("id", row.id);
    }
    alerted++;
  }

  return { scanned: subs.size, candidates: fresh.length, alerted };
}
