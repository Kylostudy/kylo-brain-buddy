// Reddit diskurzus-elemző — READ-ONLY.
//
// Naponta végigmegy a scout-figyelők (reddit_readonly_watches) subredditjein,
// letölti a friss + felkapott posztokat és a legfelső kommenteket, majd Geminivel
// kielemzi: MIRŐL folyik a diskurzus, milyen kérdések térnek vissza, milyen hangnem megy.
//
// Néhány (alapból 3) napnyi pillanatkép után javaslatot tesz: hova, mikor és hogyan
// érdemes beszállni — kész magyar hozzászólás-vázlattal, reklám nélkül.
//
// Semmit nem posztol ki. Csak elment és Telegramon értesít.

import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendTelegram } from "@/lib/reddit-post-patrol.server";

const REDDIT_UA = "KyloBrain/1.0 (read-only discourse analysis)";

async function sb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as ReturnType<typeof createClient<Database>>;
}

type Json = Record<string, unknown>;

async function redditFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": REDDIT_UA } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error("diskurzus reddit fetch hiba", url, err);
    return null;
  }
}

type Listing = { data?: { children?: Array<{ data?: Json }> } };

type CollectedPost = {
  id: string;
  title: string;
  body: string;
  permalink: string;
  score: number;
  numComments: number;
  createdUtc: number;
  topComments: string[];
};

async function collectSubreddit(subreddit: string): Promise<CollectedPost[]> {
  const byId = new Map<string, CollectedPost>();
  for (const path of [`new.json?limit=40`, `hot.json?limit=25`]) {
    const listing = await redditFetch<Listing>(
      `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${path}&raw_json=1`.replace(
        "json?limit",
        "json?limit",
      ),
    );
    for (const child of listing?.data?.children ?? []) {
      const d = child.data ?? {};
      if (d["stickied"] || d["over_18"]) continue;
      const id = String(d["id"] ?? "");
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        title: String(d["title"] ?? ""),
        body: String(d["selftext"] ?? "").slice(0, 900),
        permalink: `https://www.reddit.com${String(d["permalink"] ?? "")}`,
        score: Number(d["score"] ?? 0),
        numComments: Number(d["num_comments"] ?? 0),
        createdUtc: Number(d["created_utc"] ?? 0),
        topComments: [],
      });
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  const posts = [...byId.values()].sort((a, b) => b.numComments - a.numComments);

  // A legbeszédesebb 5 poszt kommentjeit is megnézzük.
  for (const post of posts.slice(0, 5)) {
    const path = post.permalink.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
    const thread = await redditFetch<Array<Listing>>(
      `https://www.reddit.com${path}.json?limit=30&depth=1&raw_json=1`,
    );
    const comments = thread?.[1]?.data?.children ?? [];
    post.topComments = comments
      .map((c) => String((c.data ?? {})["body"] ?? ""))
      .filter((t) => t && t !== "[deleted]" && t !== "[removed]")
      .slice(0, 8)
      .map((t) => t.slice(0, 400));
    await new Promise((r) => setTimeout(r, 900));
  }

  return posts;
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
            temperature: 0.5,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        }),
      },
    );
    if (!res.ok) {
      console.error("gemini diskurzus hiba", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error("gemini diskurzus kivétel", err);
    return null;
  }
}

const SNAPSHOT_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary_hu: { type: "STRING" },
    tone_hu: { type: "STRING" },
    themes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          theme_hu: { type: "STRING" },
          share_percent: { type: "INTEGER" },
          typical_question_hu: { type: "STRING" },
          pain_point_hu: { type: "STRING" },
          example_permalink: { type: "STRING" },
        },
        required: ["theme_hu", "share_percent", "typical_question_hu", "pain_point_hu"],
      },
    },
  },
  required: ["summary_hu", "tone_hu", "themes"],
};

export type DiscourseTheme = {
  theme_hu: string;
  share_percent: number;
  typical_question_hu: string;
  pain_point_hu: string;
  example_permalink?: string;
};

type SnapshotResult = {
  summary_hu: string;
  tone_hu: string;
  themes: DiscourseTheme[];
};

