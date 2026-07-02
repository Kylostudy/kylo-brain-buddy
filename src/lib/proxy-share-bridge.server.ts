/**
 * Brain ↔ Peer modules (Audit, etc.) — shared proxy pool bridge.
 *
 * A peer module (e.g. Audit) calls Brain's public endpoint to fetch the
 * tenant's proxy pool. Signed with BRAIN_PROXY_SHARE_SECRET, same envelope
 * as the Kylogic bridge (±5 min tolerance).
 *
 * Signed string: `${timestamp}.${METHOD}.${path}.${sha256_hex(rawBody)}`
 * Headers:
 *   X-Kylo-Module:    peer module name (e.g. "audit")
 *   X-Kylo-Timestamp: unix seconds
 *   X-Kylo-Signature: hex(HMAC-SHA256(secret, signedString))
 *   X-Tenant-ID:      tenant identifier (required in body too)
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const CLOCK_SKEW_SECONDS = 5 * 60;
const ALLOWED_PEERS = new Set(["audit", "kylogic", "kit"]);

function getSecret(): string {
  const s = process.env.BRAIN_PROXY_SHARE_SECRET;
  if (!s) throw new Error("BRAIN_PROXY_SHARE_SECRET is not configured");
  return s;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export type VerifyResult =
  | { ok: true; peerModule: string }
  | { ok: false; status: number; reason: string };

export function verifyProxyShareRequest(
  method: string,
  pathWithQuery: string,
  rawBody: string,
  headers: Headers,
): VerifyResult {
  const mod = headers.get("x-kylo-module");
  const tsHeader = headers.get("x-kylo-timestamp");
  const sigHeader = headers.get("x-kylo-signature");

  if (!mod || !tsHeader || !sigHeader) {
    return { ok: false, status: 401, reason: "Missing signature headers" };
  }
  if (!ALLOWED_PEERS.has(mod)) {
    return { ok: false, status: 401, reason: `Peer module '${mod}' not allowed` };
  }

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 401, reason: "Invalid timestamp" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: "Timestamp outside tolerance" };
  }

  let secret: string;
  try {
    secret = getSecret();
  } catch (err) {
    return {
      ok: false,
      status: 500,
      reason: err instanceof Error ? err.message : "Secret not configured",
    };
  }

  const msg = `${tsHeader}.${method.toUpperCase()}.${pathWithQuery}.${sha256Hex(rawBody)}`;
  const expected = createHmac("sha256", secret).update(msg, "utf8").digest("hex");
  if (!safeEqualHex(sigHeader, expected)) {
    return { ok: false, status: 401, reason: "Signature mismatch" };
  }
  return { ok: true, peerModule: mod };
}
