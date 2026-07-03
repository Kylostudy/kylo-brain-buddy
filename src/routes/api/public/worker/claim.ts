// Worker job claim endpoint — a saját VPS workerünk hívja, hogy elkérje a
// következő futtatható (queued) workflow_runs sort. Megosztott titokkal véd,
// nem kell hozzá Supabase service-role kulcs a workeren.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN> vagy x-worker-token
// Válasz: 200 { run: {...} } vagy 204 (üres queue)

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

export const Route = createFileRoute("/api/public/worker/claim")({
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

        // Lekérünk 1 queued sort + atomikusan running-ra állítjuk (CAS a status mezőn).
        const { data: candidate } = await sb
          .from("brain_workflow_runs")
          .select("id, workflow_id, spec_snapshot, runner, proxy_id")
          .eq("status", "queued")
          .eq("runner", "docker")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!candidate) return new Response(null, { status: 204 });

        const { data: claimed, error: updErr } = await sb
          .from("brain_workflow_runs")
          .update({
            status: "running",
            external_id: `${workerId}:${candidate.id}`,
            started_at: new Date().toISOString(),
          })
          .eq("id", candidate.id)
          .eq("status", "queued")
          .select("id, workflow_id, spec_snapshot, proxy_id")
          .maybeSingle();

        if (updErr || !claimed) return new Response(null, { status: 204 });

        // Credential lekérés + visszafejtés szerveroldalon (ne a worker fejtse vissza).
        const { data: credRow } = await sb
          .from("workflow_credentials")
          .select(
            "platform, username, password_ciphertext, password_nonce, cookie_ciphertext, cookie_nonce, totp_secret_ciphertext, totp_nonce, proxy_ciphertext, proxy_nonce",
          )
          .eq("workflow_id", claimed.workflow_id)
          .maybeSingle();

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

        let credentials: Record<string, string | null> | null = null;
        if (credRow) {
          credentials = {
            platform: credRow.platform,
            username: credRow.username || null,
            password: await safeDec(credRow.password_ciphertext, credRow.password_nonce),
            cookies: await safeDec(credRow.cookie_ciphertext, credRow.cookie_nonce),
            totpSecret: await safeDec(
              credRow.totp_secret_ciphertext,
              credRow.totp_nonce,
            ),
            proxy: await safeDec(credRow.proxy_ciphertext, credRow.proxy_nonce),
          };
        }

        // Proxy resolve (ha a run-hoz konkrét proxyId van kötve).
        let proxy: {
          url: string;
          label: string;
          expectedCountry: string | null;
          provider: string | null;
        } | null = null;
        if (claimed.proxy_id) {
          const { data: pRow } = await sb
            .from("proxies")
            .select(
              "id, label, country, provider, protocol, host, port, username_ciphertext, username_nonce, password_ciphertext, password_nonce, is_active",
            )
            .eq("id", claimed.proxy_id)
            .maybeSingle();
          if (pRow && pRow.is_active) {
            const u = await safeDec(pRow.username_ciphertext, pRow.username_nonce);
            const p = await safeDec(pRow.password_ciphertext, pRow.password_nonce);
            const auth =
              u && p
                ? `${encodeURIComponent(u)}:${encodeURIComponent(p)}@`
                : u
                  ? `${encodeURIComponent(u)}@`
                  : "";
            proxy = {
              url: `${pRow.protocol}://${auth}${pRow.host}:${pRow.port}`,
              label: pRow.label,
              expectedCountry: (pRow.country || "").toUpperCase() || null,
              provider: pRow.provider || null,
            };
          }
        }

        // ---- Fingerprint audit ütemezés ---------------------------------
        // Első futásra vagy ha >7 napja volt utoljára sikeres audit → futtatjuk
        // a bot.sannysoft.com + CreepJS ellenőrzést a whoer preflight után.
        // A worker a result.fingerprint_audit-ba menti — az UI onnan olvassa.
        let runFingerprintAudit = true;
        {
          const sevenDaysAgo = new Date(
            Date.now() - 7 * 24 * 60 * 60 * 1000,
          ).toISOString();
          const { data: recent } = await sb
            .from("brain_workflow_runs")
            .select("result, finished_at")
            .eq("workflow_id", claimed.workflow_id)
            .eq("status", "succeeded")
            .gte("finished_at", sevenDaysAgo)
            .order("finished_at", { ascending: false })
            .limit(5);
          if (recent && recent.length > 0) {
            const hasRecentAudit = recent.some((r) => {
              const res = r.result as { fingerprint_audit?: unknown } | null;
              return !!res?.fingerprint_audit;
            });
            if (hasRecentAudit) runFingerprintAudit = false;
          }
        }

        const specWithFlags =
          claimed.spec_snapshot && typeof claimed.spec_snapshot === "object"
            ? { ...(claimed.spec_snapshot as Record<string, unknown>) }
            : {};
        if (runFingerprintAudit) {
          specWithFlags.run_fingerprint_audit = true;
        }

        // ---- Per-workflow böngésző-fingerprint ---------------------------
        // Determinisztikusan generált UA/viewport/locale/timezone — így egy
        // fiók mindig "ugyanarról a gépről" jelentkezik be. Csak akkor
        // generálunk, ha a spec-ben nincs kézzel felülírva.
        if (!specWithFlags.fingerprint) {
          const { generateWorkflowFingerprint } = await import("@/lib/fingerprint");
          specWithFlags.fingerprint = generateWorkflowFingerprint(
            claimed.workflow_id,
            proxy?.expectedCountry ?? null,
          );
        }


        return new Response(
          JSON.stringify({
            run: {
              id: claimed.id,
              workflowId: claimed.workflow_id,
              spec: specWithFlags,
              credentials,
              proxy,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});

