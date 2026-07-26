// Kylo Audit — forgatókönyv "Bíró" végpont.
//
// A worker a futás végén elküldi a képernyőképeket + a lépésnaplót, mi pedig
// KÉT külön AI-hívást futtatunk, hogy az értékelés objektív legyen:
//   1) MEGFIGYELŐ — csak leírja, mit lát. Nem ítélkezik, nem ismeri az elvárásokat.
//   2) BÍRÓ       — csak a megfigyelő leírását és az elvárásokat kapja meg
//                   (képet NEM), és ez alapján dönt: átment / megbukott.
//
// POST { run_id?, scenario_id?, tenant_id, scenario_name, expectations,
//        exam_code?, expected_features[], step_log[], screenshots[] }
//   -> 200 { observer, judge, score, passed, summary }
//
// Auth: Bearer WORKER_API_TOKEN

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OBSERVER_MODEL = "google/gemini-2.5-flash";
const JUDGE_MODEL = "google/gemini-2.5-pro";

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-worker-token") ?? ""
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const Body = z.object({
  run_id: z.string().uuid().nullable().optional(),
  scenario_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid(),
  scenario_name: z.string().default("Névtelen forgatókönyv"),
  feature_tag: z.string().nullable().optional(),
  expectations: z.record(z.string(), z.unknown()).default({}),
  exam_code: z.string().nullable().optional(),
  exam_label: z.string().nullable().optional(),
  expected_features: z.array(z.string()).default([]),
  step_log: z.array(z.string()).max(400).default([]),
  screenshots: z
    .array(z.object({ label: z.string().default(""), b64: z.string().min(100) }))
    .max(8)
    .default([]),
  mime_type: z.enum(["image/png", "image/jpeg"]).default("image/jpeg"),
});

const OBSERVER_SCHEMA = {
  type: "object",
  properties: {
    screens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          description: { type: "string" },
          visible_texts: { type: "array", items: { type: "string" } },
          interactive_elements: { type: "array", items: { type: "string" } },
          anomalies: { type: "array", items: { type: "string" } },
        },
        required: ["description"],
      },
    },
    overall_description: { type: "string" },
  },
  required: ["screens", "overall_description"],
};

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    score: { type: "integer" },
    summary: { type: "string" },
    met_expectations: { type: "array", items: { type: "string" } },
    failed_expectations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          expectation: { type: "string" },
          why: { type: "string" },
          severity: { type: "string", enum: ["critical", "major", "minor"] },
        },
        required: ["expectation", "why", "severity"],
      },
    },
    missing_features: { type: "array", items: { type: "string" } },
  },
  required: ["passed", "score", "summary"],
};

