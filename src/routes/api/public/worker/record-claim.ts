// Worker recording claim endpoint — a saját VPS workerünk hívja, hogy elkérje
// a legrégebbi 'requested' státuszú recording session-t. Atomi CAS-szel
// 'active'-ra állítja, és visszaadja a session adatait + a workflow-hoz
// rendelt PROXY-t (kötelező, hogy a bejelentkezés ugyanarról az IP-ről
// történjen, mint amit a workflow általában használ) és a locale/timezone-t.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token
// Válasz: 200 { session, proxy, locale, timezone, supabaseUrl, supabasePublishableKey }
//         204 (nincs várakozó kérés)

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import type { Database } from "@/integrations/supabase/types";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN?.trim();
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = (
    header.startsWith("Bearer ")
      ? header.slice(7)
      : request.headers.get("x-worker-token") ?? request.headers.get("x-api-key") ?? ""
  ).trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "unauthorized";
  return null;
}

async function loadWorkflowProxy(
  sb: ReturnType<typeof createClient<Database>>,
  workflowId: string,
): Promise<{
  proxy: {
    server: string;
    username: string | null;
    password: string | null;
    label: string;
    country: string | null;
  } | null;
  locale: string | null;
  timezone: string | null;
  error?: string;
}> {
  // Workflow → language/region/timezone (a Playwright locale-hez)
  const { data: wf } = await sb
    .from("workflows")
    .select("language, region, timezone")
    .eq("id", workflowId)
    .maybeSingle();

  const language = wf?.language || null;
  const region = wf?.region || null;
  const timezone = wf?.timezone || null;
  const locale =
    language && region
      ? `${language}-${region.toUpperCase()}`
      : language
        ? language
        : null;

  // workflow_credentials → proxy_id → proxies row
  const { data: cred } = await sb
    .from("workflow_credentials")
    .select("proxy_id")
    .eq("workflow_id", workflowId)
    .maybeSingle();

  if (!cred?.proxy_id) {
    return {
      proxy: null,
      locale,
      timezone,
      error:
        "a workflow-hoz nincs proxy rendelve (workflow_credentials.proxy_id üres). Előbb rendelj proxyt a credential formban.",
    };
  }

  const { data: pRow } = await sb
    .from("proxies")
    .select(
      "id, label, country, protocol, host, port, username_ciphertext, username_nonce, password_ciphertext, password_nonce, is_active",
    )
    .eq("id", cred.proxy_id)
    .maybeSingle();

  if (!pRow || !pRow.is_active) {
    return {
      proxy: null,
      locale,
      timezone,
      error: "a hozzárendelt proxy nem található vagy inaktív",
    };
  }

  const { decryptString } = await import("@/lib/credentials/crypto.server");
  const safeDec = async (
    ct: string | null,
    n: string | null,
  ): Promise<string | null> => {
    if (!ct || !n) return null;
    try {
      return await decryptString(ct, n);
    } catch {
      return null;
    }
  };

  const username = await safeDec(pRow.username_ciphertext, pRow.username_nonce);
  const password = await safeDec(pRow.password_ciphertext, pRow.password_nonce);
  const server = `${pRow.protocol || "http"}://${pRow.host}:${pRow.port}`;

  return {
    proxy: {
      server,
      username,
      password,
      label: pRow.label || "",
      country: (pRow.country || "").toUpperCase() || null,
    },
    locale,
    timezone,
  };
}

export const Route = createFileRoute("/api/public/worker/record-claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authErr = checkAuth(request);
        if (authErr)
          return new Response(JSON.stringify({ error: authErr }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });

        let body: { workerId?: string } = {};
        try {
          body = (await request.json()) as { workerId?: string };
        } catch {
          // üres body OK
        }
        const workerId = body.workerId || "unknown-worker";

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const sb = supabaseAdmin as ReturnType<typeof createClient<Database>>;

        const { data: candidate } = await sb
          .from("recording_sessions")
          .select("id, workflow_id, start_url")
          .eq("status", "requested")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!candidate) return new Response(null, { status: 204 });

        // Proxy resolve MIELŐTT claim-elnénk — ha nincs proxy, ne foglaljuk le
        // a session-t, csak jelöljük 'failed'-nek egy értelmes hibaüzenettel.
        const { proxy, locale, timezone, error: proxyErr } = await loadWorkflowProxy(
          sb,
          candidate.workflow_id,
        );

        if (proxyErr) {
          await sb
            .from("recording_sessions")
            .update({
              status: "failed",
              ended_at: new Date().toISOString(),
              error: proxyErr,
            })
            .eq("id", candidate.id)
            .eq("status", "requested");
          // Nem foglalunk sessiont — visszaadunk 204-et, a modal a
          // recording_sessions Realtime-on látja majd a failed státuszt.
          return new Response(null, { status: 204 });
        }

        const { data: claimed, error: updErr } = await sb
          .from("recording_sessions")
          .update({
            status: "active",
            worker_id: workerId,
            started_at: new Date().toISOString(),
          })
          .eq("id", candidate.id)
          .eq("status", "requested")
          .select("id, workflow_id, start_url, started_at")
          .maybeSingle();

        if (updErr || !claimed) return new Response(null, { status: 204 });

        return new Response(
          JSON.stringify({
            session: {
              id: claimed.id,
              workflowId: claimed.workflow_id,
              startUrl: claimed.start_url,
              channel: `record:${claimed.id}`,
              startedAt: claimed.started_at,
            },
            proxy,
            locale,
            timezone,
            // A worker ezekkel csatlakozik a Realtime broadcast csatornára.
            supabaseUrl: process.env.SUPABASE_URL,
            supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
