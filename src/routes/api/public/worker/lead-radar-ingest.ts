// Worker → Brain: érdeklődés-radar adag beküldése.
//
// A Reddit blokkolja a felhő-szerverek IP-jét, ezért a friss posztokat a VPS
// worker olvassa be a lakossági proxyn keresztül, és ide küldi be. A pontozás,
// mentés és Telegram-értesítés itt, a Brain oldalán történik.
//
// Auth: WORKER_API_TOKEN (Bearer) — ugyanaz, mint a többi worker-végpontnál.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const ItemSchema = z.object({
  id: z.string().min(1).max(32),
  subreddit: z.string().min(1).max(64),
  title: z.string().max(500).default(""),
  body: z.string().max(4000).default(""),
  permalink: z.string().url().max(600),
  author: z.string().max(64).default(""),
  created_utc: z.number(),
});

const BodySchema = z.object({
  items: z.array(ItemSchema).max(200),
});

function tokenOk(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  const tokens = [process.env.WORKER_API_TOKEN_V2, process.env.WORKER_API_TOKEN]
    .map((t) => t?.trim())
    .filter(Boolean) as string[];
  return provided.length > 0 && tokens.includes(provided);
}

export const Route = createFileRoute("/api/public/worker/lead-radar-ingest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!tokenOk(request)) return new Response("unauthorized", { status: 401 });
        const { leadRadarSubreddits } = await import("@/lib/lead-radar.server");
        const { subreddits } = await leadRadarSubreddits();
        return Response.json({ ok: true, subreddits });
      },
      POST: async ({ request }) => {
        if (!tokenOk(request)) return new Response("unauthorized", { status: 401 });
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ ok: false, error: "érvénytelen adat" }, { status: 400 });
        }
        try {
          const { leadRadarSubreddits, processCandidates } = await import(
            "@/lib/lead-radar.server"
          );
          const { tenantId } = await leadRadarSubreddits();
          if (!tenantId) return Response.json({ ok: false, error: "nincs tenant" }, { status: 400 });

          const result = await processCandidates(
            tenantId,
            parsed.data.items.map((i) => ({
              id: i.id,
              subreddit: i.subreddit,
              title: i.title,
              body: i.body,
              permalink: i.permalink,
              author: i.author,
              createdUtc: i.created_utc,
            })),
          );
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("lead-radar-ingest hiba", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
