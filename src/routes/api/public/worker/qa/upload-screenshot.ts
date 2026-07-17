// Screenshot feltöltés az audit-qa-screenshots bucketbe.
// A worker base64-et küld; a Brain szerver-oldalon dekódolja és felteszi
// service_role-lal (a bucket privát).

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-worker-token") ?? "").trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

const Body = z.object({
  run_id: z.string().uuid(),
  filename: z.string().min(3).max(200).regex(/^[a-zA-Z0-9._-]+$/),
  screenshot_b64: z.string().min(100),
  content_type: z.enum(["image/jpeg", "image/png"]).default("image/jpeg"),
});

export const Route = createFileRoute("/api/public/worker/qa/upload-screenshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const err = checkAuth(request);
        if (err) return json({ error: err }, 401);
        const p = Body.safeParse(await request.json().catch(() => null));
        if (!p.success) return json({ error: "bad request", details: p.error?.issues }, 400);
        const { run_id, filename, screenshot_b64, content_type } = p.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: run } = await supabaseAdmin.from("audit_qa_runs").select("tenant_id").eq("id", run_id).single();
        if (!run) return json({ error: "run not found" }, 404);

        const path = `${run.tenant_id}/${run_id}/${filename}`;
        const buf = Buffer.from(screenshot_b64, "base64");
        const { error } = await supabaseAdmin.storage.from("audit-qa-screenshots").upload(path, buf, {
          contentType: content_type,
          upsert: true,
        });
        if (error) return json({ error: error.message }, 500);
        return json({ path });
      },
    },
  },
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
