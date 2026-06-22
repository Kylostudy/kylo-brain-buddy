import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM_PROMPT = `Te a "Brain" vagy — egy magyar nyelvű, univerzális workflow-automatizációs asszisztens.
A felhasználó ("tenant") tetszőleges böngésző- vagy web-alapú munkafolyamatot taníthat be veled: ez lehet social media posztolás (TikTok, Instagram, LinkedIn stb.), de ugyanúgy lehet webshop-figyelés, ár- vagy készletmonitorozás (pl. "figyeld a Decathlon kínálatát, mikor jelenik meg 4XL trikó"), scraping, űrlapkitöltés, jelentéskészítés, bejelentkezéses napi rutin, vagy bármi más, amit egy ember is meg tudna csinálni böngészőben.

NE szűkítsd le magad social media feladatokra. NE utasítsd vissza a feladatot azzal, hogy "én csak social media asszisztens vagyok". Ha a kérés bármilyen ismétlődő vagy automatizálható digitális tevékenység, fogadd el és kezdj el dolgozni rajta.

FELADAT
- Emberi módon, türelmesen, EGYESÉVEL tedd fel a szükséges kérdéseket.
- Egy kérdés egyszerre, várd meg a választ, jöjjön a következő.
- Tömör, profi magyar hangvétel. Markdown megengedett.

A SPEC MEZŐI (általános értelemben töltsd ki, a feladat jellegéhez igazítva):
- platform: a cél rendszer / weboldal / szolgáltatás (pl. "TikTok", "decathlon.hu", "saját admin felület", "Gmail")
- account_label: melyik fiók vagy kontextus (pl. "magyar TikTok @kylohu", "anonim böngésző session", "saját Decathlon fiók" — ha nem kell fiók, írd: "nem szükséges")
- content_type: mit csinál a workflow (pl. "videó posztolás", "termékfigyelés", "ár scraping", "űrlapkitöltés", "riport generálás")
- content_source: honnan jön a bemenet (pl. mappa, feltöltés, AI generálás, URL lista, RSS, vagy "nincs bemenet, csak figyelés")
- media_source: KONKRÉT erőforrás vagy URL a teszthez (pl. publikus média URL, a figyelendő oldal linkje, keresési URL). Ha nem releváns, írd: "nem releváns".
- schedule: ütemezés szöveggel (pl. "minden nap 19:00 CET", "5 percenként", "egyszeri futás")
- caption_strategy: publikálási / kimeneti stratégia, vagy figyelés esetén az értesítés módja (pl. "email értesítés, ha találat van"). Ha nem releváns, hagyd ki.
- kill_switches: leállító / biztonsági szabályok (pl. "max 100 kérés / óra", "leáll, ha captcha jelenik meg", "ne lépjen be sehova")
- human_behavior: emberi viselkedés paraméterek (késleltetés, görgetés, gépelési sebesség) — ha nem érdekes, hagyd ki
- success_criteria: mit nevezünk sikeres futásnak (pl. "poszt fent van", "találat esetén kapott értesítést", "CSV letöltve")

TILTOTT TÉMÁK A CHATBEN — NE KÉRDEZD MEG:
- jelszó, 2FA kód, session cookie, semmilyen hitelesítő adat. Ezeket a felhasználó a jobb oldali "Fiók hozzáférés" űrlapon adja meg titkosítva. Ha a felhasználó mégis beleírná, NE ismételd vissza, NE mentsd a specbe — kedvesen kérd meg, hogy a jobb oldali "Fiók hozzáférés" panelen rögzítse.

MINDEN VÁLASZODBAN:
1) reply: amit a felhasználónak mondasz (magyarul, természetes hangon, EGY kérdéssel a végén — kivéve ha már kész vagy).
2) spec_patch: csak azokat a mezőket add meg, amelyeket épp most tudtál meg vagy pontosítottál. A többit hagyd ki. Ne találj ki adatot.
3) ready: true, AKKOR és csak akkor, ha a feladat jellegéhez szükséges mezők (legalább platform, content_type, media_source vagy egyértelmű cél, schedule, success_criteria és legalább 1 kill_switch) ki vannak töltve. Ilyenkor a reply-ban foglald össze 4-6 pontban a tervet, és — ha a feladathoz fiók kell — emlékeztesd a felhasználót, hogy ne felejtse el a jobb oldali "Fiók hozzáférés" űrlapot kitölteni, majd a végén kérdezd meg: "**Kész a spec, mehet a teszt?**" — ne tegyél fel új kérdést.

FONTOS: a ready=true jelzés után se írj több kérdést, csak az összefoglalót és a "Kész a spec, mehet a teszt?" kérdést.`;

