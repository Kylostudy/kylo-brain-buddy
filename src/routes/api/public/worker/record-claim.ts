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

const PINTEREST_LOGIN_URL = "https://www.pinterest.com/login/";

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

type CookieOut = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

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
  cookies: CookieOut[];
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

  // workflow_credentials → proxy_id → proxies row + minden mentett cookie
  // (bármelyik platform során, hogy a korábban felvett Pinterest / LinkedIn
  // sütik automatikusan betöltődjenek — így nem kell újra bejelentkezni).
  const { data: creds } = await sb
    .from("workflow_credentials")
    .select("proxy_id, cookie_ciphertext, cookie_nonce")
    .eq("workflow_id", workflowId);

  const proxyId = creds?.find((c) => c.proxy_id)?.proxy_id || null;

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

  // Cookie-k összegyűjtése + de-duplikálás (name+domain+path kulcs).
  // Először a workflow saját sütijeit töltjük be. Ha ilyen nincs (pl. frissen
  // létrehozott Reddit workflow csak proxyval), később ország alapján
  // visszaesünk a megfelelő warm-up cookie jar-ra.
  const cookieMap = new Map<string, CookieOut>();
  const addCookiesFromRows = async (
    rows: Array<{ cookie_ciphertext: string | null; cookie_nonce: string | null }> | null | undefined,
  ) => {
    for (const c of rows || []) {
      const raw = await safeDec(c.cookie_ciphertext, c.cookie_nonce);
      if (!raw) continue;
      try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) continue;
        for (const ck of arr) {
          if (!ck || typeof ck.name !== "string" || typeof ck.value !== "string") continue;
          const key = `${ck.name}|${ck.domain || ""}|${ck.path || "/"}`;
          cookieMap.set(key, {
            name: ck.name,
            value: ck.value,
            domain: ck.domain,
            path: ck.path,
            expires: typeof ck.expires === "number" ? ck.expires : undefined,
            httpOnly: !!ck.httpOnly,
            secure: !!ck.secure,
            sameSite: typeof ck.sameSite === "string" ? ck.sameSite : undefined,
          });
        }
      } catch {
        /* ignore malformed */
      }
    }
  };

  await addCookiesFromRows(creds);

  if (!proxyId) {
    return {
      proxy: null,
      locale,
      timezone,
      cookies: Array.from(cookieMap.values()),
      error:
        "a workflow-hoz nincs proxy rendelve (workflow_credentials.proxy_id üres). Előbb rendelj proxyt a credential formban.",
    };
  }

  const { data: pRow } = await sb
    .from("proxies")
    .select(
      "id, label, country, protocol, host, port, username_ciphertext, username_nonce, password_ciphertext, password_nonce, is_active",
    )
    .eq("id", proxyId)
    .maybeSingle();

  if (!pRow || !pRow.is_active) {
    return {
      proxy: null,
      locale,
      timezone,
      cookies: Array.from(cookieMap.values()),
      error: "a hozzárendelt proxy nem található vagy inaktív",
    };
  }

  const username = await safeDec(pRow.username_ciphertext, pRow.username_nonce);
  const password = await safeDec(pRow.password_ciphertext, pRow.password_nonce);
  const server = `${pRow.protocol || "http"}://${pRow.host}:${pRow.port}`;
  const proxyCountry = (pRow.country || "").toUpperCase() || null;

  // Kritikus Reddit/Live Browse eset: ha a cél workflow még szűz, de ugyanarra
  // az országra már van 45 perces warm-up csomag, azt automatikusan betöltjük.
  // Így nem nulláról megyünk Redditre, hanem ugyanazzal az országos sütialappal,
  // amit a többi workflow is használ.
  if (cookieMap.size === 0 && proxyCountry) {
    const { data: warmupWorkflow } = await sb
      .from("workflows")
      .select("id")
      .eq("cookie_jar_country", proxyCountry)
      .not("cookie_jar_updated_at", "is", null)
      .order("cookie_jar_updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (warmupWorkflow?.id && warmupWorkflow.id !== workflowId) {
      const { data: warmupCreds } = await sb
        .from("workflow_credentials")
        .select("cookie_ciphertext, cookie_nonce")
        .eq("workflow_id", warmupWorkflow.id)
        .not("cookie_ciphertext", "is", null);
      await addCookiesFromRows(warmupCreds);
    }
  }

  return {
    proxy: {
      server,
      username,
      password,
      label: pRow.label || "",
      country: proxyCountry,
    },
    locale,
    timezone,
    cookies: Array.from(cookieMap.values()),
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
        const { proxy, locale, timezone, cookies, error: proxyErr } = await loadWorkflowProxy(
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

        const { data: workflow } = await sb
          .from("workflows")
          .select("platform, spec")
          .eq("id", candidate.workflow_id)
          .maybeSingle();

        const platform = String(workflow?.platform || "").toLowerCase();
        const startUrl =
          platform === "pinterest" && !candidate.start_url
            ? PINTEREST_LOGIN_URL
            : candidate.start_url;

        const { data: claimed, error: updErr } = await sb
          .from("recording_sessions")
          .update({
            status: "active",
            worker_id: workerId,
            start_url: startUrl,
            started_at: new Date().toISOString(),
          })
          .eq("id", candidate.id)
          .eq("status", "requested")
          .select("id, workflow_id, start_url, started_at")
          .maybeSingle();

        if (updErr || !claimed) return new Response(null, { status: 204 });

        // Ugyanaz a fingerprint mint a workflow futásoknál (workflow_id +
        // proxy ország alapján determinisztikus) — így a recorderrel felvett
        // session és a későbbi éles futás UGYANANNAK a "virtuális gépnek"
        // látszik (Windows Chrome 148 + NVIDIA GPU stb.), nem vált a
        // fingerprint az első bejelentkezés után.
        const { generateWorkflowFingerprint } = await import("@/lib/fingerprint");
        const fingerprint = generateWorkflowFingerprint(
          claimed.workflow_id,
          proxy?.country ?? null,
        );

        return new Response(
          JSON.stringify({
            session: {
              id: claimed.id,
              workflowId: claimed.workflow_id,
              startUrl,
              channel: `record:${claimed.id}`,
              startedAt: claimed.started_at,
            },
            proxy,
            locale: locale || fingerprint.locale,
            timezone: timezone || fingerprint.timezoneId,
            fingerprint,
            cookies,
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
