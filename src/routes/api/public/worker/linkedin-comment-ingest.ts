// Worker → Brain: LinkedIn hozzászólás/értesítés adag beküldése.
// Auth: WORKER_API_TOKEN (Bearer) — ugyanaz, mint a többi worker-végpontnál.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const ItemSchema = z.object({
  external_id: z.string().min(1).max(200),
  kind: z.string().max(32).optional(),
  author: z.string().max(160).optional(),
  author_headline: z.string().max(300).optional(),
  context_title: z.string().max(500).optional(),
  permalink: z.string().max(800).optional(),
  body: z.string().max(4000).optional(),
  posted_at: z.string().max(64).optional(),
});

const BodySchema = z.object({
  own_name: z.string().max(160).optional(),
  items: z.array(ItemSchema).max(100),
});

function tokenOk(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  const tokens = [process.env.WORKER_API_TOKEN_V2, process.env.WORKER_API_TOKEN]
    .map((t) => t?.trim())
    .filter(Boolean) as string[];
  return provided.length > 0 && tokens.includes(provided);
}

export const Route = createFileRoute("/api/public/worker/linkedin-comment-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!tokenOk(request)) return new Response("unauthorized", { status: 401 });
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ ok: false, error: "érvénytelen adat" }, { status: 400 });
        }
        try {
          const { linkedInRadarTarget, processLinkedInItems } = await import(
            "@/lib/linkedin-radar.server"
          );
          const { tenantId, workflowId } = await linkedInRadarTarget();
          if (!tenantId) {
            return Response.json({ ok: false, error: "nincs LinkedIn workflow" }, { status: 400 });
          }
          const result = await processLinkedInItems({
            tenantId,
            workflowId,
            ownName: parsed.data.own_name ?? null,
            items: parsed.data.items.map((i) => ({
              external_id: i.external_id,
              kind: i.kind,
              author: i.author,
              author_headline: i.author_headline,
              context_title: i.context_title,
              permalink: i.permalink,
              body: i.body,
              posted_at: i.posted_at ?? null,
            })),
          });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("linkedin-comment-ingest hiba", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
