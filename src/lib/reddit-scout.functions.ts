// Reddit read-only "scout" — figyeli a subreddit-eket bejelentkezés nélkül,
// Gemini-vel megkeresi a Kylo.study szempontjából releváns szálakat.
//
// Fontos: a Brain SEMMIT nem posztol/upvote-ol/kommentel. Csak publikus JSON-t olvas.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const REDDIT_UA = "KyloBrain/1.0 (read-only language subreddit scout)";

const KYLO_STUDY_POSITIONING_DEFAULT = `Kylo.study — nyelvtanulási és általános tanulási platform.
- Tanulási és vizsgamódban működik. Ismeri a top 10 angol + top 5 német nemzetközi nyelvvizsgát, kb. 50 típust a legnépszerűbb nyelvekből, és 20+ szakmai nyelvvizsgát.
- Százalékot ad, sosem érdemjegyet (jogi okból).
- A nyelvvizsga-modul mellett tud: olvasónapló, vizsgakérdés, vizsgaszimuláció, igaz-hamis, kvíz, tétel generálás, magyarázatok, jegyzet.
- Matek egyenletek soronkénti levezetése, matematikai tétel bizonyítása, kémia egyenletek megoldása — mindig soronkénti magyarázattal, nem a diák helyett.
- Fizika feladatok megoldása, mérnöki / anatómiai / bármilyen célú rajzok tanítása.
- Vizsgáztat 3 személyiséggel: haveri, szigorú-de-korrekt, "köcsög professzor".
- Szótanuló modul: mindig szótári alak + vonzatok + prepozíciók.
- NEM helyettesíti a diákot — megtanítja, amit meg kell.
- Filozófia: az érdemjegy egy tanárhoz köthető szubjektív számla, míg a százalék objektív. A rendszer 2 héten belül tud új vizsgatípust vagy szakmai szabályt integrálni, ha van rá igény.

Kapcsolódási pontok, amiket keresünk Redditen:
- Konkrét nyelvvizsga-előkészülési kérdés / panasz / tapasztalatkérés (IELTS, TOEFL, JLPT, DELE, CILS, HSK, Goethe, stb.).
- Önálló tanulás kihívásai, motivációhiány, iskolai kiégés alternatívája.
- Szülők, akik gyereküknek keresnek nyelvtanulást / tanulást támogató eszközt.
- Konkrét feladat, ahol a felhasználó "hogyan magyarázzam el" / "hogyan gyakoroljam" típusú kérdést tesz fel.
- Vizsgapontszám-értelmezés, ponthatárok, felkészülési stratégia.

Amiket kerülünk:
- Nyílt reklám lehetőség (Reddit szabályok szerint tilos).
- Konkrét megoldás-kérés ("csináld meg helyettem"), ez ellentétes a Kylo pedagógiájával.
- Politikai / nem-tanulási témák.
`;

// ============================================================
// Segédek
// ============================================================

type RedditPost = {
  data: {
    id: string;
    permalink: string;
    subreddit: string;
    title: string;
    author: string;
    selftext?: string;
    created_utc?: number;
    over_18?: boolean;
    stickied?: boolean;
  };
};
type RedditListing = { data: { children: RedditPost[] } };

async function fetchSubredditNew(subreddit: string, limit = 25): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?limit=${limit}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": REDDIT_UA } });
    if (!res.ok) return [];
    const json = (await res.json()) as RedditListing;
    return (json.data?.children ?? []).filter(
      (p) => p.data && !p.data.stickied && !p.data.over_18,
    );
  } catch (err) {
    console.error("reddit scout fetch error", subreddit, err);
    return [];
  }
}

async function geminiJSON<T>(prompt: string, schema: unknown): Promise<T | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
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
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error("gemini error", err);
    return null;
  }
}

const BATCH_SCORE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          post_id: { type: "STRING" },
          relevance: { type: "INTEGER" },
          angle_hu: { type: "STRING" },
          suggested_reply_hu: { type: "STRING" },
        },
        required: ["post_id", "relevance", "angle_hu", "suggested_reply_hu"],
      },
    },
  },
  required: ["items"],
};

