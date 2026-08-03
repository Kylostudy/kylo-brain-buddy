/**
 * GET/POST /api/public/health
 *
 * Public health-check + HMAC self-test for cross-module integrations.
 *
 * - Without Kylo HMAC headers: plain liveness response.
 * - With X-Kylo-Module / X-Kylo-Timestamp / X-Kylo-Signature: verifies the
 *   signature using BRAIN_KYLOGIC_TASK_SECRET against the canonical signed
 *   string and reports the outcome. The secret is never echoed; only a short
 *   fingerprint (first 8 hex chars of sha256 of the secret) so both sides can
 *   compare whether they hold the same value.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

import { verifyKylogicTaskRequest } from "@/lib/kylogic-bridge.server";

function secretFingerprint(): string | null {
  const s = process.env.BRAIN_KYLOGIC_TASK_SECRET;
  if (!s) return null;
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);
}

function secretShape() {
  const s = process.env.BRAIN_KYLOGIC_TASK_SECRET ?? "";
  return {
    configured: s.length > 0,
    length: s.length,
    is_hex: /^[0-9a-fA-F]+$/.test(s),
    has_whitespace: /\s/.test(s),
    fingerprint: secretFingerprint(),
  };
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawBody = request.method === "GET" ? "" : await request.text();

  const base = {
    ok: true,
    service: "kylo-brain",
    time: new Date().toISOString(),
    unix: Math.floor(Date.now() / 1000),
    task_endpoint: "/api/public/cross/kylogic/task",
    signing_scheme:
      "hex(HMAC_SHA256(secret, `${timestamp}.${METHOD}.${pathWithQuery}.${sha256_hex(rawBody)}`))",
    headers_expected: {
      "X-Kylo-Module": "kylogic",
      "X-Kylo-Timestamp": "unix seconds",
      "X-Kylo-Signature": "hex digest (or Stripe-style `t=...,v1=...`)",
    },
    clock_skew_seconds: 300,
    secret: secretShape(),
  };

  const hasHmac =
    request.headers.get("x-kylo-signature") !== null &&
    request.headers.get("x-kylo-module") !== null;

  if (!hasHmac) {
    return Response.json(base);
  }

  const verify = verifyKylogicTaskRequest(
    request.method,
    `${url.pathname}${url.search}`,
    rawBody,
    request.headers,
  );

  return Response.json({
    ...base,
    hmac_check: verify.ok
      ? { ok: true }
      : { ok: false, status: verify.status, reason: verify.reason },
    signed_path_used: `${url.pathname}${url.search}`,
    body_sha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
  });
}

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
