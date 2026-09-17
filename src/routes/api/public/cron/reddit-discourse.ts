// Reddit diskurzus-elemző cron — naponta végigelemzi a figyelt subredditeket.
// Auth: apikey header a Supabase publishable kulcsával.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/reddit-discourse")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronOk = await verifyCronRequest(request);
        if (!cronOk) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        // 2026-08-31: Diskurzus-elemzés kikapcsolva (IELTS/subreddit figyelés vége). Visszakapcsolás: REDDIT_MONITORING_DISABLED=0
        if (process.env.REDDIT_MONITORING_DISABLED !== "0") {
          return Response.json({ ok: true, disabled: "discourse elemzés leállítva" });
        }
        try {
          const { runDiscourseAnalysis } = await import("@/lib/reddit-discourse.server");
          const result = await runDiscourseAnalysis();
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("reddit-discourse cron hiba", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
