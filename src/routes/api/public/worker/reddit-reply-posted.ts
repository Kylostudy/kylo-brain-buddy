// Worker → Brain: visszajelzés, hogy a jóváhagyott Reddit válasz kiment.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  ref_table: z.enum(["lead_alerts", "reddit_comments"]),
  ref_id: z.string().uuid(),
  permalink: z.string().max(2000).optional(),
});

function tokenOk(request: Request): boolean {
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const tokens = [process.env.WORKER_API_TOKEN_V2, process.env.WORKER_API_TOKEN]
    .map((t) => t?.trim())
    .filter(Boolean) as string[];
  return provided.length > 0 && tokens.includes(provided);
}

export const Route = createFileRoute("/api/public/worker/reddit-reply-posted")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!tokenOk(request)) return new Response("unauthorized", { status: 401 });
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ ok: false, error: "érvénytelen adat" }, { status: 400 });
        }
        const { ref_table, ref_id, permalink } = parsed.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date().toISOString();

        const { error } =
          ref_table === "lead_alerts"
            ? await supabaseAdmin
                .from("lead_alerts")
                .update({ status: "posted", posted_at: now })
                .eq("id", ref_id)
            : await supabaseAdmin
                .from("reddit_comments")
                .update({ reply_status: "posted", posted_at: now })
                .eq("id", ref_id);

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const { sendTelegram } = await import("@/lib/reddit-post-patrol.server");
        await sendTelegram(
          ["✅ REDDIT · a jóváhagyott válaszod kiment.", permalink ?? ""].filter(Boolean).join("\n"),
          { topic: "reddit_reply_ack", platform: "reddit", ref_table, ref_id },
        );
        return Response.json({ ok: true });
      },
    },
  },
});
