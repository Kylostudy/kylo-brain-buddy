import { createFileRoute } from "@tanstack/react-router";
import { encryptString } from "@/lib/credentials/crypto.server";

const TENANT_ID = "c13c29af-b546-41e3-a4d5-9b3bb3a71326";

const COUNTRIES: Array<{ code: string; label: string }> = [
  { code: "ch", label: "Svájc" },
  { code: "es", label: "Spanyolország" },
  { code: "hu", label: "Magyarország" },
  { code: "se", label: "Svédország" },
  { code: "pl", label: "Lengyelország" },
  { code: "gb", label: "Egyesült Királyság" },
  { code: "mx", label: "Mexikó" },
  { code: "br", label: "Brazília" },
  { code: "ca", label: "Kanada" },
  { code: "au", label: "Ausztrália" },
];

export const Route = createFileRoute("/api/public/admin/import-brightdata-kylogic")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-admin-token");
        if (!token || token !== process.env.WORKER_API_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }

        const host = process.env.BRIGHTDATA_HOST;
        const port = Number(process.env.BRIGHTDATA_PORT);
        const baseUser = process.env.BRIGHTDATA_ZONE_KYLOGIC_USERNAME;
        const password = process.env.BRIGHTDATA_ZONE_KYLOGIC_PASSWORD;
        if (!host || !port || !baseUser || !password) {
          return new Response("Missing BRIGHTDATA_* secrets", { status: 500 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const results: Array<{ country: string; status: string; id?: string }> = [];
        for (const c of COUNTRIES) {
          const username = `${baseUser}-country-${c.code}`;
          const label = `BrightData ${c.label}`;

          const { data: existing } = await supabaseAdmin
            .from("proxies")
            .select("id")
            .eq("tenant_id", TENANT_ID)
            .eq("provider", "BrightData")
            .eq("country", c.code.toUpperCase())
            .maybeSingle();
          if (existing?.id) {
            results.push({ country: c.code, status: "skipped", id: existing.id });
            continue;
          }

          const encU = await encryptString(username);
          const encP = await encryptString(password);
          const { data: row, error } = await supabaseAdmin
            .from("proxies")
            .insert({
              tenant_id: TENANT_ID,
              label,
              country: c.code.toUpperCase(),
              provider: "BrightData",
              kind: "isp",
              protocol: "http",
              host,
              port,
              username_ciphertext: encU.ciphertext,
              username_nonce: encU.nonce,
              password_ciphertext: encP.ciphertext,
              password_nonce: encP.nonce,
              notes: `Zóna: kylogic, ország: ${c.code.toUpperCase()}`,
              is_active: true,
            })
            .select("id")
            .single();
          if (error) {
            results.push({ country: c.code, status: `error: ${error.message}` });
          } else {
            results.push({ country: c.code, status: "created", id: row.id });
          }
        }

        return new Response(JSON.stringify({ ok: true, results }, null, 2), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
