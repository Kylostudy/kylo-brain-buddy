// Időzített tartalom kiküldése — a Tartalom Stúdióban beállított időpontra
// (content_drafts.scheduled_for) esedékes szövegeket sorba állítja a workernek.
// pg_cron 1 percenként hívja, apikey headerrel.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/publish-scheduled-drafts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
        const provided = request.headers.get("apikey")?.trim();
        if (!expected || !provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { queueDraftToWorker } = await import("@/lib/content-queue.server");

        const nowIso = new Date().toISOString();
        const { data: due, error } = await supabaseAdmin
          .from("content_drafts")
          .select("id, scheduled_submit")
          .eq("status", "scheduled")
          .not("scheduled_for", "is", null)
          .lte("scheduled_for", nowIso)
          .limit(10);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const results: Array<{ id: string; run_id?: string; error?: string }> = [];
        for (const row of due ?? []) {
          try {
            const r = await queueDraftToWorker(supabaseAdmin as never, row.id as string, {
              submit: (row as { scheduled_submit?: boolean }).scheduled_submit !== false,
            });
            results.push({ id: row.id as string, run_id: r.run_id });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await supabaseAdmin
              .from("content_drafts")
              .update({ status: "failed", scheduled_for: null })
              .eq("id", row.id as string);
            results.push({ id: row.id as string, error: msg });
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
