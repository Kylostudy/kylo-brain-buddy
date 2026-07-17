// Kylo.study QA vision elemzés — a worker screenshotot + oldal metaadatot küld,
// a Brain hívja Geminit, és visszaad egy strukturált hibalistát + becsült USD költséget.
//
// POST { screenshot_b64, page_url, page_title, expected_language, skin, dom_texts, model? }
//   -> 200 { issues: [...], cost_usd, model, tokens }
//
// Auth: Bearer WORKER_API_TOKEN

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ")
      ? header.slice(7)
      : request.headers.get("x-worker-token") ?? ""
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const Body = z.object({
  screenshot_b64: z.string().min(100),
  page_url: z.string(),
  page_title: z.string().nullable().optional(),
  expected_language: z.string(),
  skin: z.string().nullable().optional(),
  dom_texts: z
    .array(z.object({ text: z.string(), selector: z.string().nullable().optional() }))
    .max(200)
    .default([]),
  model: z.string().default("google/gemini-2.5-flash"),
  mime_type: z.enum(["image/png", "image/jpeg"]).default("image/jpeg"),
  is_home_page: z.boolean().default(false),
});

// Gemini 2.5 Flash pricing (közelítő, 2025-ös): input ~ $0.30/1M, output ~ $2.50/1M tokens.
// Pro: input ~ $1.25/1M, output ~ $10/1M.
function estimateCostUsd(model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | null): number {
  if (!usage) return 0;
  const inTok = usage.prompt_tokens ?? 0;
  const outTok = usage.completion_tokens ?? 0;
  const isPro = /pro/i.test(model);
  const inRate = isPro ? 1.25 : 0.3;
  const outRate = isPro ? 10 : 2.5;
  return (inTok * inRate + outTok * outRate) / 1_000_000;
}

const ISSUE_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor", "info"] },
          category: {
            type: "string",
            enum: [
              "translation_missing",
              "translation_wrong",
              "contrast",
              "missing_back_button",
              "broken_layout",
              "clipped_text",
              "navigation_dead_end",
              "console_error",
              "other",
            ],
          },
          selector: { type: "string" },
          problematic_text: { type: "string" },
          detected_language: { type: "string" },
          diagnosis: { type: "string" },
          suggested_fix: { type: "string" },
        },
        required: ["severity", "category", "diagnosis"],
      },
    },
    page_language_ok: { type: "boolean" },
    detected_page_language: { type: "string" },
  },
  required: ["issues"],
};

export const Route = createFileRoute("/api/public/worker/qa/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const err = checkAuth(request);
        if (err) return json({ error: err }, 401);
        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY hiányzik" }, 500);

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) return json({ error: "bad request", details: parsed.error.issues }, 400);

        const { screenshot_b64, page_url, page_title, expected_language, skin, dom_texts, model, mime_type, is_home_page } = parsed.data;

        const domSample = dom_texts.slice(0, 80).map((t, i) => `${i + 1}. [${t.selector ?? "?"}] ${t.text.slice(0, 180)}`).join("\n");
        const systemPrompt = `Te egy szigorú weboldal QA elemző vagy. A képernyőképet és a DOM szöveg mintát a "${page_url}" oldalról kaptad.
Ellenőrizd MINDET és jelentsd a hibákat strukturáltan.

Ellenőrzési kritériumok:
1) NYELV: minden látható felhasználói szöveg az elvárt "${expected_language}" nyelven van-e? Menü, gomb, hibaüzenet, tooltip, placeholder is számít. Ha egyetlen szó is más nyelven (pl. "Submit" magyar oldalon), az translation_missing (critical).
2) KONTRASZT / LÁTHATÓSÁG: van-e olvashatatlan szöveg (túl halvány, hasonló háttér, átfedés)?
3) LEVÁGOTT / KILÓGÓ szöveg: elemek túlnyúlnak-e a konténereiken vagy le vannak-e vágva (...)?
4) NAVIGÁCIÓ: ${is_home_page ? "Ez a főoldal, itt nem kell vissza gomb." : 'Ez NEM főoldal — van-e VISSZA gomb, breadcrumb vagy nav a főoldalra? Ha nincs, az missing_back_button (major).'}
5) TÖRÖTT LAYOUT: átfedő elemek, üres helyek, elcsúszott gombok.

Válaszolj CSAK a megadott JSON schema szerint. Ha nincs hiba, "issues": [].
Minden hibához adj: severity, category, rövid selector (ha látszik a DOM listából), problematic_text, detected_language (ha nyelvi), diagnosis (1 mondat magyarul), suggested_fix (1-2 mondat konkrét javítás).`;

        const userText = `Elvárt nyelv: ${expected_language}${skin ? ` | Skin: ${skin}` : ""}${page_title ? ` | Cím: ${page_title}` : ""}\nURL: ${page_url}\n\nLátható DOM szövegek (top 80):\n${domSample || "(nincs kigyűjtött szöveg)"}\n\nKeresd meg MINDEN hibát.`;

        const body = {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: userText },
                { type: "image_url", image_url: { url: `data:${mime_type};base64,${screenshot_b64}` } },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: { name: "report", description: "QA hibák jelentése.", parameters: ISSUE_SCHEMA },
            },
          ],
          tool_choice: { type: "function", function: { name: "report" } },
        };

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          return json({ error: `gemini failed ${res.status}`, details: text.slice(0, 400) }, 502);
        }
        const j = (await res.json()) as {
          choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
        };
        let parsedOut: { issues: unknown[]; page_language_ok?: boolean; detected_page_language?: string } = { issues: [] };
        const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (args) {
          try {
            parsedOut = JSON.parse(args);
          } catch {
            parsedOut = { issues: [] };
          }
        }
        const cost = estimateCostUsd(j.model ?? model, j.usage ?? null);
        return json({
          issues: parsedOut.issues ?? [],
          page_language_ok: parsedOut.page_language_ok,
          detected_page_language: parsedOut.detected_page_language,
          cost_usd: cost,
          model: j.model ?? model,
          usage: j.usage ?? null,
        });
      },
    },
  },
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