async function callGateway(apiKey: string, body: unknown) {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI hiba ${res.status}: ${text.slice(0, 300)}`);
  }
  const j = (await res.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
  };
  const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return {};
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const Route = createFileRoute("/api/public/worker/scenario/judge")({
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
        if (!parsed.success) return json({ error: "bad request", details: parsed.error.issues }, 400);
        const d = parsed.data;

        // ── 1) MEGFIGYELŐ — nem tudja, mit várunk, csak leír.
        const observerSystem = `Te egy pártatlan megfigyelő vagy. Képernyőképeket kapsz egy weboldal tesztfutásából.
A feladatod KIZÁRÓLAG a tényszerű leírás. NE minősíts, NE mondd meg, hogy jó vagy rossz, NE találgass szándékokról.
Minden képhez írd le: mi látszik, milyen szövegek olvashatók, milyen gombok/mezők vannak, és ha valami szemmel láthatóan törött (üres terület, egymásra csúszott elem, levágott szöveg, hibaüzenet), azt tényként sorold fel.
Magyarul válaszolj, kizárólag a megadott JSON séma szerint.`;

        const observerContent: unknown[] = [
          {
            type: "text",
            text: `Tesztfutás képei (${d.screenshots.length} db). Lépésnapló (tájékoztató):\n${d.step_log.slice(0, 120).join("\n") || "(nincs)"}`,
          },
        ];
        for (const s of d.screenshots) {
          if (s.label) observerContent.push({ type: "text", text: `Kép: ${s.label}` });
          observerContent.push({
            type: "image_url",
            image_url: { url: `data:${d.mime_type};base64,${s.b64}` },
          });
        }

        let observer: Record<string, unknown>;
        try {
          observer = await callGateway(apiKey, {
            model: OBSERVER_MODEL,
            messages: [
              { role: "system", content: observerSystem },
              { role: "user", content: observerContent },
            ],
            tools: [
              {
                type: "function",
                function: { name: "describe", description: "Tényszerű leírás.", parameters: OBSERVER_SCHEMA },
              },
            ],
            tool_choice: { type: "function", function: { name: "describe" } },
          });
        } catch (e) {
          return json({ error: `megfigyelő hiba: ${(e as Error).message}` }, 502);
        }

        // ── 2) BÍRÓ — csak szöveget lát: a megfigyelő leírását + az elvárásokat.
        const judgeSystem = `Te egy szigorú, de igazságos teszt-bíró vagy. NEM látod a képeket — kizárólag egy pártatlan megfigyelő tényszerű leírását kapod meg, valamint a teszt elvárásait.
Döntsd el, hogy a leírás alapján teljesültek-e az elvárások.
Szabályok:
- Csak azt tekintsd teljesítettnek, amit a leírás alátámaszt. Ha egy elvárásról a leírás hallgat, az NEM teljesült — de ezt "minor" súllyal jelezd, ne "critical"-lal.
- A pontszám 0-100 közötti egész. 80 felett átment.
- Márkanevek, vizsganevek (IELTS, TOEFL, Cambridge stb.), nyelvi szintkódok (A1-C2) és felhasználói tartalom nem hiba.
- Magyarul, tömören indokolj. Kizárólag a megadott JSON séma szerint válaszolj.`;

        const expectationLines = Object.entries(d.expectations)
          .map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join("\n");

        const judgeUser = `Forgatókönyv: ${d.scenario_name}${d.feature_tag ? ` (funkció: ${d.feature_tag})` : ""}
${d.exam_label || d.exam_code ? `Vizsgatípus: ${d.exam_label ?? d.exam_code}` : "Vizsgatípus: nincs megadva"}
${d.expected_features.length > 0 ? `Ehhez a vizsgatípushoz elvárt funkciók:\n${d.expected_features.map((f) => `- ${f}`).join("\n")}` : ""}

Elvárások:
${expectationLines || "(nincs külön elvárás megadva — általános működést értékelj)"}

A megfigyelő leírása:
${JSON.stringify(observer, null, 2).slice(0, 24000)}

Lépésnapló:
${d.step_log.slice(0, 120).join("\n") || "(nincs)"}`;

        let judge: Record<string, unknown>;
        try {
          judge = await callGateway(apiKey, {
            model: JUDGE_MODEL,
            messages: [
              { role: "system", content: judgeSystem },
              { role: "user", content: judgeUser },
            ],
            tools: [
              {
                type: "function",
                function: { name: "verdict", description: "Ítélet a tesztfutásról.", parameters: JUDGE_SCHEMA },
              },
            ],
            tool_choice: { type: "function", function: { name: "verdict" } },
          });
        } catch (e) {
          return json({ error: `bíró hiba: ${(e as Error).message}`, observer }, 502);
        }

        const score = typeof judge.score === "number" ? Math.max(0, Math.min(100, Math.round(judge.score))) : null;
        const passed = typeof judge.passed === "boolean" ? judge.passed : score !== null ? score >= 80 : null;
        const summary = typeof judge.summary === "string" ? judge.summary : null;

        // Eredmény mentése (service role — a worker nem bejelentkezett felhasználó).
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("audit_scenario_verdicts").insert({
            tenant_id: d.tenant_id,
            scenario_id: d.scenario_id ?? null,
            run_id: d.run_id ?? null,
            exam_code: d.exam_code ?? null,
            observer: observer as never,
            judge: judge as never,
            score,
            passed,
            summary,
          });
        } catch (e) {
          console.error("[scenario/judge] mentés sikertelen:", (e as Error).message);
        }

        return json({ observer, judge, score, passed, summary });
      },
    },
  },
});
