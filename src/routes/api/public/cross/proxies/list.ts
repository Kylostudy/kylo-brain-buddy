/**
 * POST /api/public/cross/proxies/list
 *
 * Shared proxy pool endpoint. Peer modules (Audit, etc.) fetch the tenant's
 * proxies here with decrypted credentials so they can route their own
 * traffic through the same pool the Brain uses.
 *
 * Security:
 *  - HMAC via BRAIN_PROXY_SHARE_SECRET (X-Kylo-Signature envelope).
 *  - Body must include { tenant_id: string }.
 *  - Only active proxies are returned.
 *  - Credentials return over TLS to server-side callers ONLY. Never expose
 *    this response to a browser.
 */

import { createFileRoute } from "@tanstack/react-router";
import { verifyProxyShareRequest } from "@/lib/proxy-share-bridge.server";

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Body = { tenant_id: string; only_active?: boolean };

function isValidBody(b: unknown): b is Body {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return typeof o.tenant_id === "string" && o.tenant_id.length > 0;
}

export const Route = createFileRoute("/api/public/cross/proxies/list")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();

        const verify = verifyProxyShareRequest(
          "POST",
          "/api/public/cross/proxies/list",
          rawBody,
          request.headers,
        );
        if (!verify.ok) return jsonError(verify.status, verify.reason);

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          return jsonError(400, "Invalid JSON body");
        }
        if (!isValidBody(parsed)) {
          return jsonError(400, "Missing tenant_id");
        }
        const tenantHeader = request.headers.get("x-tenant-id");
        if (tenantHeader && tenantHeader !== parsed.tenant_id) {
          return jsonError(400, "X-Tenant-ID does not match body.tenant_id");
        }
        const onlyActive = parsed.only_active !== false;

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { decryptString } = await import(
          "@/lib/credentials/crypto.server"
        );

        let query = supabaseAdmin
          .from("proxies")
          .select(
            "id, label, country, provider, kind, protocol, host, port, username_ciphertext, username_nonce, password_ciphertext, password_nonce, notes, is_active, updated_at",
          )
          .order("updated_at", { ascending: false });
        if (onlyActive) query = query.eq("is_active", true);

        const { data, error } = await query;
        if (error) {
          console.error("[proxy-share] list failed", error);
          return jsonError(500, "Database error");
        }

        const rows = await Promise.all(
          (data ?? []).map(async (r) => {
            let username: string | null = null;
            let password: string | null = null;
            if (r.username_ciphertext && r.username_nonce) {
              try {
                username = await decryptString(r.username_ciphertext, r.username_nonce);
              } catch {
                username = null;
              }
            }
            if (r.password_ciphertext && r.password_nonce) {
              try {
                password = await decryptString(r.password_ciphertext, r.password_nonce);
              } catch {
                password = null;
              }
            }
            return {
              id: r.id,
              label: r.label,
              country: r.country,
              provider: r.provider,
              kind: r.kind,
              protocol: r.protocol,
              host: r.host,
              port: r.port,
              username,
              password,
              notes: r.notes,
              is_active: r.is_active,
              updated_at: r.updated_at,
            };
          }),
        );

        console.log(
          `[proxy-share] peer=${verify.peerModule} tenant=${parsed.tenant_id} returned=${rows.length}`,
        );

        return new Response(
          JSON.stringify({ ok: true, proxies: rows }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      },
    },
  },
});
