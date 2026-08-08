// Worker → Brain: visszajelzés, hogy a jóváhagyott hozzászólás kiment.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  comment_id: z.string().uuid(),
  permalink: z.string().max(2000).optional(),
});

function tokenOk(request: Request): boolean {
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const tokens = [process.env.WORKER_API_TOKEN_V2, process.env.WORKER_API_TOKEN]
    .map((t) => t?.trim())
    .filter(Boolean) as string[];
  return provided.length > 0 && tokens.includes(provided);
}

export const Route = createFileRoute("/api/public/worker/linkedin-comment-posted")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!tokenOk(request)) return new Response("unauthorized", { status: 401 });
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ ok: false, error: "érvénytelen adat" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("linkedin_comments")
          .update({ reply_status: "posted", posted_at: new Date().toISOString() })
          .eq("id", parsed.data.comment_id);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const { sendTelegram } = await import("@/lib/reddit-post-patrol.server");
        await sendTelegram(
          [
            "✅ LINKEDIN · a jóváhagyott hozzászólásod kiment.",
            parsed.data.permalink ?? "",
          ]
            .filter(Boolean)
            .join("\n"),
          { topic: "linkedin_comment_ack", platform: "linkedin" },
        );
        return Response.json({ ok: true });
      },
    },
  },
});
