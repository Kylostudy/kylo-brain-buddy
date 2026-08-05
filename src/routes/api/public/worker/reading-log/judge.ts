// Kylo Audit — olvasónapló "Pedagógiai bíró" végpont.
//
// A Kylo.study a Perplexityvel generálja az olvasónaplót; a worker a
// vágólapra másolt szöveget küldi ide, és mi egy Gemini Flash Lite hívással
// megbíráljuk két szempont szerint:
//   1) Kap-e a diák KÉSZ, beadható választ? (ez tilos)
//   2) AI-szagú-e a szöveg? (erős AI-szag = bukás)
//
// POST { text, book_title?, book_author?, language?, pdf_downloaded?, run_id? }
//   -> 200 { verdict, passed, failed_criteria[], ... }
//
// Auth: Bearer WORKER_API_TOKEN

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.1-flash-lite";

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function checkAuth(request: Request): string | null {
  const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ")
      ? header.slice(7)
      : (request.headers.get("x-worker-token") ?? "")
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const Body = z.object({
  run_id: z.string().uuid().nullable().optional(),
  text: z.string().default(""),
  book_title: z.string().nullable().optional(),
  book_author: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  pdf_downloaded: z.boolean().default(false),
  clipboard_ok: z.boolean().default(false),
});

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    is_ready_made_answer: { type: "boolean" },
    has_edit_placeholders: { type: "boolean" },
    placeholder_examples: { type: "array", items: { type: "string" } },
    ai_smell_score: { type: "integer" },
    ai_smell_reasons: { type: "array", items: { type: "string" } },
    matches_book: { type: "boolean" },
    language_ok: { type: "boolean" },
    summary: { type: "string" },
  },
  required: [
    "is_ready_made_answer",
    "has_edit_placeholders",
    "ai_smell_score",
    "matches_book",
    "summary",
  ],
};

const SYSTEM = `Te egy tanulást segítő pedagógiai ellenőr vagy. Egy tanulószoftver által generált OLVASÓNAPLÓ szövegét kapod meg.

A rendszer pedagógiai alapelve: a diák helyett SEMMIT nem szabad megoldani. A generált szöveg legyen kiindulási alap, amibe a diáknak bele KELL nyúlnia: gondolkodásra késztet, kiegészítendő vagy átírandó részeket tartalmaz, saját véleményt/élményt kér. Tipikusan csillagsorok, díszítősorok, "[ide írd a saját véleményedet]" jellegű kitöltendő helyek, kérdések jelzik ezt.

Két dolgot ítélj meg:
1) is_ready_made_answer: IGAZ, ha a szöveg úgy, ahogy van, beadható kész dolgozat — nincs benne semmi, amit a diáknak ki kellene egészítenie vagy át kellene írnia.
2) ai_smell_score (0-10): mennyire látszik rá elsőre, hogy AI írta. Sablonos felépítés, üres általánosságok, gépies felsorolások, "Összefoglalva elmondható, hogy..." típusú fordulatok növelik. 0 = teljesen természetes emberi hangvétel, 10 = nyilvánvalóan AI-generált. A cél, hogy egy tanár NE vegye észre.

Nézd meg azt is, hogy tényleg a megadott könyvről szól-e (matches_book), és hogy a kért nyelven van-e (language_ok).

Magyarul indokolj, tömören. Kizárólag a megadott JSON séma szerint válaszolj.`;

export const Route = createFileRoute("/api/public/worker/reading-log/judge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const err = checkAuth(request);
        if (err) return json({ error: err }, 401);
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return json({ error: "LOVABLE_API_KEY hiányzik" }, 500);

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) {
          return json({ error: "bad request", details: parsed.error.issues }, 400);
        }
        const d = parsed.data;

        const failed: string[] = [];
        const text = d.text.trim();

        // Alap-ellenőrzések AI nélkül.
        if (!d.clipboard_ok) failed.push("A vágólapra másolás nem működött.");
        if (text.length < 200) {
          failed.push(
            `A vágólapra másolt olvasónapló túl rövid (${text.length} karakter).`,
          );
        }
        if (!d.pdf_downloaded) failed.push("A PDF letöltés nem történt meg.");

        if (text.length < 60) {
          return json({
            passed: false,
            failed_criteria: failed,
            verdict: null,
            summary: "Nincs értékelhető szöveg a vágólapon.",
          });
        }

        const userMsg = `Elvárt könyv: ${d.book_title ?? "(nincs megadva)"}${
          d.book_author ? ` — ${d.book_author}` : ""
        }
Elvárt nyelv: ${d.language ?? "(nincs megadva)"}${d.country ? ` (ország: ${d.country})` : ""}

A vágólapra másolt olvasónapló szövege:
"""
${text.slice(0, 20000)}
"""`;

        let verdict: Record<string, unknown>;
        try {
          const res = await fetch(GATEWAY, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: MODEL,
              messages: [
                { role: "system", content: SYSTEM },
                { role: "user", content: userMsg },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "verdict",
                    description: "Pedagógiai ítélet az olvasónaplóról.",
                    parameters: VERDICT_SCHEMA,
                  },
                },
              ],
              tool_choice: { type: "function", function: { name: "verdict" } },
            }),
          });
          if (!res.ok) {
            const t = await res.text();
            return json({ error: `AI hiba ${res.status}: ${t.slice(0, 300)}` }, 502);
          }
          const j = (await res.json()) as {
            choices?: Array<{
              message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
            }>;
          };
          const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          verdict = args ? (JSON.parse(args) as Record<string, unknown>) : {};
        } catch (e) {
          return json({ error: `bíráló hiba: ${(e as Error).message}` }, 502);
        }

        const smell =
          typeof verdict.ai_smell_score === "number"
            ? Math.max(0, Math.min(10, Math.round(verdict.ai_smell_score)))
            : null;

        if (verdict.is_ready_made_answer === true) {
          failed.push(
            "Kész, beadható dolgozatot kapott a diák — nincs benne átszerkesztendő rész.",
          );
        }
        if (verdict.has_edit_placeholders === false) {
          failed.push(
            "Nincsenek kitöltendő / átírandó részek (csillagsor, kérdés, saját vélemény helye).",
          );
        }
        if (smell !== null && smell >= 7) {
          failed.push(`Erős AI-szag (${smell}/10) — egy tanár észrevenné, hogy AI írta.`);
        }
        if (verdict.matches_book === false) {
          failed.push(
            `A szöveg nem a kért könyvről szól (${d.book_title ?? "ismeretlen"}).`,
          );
        }
        if (verdict.language_ok === false) {
          failed.push(`A szöveg nem a kért nyelven (${d.language ?? "?"}) készült.`);
        }

        return json({
          passed: failed.length === 0,
          failed_criteria: failed,
          ai_smell_score: smell,
          verdict,
          summary: typeof verdict.summary === "string" ? verdict.summary : null,
        });
      },
    },
  },
});
