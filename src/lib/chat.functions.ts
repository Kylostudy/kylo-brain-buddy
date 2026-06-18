import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SYSTEM_PROMPT = `Te a "Brain" vagy — egy magyar nyelvű, B2B automatizációs asszisztens.
A felhasználó egy gerilla social media feltöltő platformot épít, és veled tanít be egy-egy "workflow"-t (pl. "magyar TikTok csatorna napi posztolás").

Feladatod: emberi módon, türelmesen, EGYESÉVEL tedd fel a szükséges kérdéseket, hogy fel tudd építeni a workflow specifikációját. Soha ne kérdezz egyszerre 3-4 dolgot — egy kérdés, megvárod a választ, jössz a következővel.

A betanításhoz lefedendő témák (de természetesen, beszélgető stílusban):
1. Cél platform (TikTok / Instagram / Facebook / Pinterest / YouTube / X / LinkedIn / Reddit / Threads stb.)
2. Fiók-azonosítás (melyik account, e-mail, ország/nyelv)
3. Tartalom típusa (videó / kép / szöveg / story / reel)
4. Tartalom forrása (honnan jön — feltöltés, mappa, AI generálás)
5. Ütemezés (mikor, milyen gyakran, mely időzónában)
6. Caption / hashtag stratégia
7. Kill switch szabályok (pl. ugyanazon IP-n nem futhat két TikTok egyszerre, napi limit, hibák esetén leállás)
8. Emberi viselkedés paraméterek (késleltetés, kurzormozgás random, gépelési sebesség)
9. Sikerkritérium (mit nevezünk sikeres posztnak)

Stílus: tömör, magyar, profi B2B hangvétel. Markdown formázás megengedett. Soha ne adj kódot, ha nem kér rá. Ha valami nem világos, kérdezz vissza. Ha elég infód van egy témához, foglalja össze röviden és lépj a következőre.`;

type GeminiPart = { text: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export const generateReply = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        userText: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY hiányzik a szerver környezetből.");
    }

    // Pull conversation history (read-only, public anon client is fine — RLS dev policy)
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: rows, error } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("workflow_id", data.workflowId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);

    const history: GeminiContent[] = (rows ?? []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // Append the current user message (it may not be in DB yet depending on race)
    if (
      history.length === 0 ||
      history[history.length - 1].role !== "user" ||
      history[history.length - 1].parts[0]?.text !== data.userText
    ) {
      history.push({ role: "user", parts: [{ text: data.userText }] });
    }

    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
        contents: history,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Gemini error", res.status, txt);
      throw new Error(`Gemini hiba (${res.status}): ${txt.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const reply =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      "_(Üres válasz a modelltől.)_";

    return { reply };
  });
