// Poszt-őrjárat cron — 10 percenként átvizsgálja az aktív figyelt Reddit posztokat.
// Auth: apikey header a Supabase publishable kulcsával.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/reddit-post-patrol")({
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
        // 2026-08-31: Poszt-őrjárat kikapcsolva (Telegram-üzenetek leállítva). Visszakapcsolás: REDDIT_MONITORING_DISABLED=0
        if (process.env.REDDIT_MONITORING_DISABLED !== "0") {
          return Response.json({ ok: true, disabled: "post patrol leállítva" });
        }
        try {
          const { patrolAllActive } = await import("@/lib/reddit-post-patrol.server");
          const result = await patrolAllActive();
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("reddit-post-patrol cron hiba", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
