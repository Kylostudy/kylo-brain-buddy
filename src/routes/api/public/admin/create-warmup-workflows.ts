// Warmup workflow-k létrehozása minden proxyhoz.
//
// Egyszeri admin hívás. Végigmegy a proxies táblán (warmup_language kitöltve),
// és ha még nincs hozzá „Warmup — {ország}" nevű workflow, létrehoz egyet.
//
// Kezdő warmup_next_scheduled_at: most + 0-24 óra közötti random offset,
// hogy ne induljon minden egyszerre.
//
// Hívás:
//   curl -X POST https://<project>.lovable.app/api/public/admin/create-warmup-workflows \
//        -H "x-admin-token: <WORKER_API_TOKEN>"

import { createFileRoute } from "@tanstack/react-router";

const COUNTRY_LABELS: Record<string, string> = {
  AU: "Ausztrália",
  BR: "Brazília",
  CA: "Kanada",
  CH: "Svájc",
  ES: "Spanyolország",
  GB: "Egyesült Királyság",
  HU: "Magyarország",
  MX: "Mexikó",
  NL: "Hollandia",
  PL: "Lengyelország",
  SE: "Svédország",
  USA: "USA",
  US: "USA",
};

// Angol blokk előre — a felhasználó ezt kérte.
const PRIORITY_ORDER = ["NL", "USA", "US", "CA", "AU", "GB"];

function priorityIndex(country: string): number {
  const idx = PRIORITY_ORDER.indexOf(country);
  return idx >= 0 ? idx : PRIORITY_ORDER.length;
}

export const Route = createFileRoute("/api/public/admin/create-warmup-workflows")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-admin-token");
        if (!token || token !== process.env.WORKER_API_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: proxies, error: pErr } = await supabaseAdmin
          .from("proxies")
          .select(
            "id, tenant_id, country, warmup_language, warmup_next_scheduled_at",
          )
          .not("warmup_language", "is", null)
          .eq("is_active", true);

        if (pErr) {
          return new Response(JSON.stringify({ error: pErr.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        // Rendezés: angol blokk előre, aztán ábécé.
        const sorted = [...(proxies ?? [])].sort((a, b) => {
          const pa = priorityIndex((a.country || "").toUpperCase());
          const pb = priorityIndex((b.country || "").toUpperCase());
          if (pa !== pb) return pa - pb;
          return String(a.country).localeCompare(String(b.country));
        });

        const results: Array<{
          country: string;
          proxy_id: string;
          workflow_id?: string;
          status: string;
        }> = [];

        // A prioritás sorrendjében adjuk meg az első ütemezést:
        // első proxy = most + 1 óra, második = most + 2 óra, stb.
        // A cron majd fokozatosan lefuttatja őket, nem egyszerre.
        let hourOffset = 1;

        for (const p of sorted) {
          const country = (p.country || "").toUpperCase();
          const label = COUNTRY_LABELS[country] || country;
          const name = `${label} (${country}) — Warmup`;

          // Idempotens: már létezik-e warmup workflow ehhez a proxyhoz?
          const { data: existing } = await supabaseAdmin
            .from("workflows")
            .select("id, spec")
            .eq("tenant_id", p.tenant_id)
            .eq("module", "brain")
            .or("name.ilike.% — Warmup,name.ilike.Warmup — %")
            .limit(200);

          const alreadyForThisProxy = (existing ?? []).find((w) => {
            const s = w.spec as Record<string, unknown> | null;
            return s && s.proxy_id === p.id;
          });

          if (alreadyForThisProxy) {
            results.push({
              country,
              proxy_id: p.id,
              workflow_id: alreadyForThisProxy.id,
              status: "skipped (already exists)",
            });
            continue;
          }

          const nextScheduled = new Date(
            Date.now() + hourOffset * 60 * 60 * 1000,
          ).toISOString();
          hourOffset += 1;

          const spec = {
            monitor_type: "logged-out-warmup",
            is_warmup: true,
            proxy_id: p.id,
            language: p.warmup_language,
            duration_min: 45,
            account_label: `${label} warmup (nincs bejelentkezés)`,
            success_criteria:
              "30+ süti gyűjtése legalább 5 domain-ről, feketelistás host nélkül",
            human_behavior:
              "Poisson időzítés, kurzor overshoot, alkalmi misclick, helyi tartalom",
            warmup_cadence: "weekly",
            kill_switches: [
              "ne próbáljon bejelentkezni sehova",
              "feketelistás social platform host tiltva",
            ],
          };

          const { data: wf, error: wErr } = await supabaseAdmin
            .from("workflows")
            .insert({
              tenant_id: p.tenant_id,
              name,
              module: "brain",
              platform: null,
              language: p.warmup_language,
              region: country,
              active: true,
              ready_for_test: true,
              spec: spec as never,
            })
            .select("id")
            .single();

          if (wErr || !wf) {
            results.push({
              country,
              proxy_id: p.id,
              status: `error: ${wErr?.message ?? "unknown"}`,
            });
            continue;
          }

          // Első ütemezés beállítása a proxy-n.
          await supabaseAdmin
            .from("proxies")
            .update({ warmup_next_scheduled_at: nextScheduled })
            .eq("id", p.id);

          results.push({
            country,
            proxy_id: p.id,
            workflow_id: wf.id,
            status: `created (first run: ${nextScheduled})`,
          });
        }

        return new Response(
          JSON.stringify({ ok: true, results }, null, 2),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
