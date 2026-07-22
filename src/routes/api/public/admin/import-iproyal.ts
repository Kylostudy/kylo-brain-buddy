import { createFileRoute } from "@tanstack/react-router";
import { encryptString } from "@/lib/credentials/crypto.server";

const TENANT_ID = "c13c29af-b546-41e3-a4d5-9b3bb3a71326";

// host:port:user:pass -> ország kód + magyar címke
const ENTRIES: Array<{
  host: string;
  port: number;
  username: string;
  password: string;
  country: string;
  label: string;
  city: string;
}> = [
  { host: "31.169.69.63",     port: 12323, username: "14adab6f07ccb", password: "90c15fdb87", country: "TR", label: "IPRoyal Törökország", city: "Manavgat" },
  { host: "114.69.244.7",     port: 12323, username: "14adab6f07ccb", password: "90c15fdb87", country: "FI", label: "IPRoyal Finnország", city: "Helsinki" },
  { host: "201.219.206.48",   port: 12323, username: "14adab6f07ccb", password: "90c15fdb87", country: "CO", label: "IPRoyal Kolumbia", city: "Cartagena" },
  { host: "88.223.174.163",   port: 12323, username: "14adab6f07ccb", password: "90c15fdb87", country: "PL", label: "IPRoyal Lengyelország", city: "Varsó" },
  { host: "92.52.211.154",    port: 12323, username: "14adab6f07ccb", password: "90c15fdb87", country: "HU", label: "IPRoyal Magyarország", city: "Nyíregyháza" },
  { host: "81.181.132.14",    port: 12323, username: "14aaa7b112e7b", password: "7b6aa9e308", country: "HK", label: "IPRoyal Hongkong", city: "Kwai Chung" },
  { host: "89.32.167.8",      port: 12323, username: "14aaa7b112e7b", password: "7b6aa9e308", country: "ES", label: "IPRoyal Spanyolország", city: "Rociana del Condado" },
  { host: "175.29.205.217",   port: 12323, username: "14aaa7b112e7b", password: "7b6aa9e308", country: "JP", label: "IPRoyal Japán", city: "Tokió" },
  { host: "176.103.182.90",   port: 12323, username: "14aaa7b112e7b", password: "7b6aa9e308", country: "FR", label: "IPRoyal Franciaország", city: "Párizs" },
  { host: "95.173.63.96",     port: 12323, username: "14aaa7b112e7b", password: "7b6aa9e308", country: "CH", label: "IPRoyal Svájc", city: "Bern" },
  { host: "157.238.218.196",  port: 12323, username: "14a8fb50a72b3", password: "7dc091d396", country: "SG", label: "IPRoyal Szingapúr", city: "Szingapúr" },
  { host: "175.29.3.164",     port: 12323, username: "14a8fb50a72b3", password: "7dc091d396", country: "AU", label: "IPRoyal Ausztrália", city: "Sussex Inlet" },
  { host: "194.102.121.208",  port: 12323, username: "14a8fb50a72b3", password: "7dc091d396", country: "CA", label: "IPRoyal Kanada", city: "Montreal" },
  { host: "95.173.47.61",     port: 12323, username: "14a8fb50a72b3", password: "7dc091d396", country: "GB", label: "IPRoyal Egyesült Királyság", city: "London" },
  { host: "45.131.15.92",     port: 12323, username: "14a8fb50a72b3", password: "7dc091d396", country: "US", label: "IPRoyal USA", city: "Ashburn" },
  { host: "149.18.33.214",    port: 12323, username: "14a0e896a1622", password: "a33abffa44", country: "US", label: "IPRoyal USA #2 (LEJÁR 2026-08-20)", city: "IDEIGLENES — lejár 2026-08-20" },
];

export const Route = createFileRoute("/api/public/admin/import-iproyal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-admin-token");
        if (!token || token !== process.env.WORKER_API_TOKEN) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const results: Array<{ host: string; country: string; status: string; id?: string }> = [];
        for (const e of ENTRIES) {
          const { data: existing } = await supabaseAdmin
            .from("proxies")
            .select("id")
            .eq("tenant_id", TENANT_ID)
            .eq("host", e.host)
            .eq("port", e.port)
            .maybeSingle();
          if (existing?.id) {
            results.push({ host: e.host, country: e.country, status: "skipped", id: existing.id });
            continue;
          }

          const encU = await encryptString(e.username);
          const encP = await encryptString(e.password);
          const { data: row, error } = await supabaseAdmin
            .from("proxies")
            .insert({
              tenant_id: TENANT_ID,
              label: e.label,
              country: e.country,
              provider: "IPRoyal",
              kind: "residential",
              protocol: "http",
              host: e.host,
              port: e.port,
              username_ciphertext: encU.ciphertext,
              username_nonce: encU.nonce,
              password_ciphertext: encP.ciphertext,
              password_nonce: encP.nonce,
              notes: `IPRoyal residential — ${e.city}`,
              is_active: true,
            })
            .select("id")
            .single();
          if (error) {
            results.push({ host: e.host, country: e.country, status: `error: ${error.message}` });
          } else {
            results.push({ host: e.host, country: e.country, status: "created", id: row.id });
          }
        }

        return new Response(JSON.stringify({ ok: true, results }, null, 2), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
