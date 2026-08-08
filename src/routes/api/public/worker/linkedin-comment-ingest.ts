// Worker → Brain: LinkedIn hozzászólás/értesítés adag beküldése.
// Auth: WORKER_API_TOKEN (Bearer) — ugyanaz, mint a többi worker-végpontnál.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const txt = (max: number) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((v) => (v === null || v === undefined ? undefined : String(v).slice(0, max)));

const ItemSchema = z.object({
  external_id: z.union([z.string(), z.number()]).transform((v) => String(v).slice(0, 200)),
  kind: txt(32),
  author: txt(160),
  author_headline: txt(300),
  context_title: txt(500),
  permalink: txt(2000),
  body: txt(4000),
  posted_at: txt(64),
});

const MetricSchema = z.object({
  impressions: z.number().int().nonnegative().optional(),
  post_url: txt(2000),
});

const BodySchema = z.object({
  own_name: txt(160),
  items: z.array(ItemSchema).max(100),
  metrics: z.array(MetricSchema).max(50).optional(),
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
          console.error(
            "linkedin ingest parse hiba",
            JSON.stringify(parsed.error.issues).slice(0, 1000),
          );
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
