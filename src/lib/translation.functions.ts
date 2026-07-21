// Kétirányú AI fordítás Reddit válaszokhoz.
// - Magyar → célnyelv (natív, subreddit-hangnemhez igazítva)
// - Automatikus vissza-ellenőrzés: célnyelv → magyar, hogy a felhasználó lássa,
//   tényleg azt fogja mondani, amit akart.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
        temperature: 0.5,
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

// Nyelvi címke → emberi név a promptba.
function humanLanguageName(code: string): string {
  const c = code.toLowerCase().trim();
  const map: Record<string, string> = {
    en: "English",
    "en-us": "American English",
    "en-gb": "British English",
    "en-ca": "Canadian English",
    "en-au": "Australian English",
    de: "German",
    "de-at": "Austrian German",
    "de-ch": "Swiss German",
    fr: "French",
    es: "Spanish",
    "es-mx": "Mexican Spanish",
    pt: "Portuguese",
    "pt-br": "Brazilian Portuguese",
    it: "Italian",
    nl: "Dutch",
    pl: "Polish",
    ru: "Russian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese (Simplified)",
    "zh-cn": "Chinese (Simplified)",
    "zh-tw": "Traditional Chinese",
    ar: "Arabic (Modern Standard)",
    hi: "Hindi",
    tr: "Turkish",
    id: "Indonesian",
    vi: "Vietnamese",
    th: "Thai",
    hu: "Hungarian",
  };
  return map[c] ?? code;
}

// Magyar → cél. Egyszerre visszaadja a vissza-ellenőrzést (cél → magyar) is,
// hogy a felhasználó lássa, mit fog valójában publikálni.
export const translateHuToTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        hungarian: z.string().min(1).max(4000),
        targetLang: z.string().min(2).max(10),
        subreddit: z.string().max(80).optional(),
        contextTitle: z.string().max(400).optional(),
        // Ha a felhasználó egy konkrét kommentre válaszol, ide teheti a kommentet.
        replyingTo: z.string().max(4000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const targetName = humanLanguageName(data.targetLang);
    const contextBits: string[] = [];
    if (data.subreddit) contextBits.push(`SUBREDDIT: r/${data.subreddit}`);
    if (data.contextTitle) contextBits.push(`POST TITLE: ${data.contextTitle}`);
    if (data.replyingTo) contextBits.push(`COMMENT WE'RE REPLYING TO:\n"""\n${data.replyingTo}\n"""`);
    const contextBlock = contextBits.length ? `\n${contextBits.join("\n")}\n` : "";

    const prompt = `You are helping a Hungarian founder reply on Reddit in ${targetName}.
The user speaks Hungarian and cannot write ${targetName} themselves.
${contextBlock}
HUNGARIAN DRAFT (what the user wants to say):
"""
${data.hungarian}
"""

Task:
1) "translated": Rewrite the Hungarian draft in NATIVE, natural, human-sounding ${targetName} that fits Reddit and the subreddit's tone (casual by default, more formal for r/IELTS-style learning subs). Do NOT translate word-for-word: use idiomatic native phrasing a real ${targetName} speaker would use. Keep the first person, keep the honest engineer/founder tone, no marketing, no emojis, no hashtags. Preserve any URLs, product names ("Kylo", "Kylo.study") and numbers exactly.
2) "reverseHu": Translate the ${targetName} version you produced back to natural Hungarian, faithfully, so the user can verify what will actually be posted in their name. Do not "improve" it — reflect what the ${targetName} text really says, including nuance/tone shifts.

Return ONLY JSON with keys "translated" and "reverseHu". No prose.`;

    const result = await geminiJSON<{ translated: string; reverseHu: string }>(prompt, {
      type: "OBJECT",
      properties: {
        translated: { type: "STRING" },
        reverseHu: { type: "STRING" },
      },
      required: ["translated", "reverseHu"],
    });

    return {
      translated: result?.translated ?? "",
      reverseHu: result?.reverseHu ?? "",
      targetName,
    };
  });

// Idegen nyelvű szöveg (poszt/komment) → magyar, kulturális kontextussal.
export const translateForeignToHu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        text: z.string().min(1).max(8000),
        sourceLang: z.string().min(2).max(10).optional(),
        subreddit: z.string().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sourceName = data.sourceLang ? humanLanguageName(data.sourceLang) : "the original language (detect it)";
    const subLine = data.subreddit ? `\nSUBREDDIT: r/${data.subreddit}` : "";

    const prompt = `You are helping a Hungarian founder read a Reddit post/comment written in ${sourceName}.${subLine}

ORIGINAL:
"""
${data.text}
"""

Task, return JSON:
- "hungarian": natural Hungarian translation.
- "tone": one short Hungarian sentence describing the tone (pl. "laza, ironikus", "formális, tanácskérő", "frusztrált").
- "notes": short Hungarian bullet-style notes (max 3 mondat) about cultural or idiomatic things the translation cannot capture literally (helyi utalások, szleng, hivatkozott vizsgák/termékek). Ha nincs ilyen, üres string.

Return ONLY JSON.`;

    const result = await geminiJSON<{ hungarian: string; tone: string; notes: string }>(prompt, {
      type: "OBJECT",
      properties: {
        hungarian: { type: "STRING" },
        tone: { type: "STRING" },
        notes: { type: "STRING" },
      },
      required: ["hungarian", "tone", "notes"],
    });

    return {
      hungarian: result?.hungarian ?? "",
      tone: result?.tone ?? "",
      notes: result?.notes ?? "",
    };
  });
