// Kylogic → Brain: csak olvasó letöltés a VPS videó-archívumából.
// HMAC v1 (BRAIN_KYLOGIC_TASK_SECRET), üres body. Soha nem ír, nem töröl.

import { createFileRoute } from "@tanstack/react-router";
import { vaultFileBaseUrl } from "@/lib/vault-file-base.server";

import { verifyKylogicTaskRequest } from "@/lib/kylogic-bridge.server";
import { normalizeArchivePath } from "@/lib/kylogic-archive-video.server";

const CANONICAL = "/api/public/cross/kylogic/archive-file";

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/cross/kylogic/archive-file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const pathWithQuery = `${u.pathname}${u.search}`;
        const verify = verifyKylogicTaskRequest(
          "GET",
          [pathWithQuery, `${CANONICAL}${u.search}`],
          "",
          request.headers,
        );
        if (!verify.ok) return jsonError(verify.status, verify.reason);

        const raw = u.searchParams.get("path");
        if (!raw || raw.length > 1024) return jsonError(400, "path required");
        const rel = normalizeArchivePath(raw);
        if (!rel || raw.split("/").some((p) => p === "..")) {
          return jsonError(400, "invalid path");
        }

        const base = vaultFileBaseUrl();
        const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
        if (!base || !token) return jsonError(503, "archive server not configured");

        let upstream: Response;
        try {
          upstream = await fetch(`${base}/archive-file?path=${encodeURIComponent(rel)}`, {
            headers: { authorization: `Bearer ${token}` },
          });
        } catch (e) {
          console.error("[archive-file] upstream failed", e);
          return jsonError(503, "archive server unreachable");
        }
        if (upstream.status === 404) return jsonError(404, "not found");
        if (upstream.status === 400) return jsonError(400, "invalid path");
        if (!upstream.ok || !upstream.body) {
          console.error("[archive-file] upstream status", upstream.status);
          return jsonError(502, "archive server error");
        }

        const headers = new Headers();
        headers.set("content-type", upstream.headers.get("content-type") || "video/mp4");
        const len = upstream.headers.get("content-length");
        if (len) headers.set("content-length", len);
        headers.set(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(rel.split("/").pop() || "video.mp4")}`,
        );
        headers.set("cache-control", "no-store");
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
