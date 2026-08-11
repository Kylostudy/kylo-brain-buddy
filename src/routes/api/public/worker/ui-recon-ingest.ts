// Worker → Brain: felderítő járat (UI recon) beküldése.
//
// POST { platform, page_type, url, screenshot_b64, mime_type, dom_digest, fields, workflow_id, run_id }
//   → 200 { ok, snapshot_id, learned, proposals, changed, change_note }
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN>

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  platform: z.string().min(1).max(64),
  page_type: z.string().min(1).max(64),
  url: z.string().max(1000).default(""),
  screenshot_b64: z.string().min(100).max(20 * 1024 * 1024),
  mime_type: z.enum(["image/png", "image/jpeg"]).default("image/jpeg"),
  dom_digest: z.record(z.unknown()).default({}),
  fields: z
    .array(z.object({ name: z.string().min(1).max(64), description: z.string().max(300) }))
    .max(20)
    .default([]),
  workflow_id: z.string().uuid().nullable().optional(),
  run_id: z.string().uuid().nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
});

function tokenOk(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.replace(/^Bearer\s+/i, "") || (request.headers.get("x-worker-token") ?? "")
  ).trim();
  const tokens = [process.env.WORKER_API_TOKEN_V2, process.env.WORKER_API_TOKEN]
    .map((t) => t?.trim())
    .filter(Boolean) as string[];
  return provided.length > 0 && tokens.includes(provided);
}

export const Route = createFileRoute("/api/public/worker/ui-recon-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!tokenOk(request)) return new Response("unauthorized", { status: 401 });

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { ok: false, error: "érvénytelen adat", details: parsed.error.issues },
            { status: 400 },
          );
        }

        try {
          const { processReconSnapshot } = await import("@/lib/ui-recon.server");
          const d = parsed.data;
          const result = await processReconSnapshot({
            platform: d.platform,
            pageType: d.page_type,
            url: d.url,
            screenshotB64: d.screenshot_b64,
            mimeType: d.mime_type,
            domDigest: d.dom_digest,
            fields: d.fields,
            workflowId: d.workflow_id ?? null,
            runId: d.run_id ?? null,
            taskId: d.task_id ?? null,
          });
          return Response.json({
            ok: true,
            snapshot_id: result.snapshotId,
            learned: result.learned,
            proposals: result.proposals,
            changed: result.changed,
            change_note: result.changeNote,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("ui-recon-ingest hiba:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