type GeminiPart = { text: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    spec_patch: {
      type: "OBJECT",
      properties: {
        platform: { type: "STRING" },
        account_label: { type: "STRING" },
        content_type: { type: "STRING" },
        content_source: { type: "STRING" },
        media_source: { type: "STRING" },
        schedule: { type: "STRING" },
        caption_strategy: { type: "STRING" },
        kill_switches: { type: "ARRAY", items: { type: "STRING" } },
        human_behavior: { type: "STRING" },
        success_criteria: { type: "STRING" },
      },
    },
    ready: { type: "BOOLEAN" },
  },
  required: ["reply", "spec_patch", "ready"],
} as const;

export type RecordedAction =
  | { type: "navigate"; url: string; t: number }
  | { type: "click"; selector: string; x?: number; y?: number; text?: string; t: number }
  | { type: "type"; selector: string; value: string; t: number }
  | { type: "key"; key: string; t: number }
  | { type: "scroll"; x: number; y: number; t: number }
  | { type: "wait"; ms: number; t: number };

export type WorkflowSpec = {
  platform?: string;
  account_label?: string;
  content_type?: string;
  content_source?: string;
  media_source?: string;
  schedule?: string;
  caption_strategy?: string;
  kill_switches?: string[];
  human_behavior?: string;
  success_criteria?: string;
  recorded_actions?: RecordedAction[];
  start_url?: string;
};


type SpecPatch = WorkflowSpec;

function mergeSpec(prev: WorkflowSpec, patch: SpecPatch): WorkflowSpec {
  const next: WorkflowSpec = { ...prev };
  for (const [k, v] of Object.entries(patch) as Array<[keyof WorkflowSpec, unknown]>) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    // @ts-expect-error union assignment is fine here
    next[k] = v;
  }
  return next;
}

export const generateReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        userText: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY hiányzik a szerver környezetből.");
    }

    const { supabase } = context;

    // Load existing spec + message history
    const [{ data: wf, error: wfErr }, { data: rows, error: msgErr }] =
      await Promise.all([
        supabase
          .from("workflows")
          .select("spec")
          .eq("id", data.workflowId)
          .single(),
        supabase
          .from("messages")
          .select("role, content, created_at")
          .eq("workflow_id", data.workflowId)
          .order("created_at", { ascending: true })
          .limit(100),
      ]);
    if (wfErr) throw new Error(wfErr.message);
    if (msgErr) throw new Error(msgErr.message);

    const currentSpec: WorkflowSpec =
      (wf?.spec as WorkflowSpec | null) ?? {};

    const history: GeminiContent[] = (rows ?? []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const last = history[history.length - 1];
    if (
      !last ||
      last.role !== "user" ||
      last.parts[0]?.text !== data.userText
    ) {
      history.push({ role: "user", parts: [{ text: data.userText }] });
    }

    // Prepend current spec as context so the model knows what's already known.
    const specContext: GeminiContent = {
      role: "user",
      parts: [
        {
          text:
            `[SPEC STATE - belső kontextus, ne idézd]\n` +
            JSON.stringify(currentSpec, null, 2),
        },
      ],
    };
    const contents = [specContext, ...history];

    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
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
    const raw =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      "";

    let parsed: { reply: string; spec_patch: SpecPatch; ready: boolean };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {
        reply: raw || "_(Üres válasz a modelltől.)_",
        spec_patch: {},
        ready: false,
      };
    }

    const nextSpec = mergeSpec(currentSpec, parsed.spec_patch ?? {});

    // Persist updated spec + ready flag (only flip ready=true upward; once true stays true)
    const updatePayload: { spec: WorkflowSpec; updated_at: string; ready_for_test?: boolean } = {
      spec: nextSpec,
      updated_at: new Date().toISOString(),
    };
    if (parsed.ready === true) updatePayload.ready_for_test = true;

    const { error: updErr } = await supabase
      .from("workflows")
      .update(updatePayload as never)
      .eq("id", data.workflowId);
    if (updErr) console.error("Workflow update error", updErr);

    return {
      reply: parsed.reply,
      spec: nextSpec,
      ready: parsed.ready === true,
    };
  });

export const renameWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        name: z.string().min(1).max(120),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("workflows")
      .update({ name: data.name.trim() })
      .eq("id", data.workflowId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetReadyForTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("workflows")
      .update({ ready_for_test: false })
      .eq("id", data.workflowId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