async function analyzeSubreddit(
  subreddit: string,
  posts: CollectedPost[],
): Promise<SnapshotResult | null> {
  const block = posts
    .slice(0, 30)
    .map(
      (p, i) =>
        `[${i + 1}] ${p.permalink}
CÍM: ${p.title}
SZÖVEG: ${p.body.slice(0, 500)}
PONT: ${p.score} · KOMMENT: ${p.numComments}
${p.topComments.length ? `TOP KOMMENTEK:\n- ${p.topComments.join("\n- ")}` : ""}`,
    )
    .join("\n\n---\n\n");

  const prompt = `Nyelvtanulási közösséget elemzel. Az alábbi friss r/${subreddit} posztok és kommentek alapján írd le MAGYARUL, hogy miről folyik itt a diskurzus.

Feladat:
- summary_hu: 4-6 mondatos, konkrét összefoglaló arról, mi foglalkoztatja most a közösséget. Ne általánosíts, hivatkozz valós témákra.
- tone_hu: 1-2 mondat a hangnemről és a bevett formátumokról (pl. mennyire elfogadott a hosszú szöveg, a kérdés, a személyes történet, mennyire allergiásak a reklámra).
- themes: 3-6 visszatérő téma. Mindegyiknél: theme_hu (rövid cím), share_percent (hozzávetőleges arány a posztokból, 0-100), typical_question_hu (a tipikus kérdés magyarul), pain_point_hu (a mögötte lévő valódi fájdalompont), example_permalink (egy konkrét link a listából).

TILOS bármilyen marketinges hangvétel. Ez belső elemzés.

ANYAG:
${block}`;

  return await geminiJSON<SnapshotResult>(prompt, SNAPSHOT_SCHEMA);
}

const SUGGESTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          headline_hu: { type: "STRING" },
          rationale_hu: { type: "STRING" },
          entry_type: { type: "STRING" },
          best_time_hu: { type: "STRING" },
          draft_hu: { type: "STRING" },
          target_permalink: { type: "STRING" },
          confidence: { type: "INTEGER" },
        },
        required: ["headline_hu", "rationale_hu", "entry_type", "best_time_hu", "draft_hu", "confidence"],
      },
    },
  },
  required: ["items"],
};

export type SuggestionItem = {
  headline_hu: string;
  rationale_hu: string;
  entry_type: string;
  best_time_hu: string;
  draft_hu: string;
  target_permalink?: string;
  confidence: number;
};

async function buildSuggestionsFor(
  subreddit: string,
  snapshots: Array<{ snapshot_date: string; summary_hu: string; tone_hu: string; themes: unknown }>,
  positioning: string,
): Promise<SuggestionItem[]> {
  const block = snapshots
    .map(
      (s) =>
        `NAP: ${s.snapshot_date}
ÖSSZEFOGLALÓ: ${s.summary_hu}
HANGNEM: ${s.tone_hu}
TÉMÁK: ${JSON.stringify(s.themes)}`,
    )
    .join("\n\n---\n\n");

  const prompt = `Az elmúlt napok r/${subreddit} diskurzus-elemzései alapján tegyél javaslatot, HOVA és HOGYAN érdemes beszállni a beszélgetésbe.

Fontos szabályok:
- SEGÍTENI akarunk, nem reklámozni. A vázlatban TILOS link, terméknév, emoji, marketinges mondat.
- Emberi, természetes hangnem. Rövid, konkrét, tapasztalatra épülő.
- Csak olyat javasolj, ami a közösség szabályaiba és szokásaiba belefér.

Adj 2-4 javaslatot. Mindegyiknél:
- headline_hu: rövid cím (mibe szállunk be)
- rationale_hu: 2-3 mondat, miért pont ez, mit láttunk az adatokban
- entry_type: "comment" (meglévő szálba) vagy "post" (saját új poszt)
- best_time_hu: mikor érdemes (nap/napszak), az adatok alapján
- draft_hu: 3-6 mondatos kész magyar vázlat, amit csak jóvá kell hagyni
- target_permalink: ha konkrét szálhoz kötődik, annak linkje, különben üres
- confidence: 0-100 magabiztosság

HÁTTÉR (kihez szólunk):
"""
${positioning.slice(0, 2500)}
"""

ELEMZÉSEK:
${block}`;

  const result = await geminiJSON<{ items: SuggestionItem[] }>(prompt, SUGGESTION_SCHEMA);
  return result?.items ?? [];
}

// ---------- Fő futás ----------

export type DiscourseRunResult = {
  subreddits: number;
  snapshots: number;
  suggestions: number;
  errors: string[];
};

const MIN_DAYS_FOR_SUGGESTIONS = 3;