type ScoredItem = {
  post_id: string;
  relevance: number;
  angle_hu: string;
  suggested_reply_hu: string;
};

async function scorePostsBatch(
  positioning: string,
  posts: Array<{ id: string; subreddit: string; title: string; body: string }>,
): Promise<ScoredItem[]> {
  if (posts.length === 0) return [];
  const listBlock = posts
    .map(
      (p, i) =>
        `[${i + 1}] id=${p.id} r/${p.subreddit}
CÍM: ${p.title}
SZÖVEG: ${p.body.slice(0, 800)}`,
    )
    .join("\n\n---\n\n");

  const prompt = `Te vagy egy tanulási platform (Kylo.study) social media stratégája. Az alábbi Reddit posztokat kell értékelned aszerint, hogy MENNYIRE JÓ HELY lenne bekapcsolódni a beszélgetésbe úgy, hogy SEGÍTSÜNK, ne reklámozzunk.

KYLO.STUDY POZICIONÁLÁS:
"""
${positioning}
"""

FELADAT: minden posztra adj egy JSON objektumot:
- post_id: pontosan az az id, ami a poszt fejlécében szerepel
- relevance: 0-100 pontszám (0 = teljesen érdektelen, 100 = azonnal érdemes bekapcsolódni)
- angle_hu: 1-2 mondat magyarul, hogy MIÉRT releváns (vagy miért nem), és milyen szemszögből érdemes válaszolni
- suggested_reply_hu: HA relevance >= 60, egy 3-5 mondatos, EMBERI hangvételű, magyar nyelvű válaszjavaslat, ami segít, tanácsot ad, TILOS emojit, TILOS marketinget, TILOS linket. Ha relevance < 60, üres string.

POSZTOK:
${listBlock}`;

  const result = await geminiJSON<{ items: ScoredItem[] }>(prompt, BATCH_SCORE_SCHEMA);
  return result?.items ?? [];
}

// ============================================================
// Server functions
// ============================================================

export const listRedditScoutWatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: workflows, error: wErr } = await supabase
      .from("workflows")
      .select("id, name, spec")
      .eq("module", "brain")
      .order("name", { ascending: true });
    if (wErr) throw new Error(wErr.message);
    const scoutWfs = (workflows ?? []).filter((w) => {
      const s = w.spec as Record<string, unknown> | null;
      return s?.monitor_type === "reddit-readonly-scout";
    });

    const { data: watches, error } = await supabase
      .from("reddit_readonly_watches")
      .select("*");
    if (error) throw new Error(error.message);

    return scoutWfs.map((wf) => ({
      workflow: wf,
      watch: watches?.find((w) => w.workflow_id === wf.id) ?? null,
    }));
  });

export const createRedditScoutWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120),
        languageLabel: z.string().max(80).default(""),
        subreddits: z.array(z.string().min(1).max(60)).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .single();
    const tenantId = profile?.tenant_id;
    if (!tenantId) throw new Error("Nincs tenant azonosító.");

    const { data: wf, error: wfErr } = await supabase
      .from("workflows")
      .insert({
        name: data.name,
        module: "brain",
        tenant_id: tenantId,
        status: "draft",
        spec: {
          monitor_type: "reddit-readonly-scout",
          platform: "reddit-readonly",
          language_label: data.languageLabel,
        } as never,
      })
      .select("id")
      .single();
    if (wfErr || !wf) throw new Error(wfErr?.message ?? "Workflow létrehozás sikertelen.");

    const { error: wErr } = await supabase.from("reddit_readonly_watches").insert({
      tenant_id: tenantId,
      workflow_id: wf.id,
      language_label: data.languageLabel,
      subreddits: data.subreddits.map((s) => s.replace(/^r\//i, "").trim()),
      positioning: KYLO_STUDY_POSITIONING_DEFAULT,
    });
    if (wErr) throw new Error(wErr.message);
    return { workflowId: wf.id };
  });

