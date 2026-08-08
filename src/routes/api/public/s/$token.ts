// Kylo Vault — publikus megosztás API (nem HMAC, tokenes).
// A /s/:token oldal ezt hívja: állapot lekérés + jelszó ellenőrzés.

import { createFileRoute } from "@tanstack/react-router";

import { NEUTRAL_MESSAGE, logAccess, resolveShare } from "@/lib/vault-share-access.server";
import { issueDownloadKey, listVaultPath } from "@/lib/vault-shares.server";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/s/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const token = params.token;

        let password: string | null = null;
        try {
          const body = (await request.json()) as { password?: unknown };
          if (typeof body?.password === "string" && body.password.length <= 200) {
            password = body.password;
          }
        } catch {
          password = null;
        }

        const result = await resolveShare(token, password, request);

        if (!result.ok) {
          if (result.outcome === "bad_password") {
            // Csak akkor áruljuk el, hogy jelszó kell, ha a link egyébként él.
            return json({ ok: false, needsPassword: true, error: password ? "Hibás jelszó." : null }, 401);
          }
          return json({ ok: false, error: NEUTRAL_MESSAGE }, result.status === 429 ? 429 : 404);
        }

        const share = result.share;
        let listing = null;
        try {
          listing = await listVaultPath(share.path);
        } catch (e) {
          console.error("vault listing failed", e);
          return json({ ok: false, error: "A széf jelenleg nem elérhető." }, 503);
        }
        if (!listing) {
          return json({ ok: false, error: NEUTRAL_MESSAGE }, 404);
        }

        await logAccess({ shareId: share.id, token, request, outcome: "ok" });

        return json({
          ok: true,
          name: share.label || listing.name,
          kind: listing.kind,
          size: listing.size,
          files: listing.files.slice(0, 2000),
          allowDownload: share.allow_download,
          expiresAt: share.expires_at,
          downloadKey: share.allow_download ? issueDownloadKey(token) : null,
        });
      },
    },
  },
});
