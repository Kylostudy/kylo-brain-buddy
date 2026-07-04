// Gemini vision endpoint a workernek.
// A worker screenshot base64-et küld + JSON schema-t, a Brain hívja a Lovable AI
// gateway-t (google/gemini-2.5-flash), és visszaadja a strukturált eredményt.
//
// POST body { screenshot_b64, prompt, schema? }
//   → 200 { data: <a schema szerinti JSON>, model, usage }
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN>

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

const BodySchema = z.object({
  screenshot_b64: z.string().min(100).max(20 * 1024 * 1024), // max ~15MB base64
  prompt: z.string().min(1).max(8000),
  schema: z.record(z.unknown()).optional(), // opcionális JSON schema a válasz strukturálásához
  model: z.string().default("google/gemini-2.5-flash"),
  mime_type: z.enum(["image/png", "image/jpeg"]).default("image/jpeg"),
});

export const Route = createFileRoute("/api/public/worker/vision-extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        if (!LOVABLE_API_KEY)
          return new Response(
            JSON.stringify({ error: "LOVABLE_API_KEY nincs beállítva" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "invalid json" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success)
          return new Response(
            JSON.stringify({ error: "bad request", details: parsed.error.issues }),
            { status: 400, headers: { "content-type": "application/json" } },
          );

        const { screenshot_b64, prompt, schema, model, mime_type } = parsed.data;

        // Kép data URL formában (a Gateway a chat completions endpointot használja)
        const dataUrl = `data:${mime_type};base64,${screenshot_b64}`;

        const messages: Array<Record<string, unknown>> = [
          {
            role: "system",
            content:
              schema
                ? "Te egy pontos, gépi olvasásra kalibrált screenshot-elemző vagy. Csak a kért JSON-t add vissza, semmi mást. Ha egy értéket nem látsz tisztán, tedd null-ra."
                : "Te egy screenshot-elemző vagy. Válaszolj tömören, csak a kért adatokkal.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ];

        const body: Record<string, unknown> = {
          model,
          messages,
        };

        if (schema) {
          // Strukturált JSON válasz tool-calling-gal
          body.tools = [
            {
              type: "function",
              function: {
                name: "extract",
                description: "Add vissza a kinyert értékeket a megadott schema szerint.",
                parameters: schema,
              },
            },
          ];
          body.tool_choice = { type: "function", function: { name: "extract" } };
        }

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          return new Response(
            JSON.stringify({ error: `gemini call failed: ${res.status}`, details: text.slice(0, 500) }),
            { status: 502, headers: { "content-type": "application/json" } },
          );
        }

        const json = (await res.json()) as {
          choices?: Array<{
            message?: {
              content?: string | null;
              tool_calls?: Array<{ function?: { arguments?: string } }>;
            };
          }>;
          usage?: unknown;
          model?: string;
        };

        let data: unknown = null;
        const msg = json.choices?.[0]?.message;
        if (schema && msg?.tool_calls?.[0]?.function?.arguments) {
          try {
            data = JSON.parse(msg.tool_calls[0].function.arguments);
          } catch {
            data = { raw: msg.tool_calls[0].function.arguments };
          }
        } else if (msg?.content) {
          // Próbáljuk JSON-ként értelmezni, ha nem sikerül, adjuk vissza szövegként
          try {
            data = JSON.parse(msg.content);
          } catch {
            data = { text: msg.content };
          }
        }

        return new Response(
          JSON.stringify({ data, model: json.model ?? model, usage: json.usage ?? null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
