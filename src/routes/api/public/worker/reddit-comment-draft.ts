// Karma-építő kommentjavaslat a workernek.
// A worker elküldi a poszt címét/szövegét + a fiók nyelvét, a Brain pedig
// Gemini Flash-sel ír egy rövid, értékadó, REKLÁMMENTES hozzászólást.
// Ha a poszt nem alkalmas (vita, politika, segélykérés, spam), skip=true jön vissza.
//
// POST { subreddit, title, body?, language?, account? }
//   → 200 { skip: boolean, comment: string|null, reason?: string }
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN>

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

function checkAuth(request: Request): string | null {
  const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
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
  subreddit: z.string().min(1).max(80),
  title: z.string().min(1).max(600),
  body: z.string().max(6000).optional().default(""),
  top_comments: z.array(z.string().max(1200)).max(5).optional().default([]),
  language: z.string().max(20).optional().default("en"),
  account: z.string().max(80).optional().default(""),
});

const SYSTEM = `You are a normal, experienced Reddit user building a genuine account.
You write SHORT, specific, helpful comments (1-4 sentences, max ~60 words).

HARD RULES:
- Never mention, hint at or link any product, app, website, brand or service. No self-promotion whatsoever.
- No AI-sounding phrasing ("As an AI", "Great question!", "In conclusion", bullet lists, em-dashes everywhere).
- Write like a human typing quickly: casual, lowercase openings are fine, occasional contractions.
- Add ONE concrete, useful detail, experience or question. Never generic praise.
- Match the language of the post.
- If the post is political, a personal crisis, a rant, NSFW, a rule-heavy meta thread, or you have nothing genuinely useful to add, SKIP it.

Answer as JSON only: {"skip": boolean, "comment": string, "reason": string}`;

export const Route = createFileRoute("/api/public/worker/reddit-comment-draft")({
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
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: parsed.error.message }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const p = parsed.data;

        const userPrompt = [
          `Subreddit: r/${p.subreddit.replace(/^r\//, "")}`,
          `Account language: ${p.language}`,
          `Post title: ${p.title}`,
          p.body ? `Post body: ${p.body.slice(0, 3000)}` : "",
          p.top_comments.length
            ? `Existing top comments (do not repeat them):\n- ${p.top_comments.join("\n- ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: SYSTEM },
                { role: "user", content: userPrompt },
              ],
              response_format: { type: "json_object" },
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            return Response.json(
              { skip: true, comment: null, reason: `AI hiba ${res.status}: ${text.slice(0, 200)}` },
              { status: 200 },
            );
          }
          const json = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = json.choices?.[0]?.message?.content ?? "{}";
          let out: { skip?: boolean; comment?: string; reason?: string } = {};
          try {
            out = JSON.parse(content);
          } catch {
            out = { skip: true, reason: "nem parse-olható AI válasz" };
          }
          const comment = (out.comment ?? "").trim();
          const bad = /http|www\.|kylo|\.study|\.com\b/i.test(comment);
          if (out.skip || !comment || comment.length < 15 || bad) {
            return Response.json({
              skip: true,
              comment: null,
              reason: out.reason ?? (bad ? "linket/márkát tartalmazott" : "nincs érdemi mondanivaló"),
            });
          }
          return Response.json({ skip: false, comment, reason: out.reason ?? "" });
        } catch (err) {
          return Response.json({
            skip: true,
            comment: null,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  },
});
