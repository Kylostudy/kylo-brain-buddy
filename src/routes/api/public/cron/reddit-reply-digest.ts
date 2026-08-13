// Napi Reddit összesítő: egyetlen Telegram üzenet az aznap kiment válaszokról,
// a régi "minden kiküldésről külön üzenet" helyett.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/reddit-reply-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
        const provided = request.headers.get("apikey")?.trim();
        if (!expected || !provided || provided !== expected) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const [{ data: leads }, { data: comments }, { count: pending }] = await Promise.all([
          supabaseAdmin
            .from("lead_alerts")
            .select("id, subreddit, posted_permalink, posted_at")
            .eq("status", "posted")
            .gte("posted_at", since),
          supabaseAdmin
            .from("reddit_comments")
            .select("id, posted_at")
            .eq("reply_status", "posted")
            .gte("posted_at", since),
          supabaseAdmin
            .from("lead_alerts")
            .select("id", { count: "exact", head: true })
            .eq("status", "approved"),
        ]);

        const total = (leads?.length ?? 0) + (comments?.length ?? 0);
        const lines = [
          `📊 REDDIT · napi összesítő`,
          `Kiment válaszok (24 óra): ${total}`,
          `Sorban álló jóváhagyott válasz: ${pending ?? 0}`,
        ];
        for (const l of (leads ?? []).slice(0, 10)) {
          lines.push(`• r/${l.subreddit ?? "?"} ${l.posted_permalink ?? ""}`.trim());
        }

        const { sendTelegram } = await import("@/lib/reddit-post-patrol.server");
        await sendTelegram(lines.join("\n"), { topic: "reddit_daily_digest", platform: "reddit" });

        return Response.json({ ok: true, total, pending: pending ?? 0 });
      },
    },
  },
});
