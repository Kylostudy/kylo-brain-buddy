// Worker → Brain: mások LinkedIn posztjai (hozzászólás-jelöltek) beküldése.
// Auth: WORKER_API_TOKEN (Bearer).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const txt = (max: number) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((v) => (v === null || v === undefined ? undefined : String(v).slice(0, max)));

const PostSchema = z.object({
  external_id: z.union([z.string(), z.number()]).transform((v) => String(v).slice(0, 200)),
  author: txt(160),
  author_headline: txt(300),
  permalink: txt(2000),
  body: txt(4000),
  reactions: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  posted_at: txt(64),
});

const BodySchema = z.object({
  positioning: txt(600),
  posts: z.array(PostSchema).max(60),
});

function tokenOk(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  const tokens = [process.env.WORKER_API_TOKEN_V2, process.env.WORKER_API_TOKEN]
    .map((t) => t?.trim())
    .filter(Boolean) as string[];
  return provided.length > 0 && tokens.includes(provided);
}

export const Route = createFileRoute("/api/public/worker/linkedin-engage-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!tokenOk(request)) return new Response("unauthorized", { status: 401 });
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ ok: false, error: "érvénytelen adat" }, { status: 400 });
        }
        try {
          const { linkedInRadarTarget } = await import("@/lib/linkedin-radar.server");
          const { processLinkedInFeedPosts } = await import("@/lib/linkedin-engage.server");
          const { tenantId, workflowId } = await linkedInRadarTarget();
          if (!tenantId) {
            return Response.json({ ok: false, error: "nincs LinkedIn workflow" }, { status: 400 });
          }
          const result = await processLinkedInFeedPosts({
            tenantId,
            workflowId,
            positioning: parsed.data.positioning ?? null,
            posts: parsed.data.posts.map((p) => ({
              external_id: p.external_id,
              author: p.author,
              author_headline: p.author_headline,
              permalink: p.permalink,
              body: p.body,
              reactions: p.reactions,
              comments: p.comments,
              posted_at: p.posted_at ?? null,
            })),
          });
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("linkedin-engage-ingest hiba", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
