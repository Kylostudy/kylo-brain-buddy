// Kylo Vault — publikus letöltés. A bájtok a VPS széfjéből folynak át,
// másolat sehol nem keletkezik. Kulcs nélkül nem lehet letölteni.

import { createFileRoute } from "@tanstack/react-router";

import {
  NEUTRAL_MESSAGE,
  bumpDownloadCount,
  logAccess,
  resolveShare,
  type ShareRow,
} from "@/lib/vault-share-access.server";
import {
  fetchVaultStream,
  joinSharePath,
  listVaultPath,
  verifyDownloadKey,
} from "@/lib/vault-shares.server";

function deny(status = 404): Response {
  return new Response(NEUTRAL_MESSAGE, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/s/$token/dl")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const token = params.token;
        const url = new URL(request.url);
        const key = url.searchParams.get("k");
        const wantsZip = url.searchParams.get("zip") === "1";
        const relative = url.searchParams.get("f") ?? "";

        if (!verifyDownloadKey(token, key)) return deny(401);

        // A jelszót már a feloldáskor ellenőriztük; a kulcs helyettesíti.
        const result = await resolveShare(token, null, request);
        let share: ShareRow;
        if (result.ok) {
          share = result.share;
        } else if (result.outcome === "bad_password") {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("vault_shares")
            .select(
              "id,tenant_id,path,label,token,password_hash,expires_at,max_downloads,download_count,allow_download,revoked_at",
            )
            .eq("token", token)
            .maybeSingle();
          if (!data) return deny();
          share = data as ShareRow;
        } else {
          return deny(result.status === 429 ? 429 : 404);
        }

        if (!share.allow_download) return deny(403);

        let listing;
        try {
          listing = await listVaultPath(share.path);
        } catch (e) {
          console.error("vault listing failed", e);
          return new Response("A széf jelenleg nem elérhető.", { status: 503 });
        }
        if (!listing) return deny();

        let targetPath = share.path;
        let mode: "file" | "zip" = "file";
        let filename = listing.name;

        if (listing.kind === "dir") {
          if (wantsZip || !relative) {
            mode = "zip";
            filename = `${listing.name}.zip`;
          } else {
            const joined = joinSharePath(share.path, relative);
            if (!joined) return deny(400);
            if (!listing.files.some((f) => f.path === relative)) return deny();
            targetPath = joined;
            filename = relative.split("/").pop() || "file";
          }
        }

        let upstream: Response;
        try {
          upstream = await fetchVaultStream(targetPath, mode);
        } catch (e) {
          console.error("vault stream failed", e);
          return new Response("A széf jelenleg nem elérhető.", { status: 503 });
        }
        if (!upstream.ok || !upstream.body) {
          if (upstream.status === 413) {
            return new Response("Ez a mappa túl nagy egyben letölteni (5 GB fölött).", {
              status: 413,
            });
          }
          return deny();
        }

        await Promise.all([
          bumpDownloadCount(share),
          logAccess({ shareId: share.id, token, request, outcome: "ok" }),
        ]);

        const headers = new Headers();
        headers.set(
          "content-type",
          upstream.headers.get("content-type") || "application/octet-stream",
        );
        const len = upstream.headers.get("content-length");
        if (len) headers.set("content-length", len);
        headers.set(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        );
        headers.set("cache-control", "no-store");
        headers.set("x-content-type-options", "nosniff");

        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