export async function runDiscourseAnalysis(options?: {
  tenantId?: string;
  subreddits?: string[];
  force?: boolean;
}): Promise<DiscourseRunResult> {
  const db = await sb();
  const errors: string[] = [];

  const { data: watches, error } = await db
    .from("reddit_readonly_watches")
    .select("tenant_id, workflow_id, language_label, subreddits, positioning");
  if (error) throw new Error(error.message);

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  let snapshotCount = 0;
  let suggestionCount = 0;
  const digest: string[] = [];

  for (const watch of watches ?? []) {
    if (options?.tenantId && watch.tenant_id !== options.tenantId) continue;
    for (const rawSub of watch.subreddits ?? []) {
      const subreddit = String(rawSub).replace(/^r\//i, "").trim();
      if (!subreddit) continue;
      if (options?.subreddits && !options.subreddits.includes(subreddit)) continue;
      const key = `${watch.tenant_id}:${subreddit.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        if (!options?.force) {
          const { data: existing } = await db
            .from("reddit_discourse_snapshots")
            .select("id")
            .eq("tenant_id", watch.tenant_id)
            .eq("subreddit", subreddit)
            .eq("snapshot_date", today)
            .maybeSingle();
          if (existing) continue;
        }

        const posts = await collectSubreddit(subreddit);
        if (posts.length === 0) {
          errors.push(`r/${subreddit}: nem sikerült posztot letölteni.`);
          continue;
        }
        const analysis = await analyzeSubreddit(subreddit, posts);
        if (!analysis) {
          errors.push(`r/${subreddit}: az elemzés nem készült el (Gemini).`);
          continue;
        }

        const commentsAnalyzed = posts.reduce((n, p) => n + p.topComments.length, 0);
        const { error: upErr } = await db.from("reddit_discourse_snapshots").upsert(
          {
            tenant_id: watch.tenant_id,
            workflow_id: watch.workflow_id,
            subreddit,
            language_label: watch.language_label ?? "",
            snapshot_date: today,
            posts_analyzed: posts.length,
            comments_analyzed: commentsAnalyzed,
            themes: analysis.themes as never,
            summary_hu: analysis.summary_hu,
            tone_hu: analysis.tone_hu,
          },
          { onConflict: "tenant_id,subreddit,snapshot_date" },
        );
        if (upErr) {
          errors.push(`r/${subreddit}: mentés sikertelen — ${upErr.message}`);
          continue;
        }
        snapshotCount += 1;
        digest.push(`r/${subreddit}: ${analysis.summary_hu.slice(0, 220)}`);

        // Van-e már elég napunk javaslathoz?
        const { data: history } = await db
          .from("reddit_discourse_snapshots")
          .select("snapshot_date, summary_hu, tone_hu, themes")
          .eq("tenant_id", watch.tenant_id)
          .eq("subreddit", subreddit)
          .order("snapshot_date", { ascending: false })
          .limit(7);

        if ((history?.length ?? 0) < MIN_DAYS_FOR_SUGGESTIONS) continue;

        // Naponta egyszer elég javaslatot gyártani subredditenként.
        const since = new Date(Date.now() - 20 * 3600_000).toISOString();
        const { data: recent } = await db
          .from("reddit_discourse_suggestions")
          .select("id")
          .eq("tenant_id", watch.tenant_id)
          .eq("subreddit", subreddit)
          .gte("created_at", since)
          .limit(1);
        if (!options?.force && recent && recent.length > 0) continue;

        const items = await buildSuggestionsFor(
          subreddit,
          history ?? [],
          watch.positioning ?? "",
        );
        if (items.length === 0) continue;

        const { error: insErr } = await db.from("reddit_discourse_suggestions").insert(
          items.map((it) => ({
            tenant_id: watch.tenant_id,
            workflow_id: watch.workflow_id,
            subreddit,
            language_label: watch.language_label ?? "",
            based_on_days: history?.length ?? 0,
            headline_hu: it.headline_hu ?? "",
            rationale_hu: it.rationale_hu ?? "",
            entry_type: it.entry_type === "post" ? "post" : "comment",
            best_time_hu: it.best_time_hu ?? "",
            draft_hu: it.draft_hu ?? "",
            target_permalink: it.target_permalink || null,
            confidence: Math.max(0, Math.min(100, Number(it.confidence) || 0)),
          })),
        );
        if (insErr) {
          errors.push(`r/${subreddit}: javaslat mentése sikertelen — ${insErr.message}`);
          continue;
        }
        suggestionCount += items.length;

        const top = [...items].sort((a, b) => b.confidence - a.confidence).slice(0, 2);
        const msg = [
          `📊 Reddit diskurzus — r/${subreddit}`,
          `(${history?.length ?? 0} nap adatából)`,
          "",
          ...top.map(
            (t) =>
              `• ${t.headline_hu} [${t.confidence}%]\n${t.rationale_hu}\nMikor: ${t.best_time_hu}\n\nVázlat:\n${t.draft_hu}${
                t.target_permalink ? `\n\nSzál: ${t.target_permalink}` : ""
              }`,
          ),
        ].join("\n");
        await sendTelegram(msg.slice(0, 3800));
      } catch (err) {
        errors.push(
          `r/${subreddit}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (snapshotCount > 0 && suggestionCount === 0 && digest.length > 0) {
    await sendTelegram(
      [`📊 Reddit diskurzus — napi gyűjtés kész (${snapshotCount} subreddit)`, "", ...digest.slice(0, 8)]
        .join("\n")
        .slice(0, 3800),
    );
  }

  return { subreddits: seen.size, snapshots: snapshotCount, suggestions: suggestionCount, errors };
}
