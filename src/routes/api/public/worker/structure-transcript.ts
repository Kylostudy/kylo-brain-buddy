// Leirat-tagolás a workernek (Meggyőzés Klub archívum → Kylomind).
// A worker egy nyers leirat-darabot küld, a Brain a Lovable AI-jal
// fejezetekre bontja, címeket ad, javítja az írásjeleket — tartalmat nem talál
// ki, nem rövidít. Csak szöveg jön-megy, hang/videó soha.
//
// POST { text, title?, part?, parts? } → 200 { markdown }
// Auth: Authorization: Bearer <WORKER_API_TOKEN>

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

function checkAuth(request: Request): string | null {
  const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
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
  text: z.string().min(1).max(40000),
  title: z.string().max(300).optional(),
  part: z.number().int().min(1).optional(),
  parts: z.number().int().min(1).optional(),
});

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

const SYSTEM = `Magyar nyelvű előadás-leiratot rendezel tudásbázisba (Kylomind) való betöltéshez.
Szabályok:
- A szöveg tartalmát NE változtasd meg: ne rövidíts, ne foglalj össze, ne tegyél hozzá semmit, ne hagyj ki mondatot.
- Javítsd az írásjeleket és a nyilvánvaló felismerési hibákat (pl. szóhatárok), a szóhasználat maradjon az előadóé.
- Tagold logikus fejezetekre "## " címekkel, ahol kell "### " alcímekkel; a címek rövidek, tartalmat leírók legyenek.
- Rövid, olvasható bekezdések. A felsorolásokat listaként írd.
- Csak a Markdown szöveget add vissza, bevezető vagy záró megjegyzés nélkül. Ne írj "# " főcímet.`;

export const Route = createFileRoute("/api/public/worker/structure-transcript")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr) return json({ error: authErr }, 401);
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return json({ error: "LOVABLE_API_KEY nincs beállítva" }, 500);

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }
        const p = Body.safeParse(raw);
        if (!p.success) return json({ error: "bad request", details: p.error.issues }, 400);
        const { text, title, part, parts } = p.data;

        const ctx =
          (title ? `Anyag címe: ${title}\n` : "") +
          (parts && parts > 1 ? `Ez a(z) ${part}/${parts}. rész; a fejezetcímek folytatólagosak legyenek.\n` : "");

        const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: "openai/gpt-6-astra",
            reasoning: { effort: "low" },
            instructions: SYSTEM,
            input: `${ctx}\nNyers leirat:\n\n${text}`,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          console.error(`structure-transcript AI hiba [${res.status}]: ${body.slice(0, 500)}`);
          // A státuszt megőrizzük (402/403/429 → a worker szünetel).
          return json({ error: `AI hívás sikertelen: ${res.status}`, details: body.slice(0, 500) }, res.status);
        }

        const out = (await res.json()) as {
          output_text?: string;
          output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
        };
        const markdown =
          out.output_text ??
          (out.output ?? [])
            .flatMap((o) => o.content ?? [])
            .filter((c) => c.type === "output_text" && c.text)
            .map((c) => c.text)
            .join("\n");
        if (!markdown?.trim()) return json({ error: "üres AI válasz (elutasítás?)" }, 422);
        return json({ markdown: markdown.trim() });
      },
    },
  },
});
