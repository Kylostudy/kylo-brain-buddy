// Érdeklődés-radar cron — 15 percenként friss angolvizsga-kérdéseket keres a
// Redditen, és azonnal szól Telegramon. Auth: apikey header.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/lead-radar")({
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
        try {
          const { runLeadRadar } = await import("@/lib/lead-radar.server");
          const result = await runLeadRadar();
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("lead-radar cron hiba", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