export const updateRedditScoutWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        languageLabel: z.string().max(80).optional(),
        subreddits: z.array(z.string().min(1).max(60)).optional(),
        positioning: z.string().max(8000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.languageLabel !== undefined) patch.language_label = data.languageLabel;
    if (data.subreddits) patch.subreddits = data.subreddits.map((s) => s.replace(/^r\//i, "").trim());
    if (data.positioning !== undefined) patch.positioning = data.positioning;
    const { error } = await context.supabase
      .from("reddit_readonly_watches")
      .update(patch)
      .eq("workflow_id", data.workflowId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listRedditScoutFindings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid().optional(),
        status: z.enum(["new", "saved", "hidden", "all"]).default("new"),
        minRelevance: z.number().min(0).max(100).default(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("reddit_readonly_findings")
      .select("*")
      .gte("relevance", data.minRelevance)
      .order("relevance", { ascending: false })
      .order("collected_at", { ascending: false })
      .limit(200);
    if (data.workflowId) q = q.eq("workflow_id", data.workflowId);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateRedditScoutFindingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["new", "saved", "hidden"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reddit_readonly_findings")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runRedditScout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ workflowId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: watch, error } = await supabase
      .from("reddit_readonly_watches")
      .select("*")
      .eq("workflow_id", data.workflowId)
      .single();
    if (error || !watch) throw new Error(error?.message ?? "Nincs figyelő beállítva.");
    if (!watch.subreddits?.length) throw new Error("Nincs subreddit megadva.");

    const positioning = watch.positioning?.trim() || KYLO_STUDY_POSITIONING_DEFAULT;

    // 1) Beolvasás
    const allPosts: Array<{ id: string; subreddit: string; title: string; body: string; author: string; permalink: string; created_utc?: number }> = [];
    for (const sub of watch.subreddits) {
      const posts = await fetchSubredditNew(sub, 25);
      for (const p of posts) {
        allPosts.push({
          id: p.data.id,
          subreddit: p.data.subreddit,
          title: p.data.title ?? "",
          body: p.data.selftext ?? "",
          author: p.data.author ?? "",
          permalink: `https://www.reddit.com${p.data.permalink ?? ""}`,
          created_utc: p.data.created_utc,
        });
      }
    }

    if (allPosts.length === 0) {
      await supabase
        .from("reddit_readonly_watches")
        .update({ last_scanned_at: new Date().toISOString() })
        .eq("id", watch.id);
      return { fetched: 0, saved: 0, skipped: 0 };
    }

    // 2) Már meglévő post_id-k kiszűrése
    const postIds = allPosts.map((p) => p.id);
    const { data: existing } = await supabase
      .from("reddit_readonly_findings")
      .select("post_id")
      .eq("workflow_id", data.workflowId)
      .in("post_id", postIds);
    const existingSet = new Set((existing ?? []).map((r) => r.post_id));
    const newPosts = allPosts.filter((p) => !existingSet.has(p.id));

    // 3) Gemini pontozás — 8-as batchekben
    let saved = 0;
    const batchSize = 8;
    for (let i = 0; i < newPosts.length; i += batchSize) {
      const batch = newPosts.slice(i, i + batchSize);
      const scores = await scorePostsBatch(positioning, batch);
      const scoreById = new Map(scores.map((s) => [s.post_id, s]));

      const rows = batch.map((p) => {
        const s = scoreById.get(p.id);
        return {
          tenant_id: watch.tenant_id,
          workflow_id: data.workflowId,
          watch_id: watch.id,
          subreddit: p.subreddit,
          post_id: p.id,
          permalink: p.permalink,
          title: p.title || null,
          author: p.author || null,
          body_excerpt: p.body ? p.body.slice(0, 2000) : null,
          post_created_at: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
          relevance: s?.relevance ?? 0,
          angle_hu: s?.angle_hu ?? null,
          suggested_reply_hu: s?.suggested_reply_hu || null,
        };
      });

      const { error: insErr } = await supabase
        .from("reddit_readonly_findings")
        .insert(rows);
      if (!insErr) saved += rows.length;
      else console.error("scout insert error", insErr);
    }

    await supabase
      .from("reddit_readonly_watches")
      .update({ last_scanned_at: new Date().toISOString() })
      .eq("id", watch.id);

    return {
      fetched: allPosts.length,
      saved,
      skipped: allPosts.length - newPosts.length,
    };
  });
