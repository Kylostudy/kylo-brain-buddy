// Őrszem: 5 percenként megnézi, jött-e friss életjel a VPS workertől.
// Ha 10 percnél régebbi az utolsó életjel, Telegramon riaszt (max fél óránként
// egyszer), és felajánlja, hogy egyetlen „újraindítás” válasszal újraindíthatod.
// Amikor visszatér az életjel, küld egy megnyugtató üzenetet is.
import { createFileRoute } from "@tanstack/react-router";

const STALE_MINUTES = 10;
const REPEAT_MINUTES = 30;

export const Route = createFileRoute("/api/public/cron/worker-health-alert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
        const provided = request.headers.get("apikey")?.trim();
        if (!expected || !provided || provided !== expected) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendTelegram } = await import("@/lib/reddit-post-patrol.server");

        const { data: hb } = await supabaseAdmin
          .from("worker_heartbeats")
          .select("created_at, worker_id")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastAt = hb?.created_at ? new Date(hb.created_at).getTime() : 0;
        const ageMin = lastAt ? Math.round((Date.now() - lastAt) / 60000) : 9999;
        const stale = ageMin > STALE_MINUTES;

        // Volt-e friss riasztás / helyreállás?
        const { data: lastMsgs } = await supabaseAdmin
          .from("telegram_outbox")
          .select("topic, created_at")
          .in("topic", ["worker_health_alert", "worker_health_ok"])
          .order("created_at", { ascending: false })
          .limit(1);
        const last = lastMsgs?.[0];
        const lastTopic = last?.topic ?? null;
        const lastAgeMin = last?.created_at
          ? (Date.now() - new Date(last.created_at).getTime()) / 60000
          : 99999;

        if (stale) {
          if (lastTopic === "worker_health_alert" && lastAgeMin < REPEAT_MINUTES) {
            return Response.json({ ok: true, stale: true, muted: true, ageMin });
          }
          // Sorban álló munka mennyisége — hogy lásd, mennyi áll
          const { count: queued } = await supabaseAdmin
            .from("brain_task_queue")
            .select("id", { count: "exact", head: true })
            .eq("status", "queued");

          await sendTelegram(
            [
              `🛑 A VPS worker nem ad életjelet.`,
              `Utolsó jelzés: ${ageMin} perce.`,
              `Sorban álló feladat: ${queued ?? 0}`,
              ``,
              `Ha újra kell indítani, elég ennyit válaszolnod erre az üzenetre:`,
              `újraindítás`,
            ].join("\n"),
            { topic: "worker_health_alert", platform: "worker" },
          );
          return Response.json({ ok: true, stale: true, alerted: true, ageMin });
        }

        if (lastTopic === "worker_health_alert") {
          await sendTelegram(
            `✅ A VPS worker újra ad életjelet (${ageMin} perce frissült). Minden fut tovább.`,
            { topic: "worker_health_ok", platform: "worker" },
          );
          return Response.json({ ok: true, stale: false, recovered: true, ageMin });
        }

        return Response.json({ ok: true, stale: false, ageMin });
      },
    },
  },
});
