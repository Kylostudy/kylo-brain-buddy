// Worker job claim endpoint — a saját VPS workerünk hívja, hogy elkérje a
// következő futtatható (queued) workflow_runs sort. Megosztott titokkal véd,
// nem kell hozzá Supabase service-role kulcs a workeren.
//
// Auth: Authorization: Bearer <WORKER_API_TOKEN>
// Válasz: 200 { run: {...} } vagy 204 (üres queue)

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import type { Database } from "@/integrations/supabase/types";

function checkAuth(request: Request): string | null {
  const token = process.env.WORKER_API_TOKEN;
  if (!token) return "WORKER_API_TOKEN nincs beállítva";
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
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
          .select("id, workflow_id, spec_snapshot, runner")
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
          .select("id, workflow_id, spec_snapshot")
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

        let credentials: Record<string, string | null> | null = null;
        if (credRow) {
          const { decryptString } = await import("@/lib/credentials/crypto.server");
          const safe = async (
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
          credentials = {
            platform: credRow.platform,
            username: credRow.username || null,
            password: await safe(credRow.password_ciphertext, credRow.password_nonce),
            cookies: await safe(credRow.cookie_ciphertext, credRow.cookie_nonce),
            totpSecret: await safe(
              credRow.totp_secret_ciphertext,
              credRow.totp_nonce,
            ),
            proxy: await safe(credRow.proxy_ciphertext, credRow.proxy_nonce),
          };
        }

        return new Response(
          JSON.stringify({
            run: {
              id: claimed.id,
              workflowId: claimed.workflow_id,
              spec: claimed.spec_snapshot,
              credentials,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
