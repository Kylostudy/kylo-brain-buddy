/**
 * Kit ↔ Brain bridge — server-only HMAC helpers.
 *
 * Two shared secrets (Stripe-style scheme, ±5 min tolerance):
 *   - KIT_BRAIN_TASK_SECRET  → inbound POST /api/public/cross/kit/task
 *                              outbound POST {kit_callback_url}
 *   - KIT_BRAIN_LOG_SECRET   → inbound GET  /api/public/cross/kit/task/:id/log
 *
 * Signed string: `${timestamp}.${METHOD}.${path}.${sha256_hex(rawBody)}`
 *   - `path` includes the query string for GET
 *   - rawBody is "" for empty bodies
 *
 * Headers on every signed request:
 *   X-Kylo-Module:    sender module ("brain" outbound, "kit" expected inbound)
 *   X-Kylo-Timestamp: unix seconds
 *   X-Kylo-Signature: hex(HMAC-SHA256(secret, signedString))
 *
 * Plus on cross-module task traffic:
 *   X-Tenant-ID:     ten_...
 *   Idempotency-Key: task_id
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MODULE_NAME = "brain";
const EXPECTED_PEER_MODULE = "kit";
const CLOCK_SKEW_SECONDS = 5 * 60;

function getTaskSecret(): string {
  const s = process.env.KIT_BRAIN_TASK_SECRET;
  if (!s) throw new Error("KIT_BRAIN_TASK_SECRET is not configured");
  return s;
}

function getLogSecret(): string {
  const s = process.env.KIT_BRAIN_LOG_SECRET;
  if (!s) throw new Error("KIT_BRAIN_LOG_SECRET is not configured");
  return s;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function sign(
  secret: string,
  method: string,
  pathWithQuery: string,
  rawBody: string,
  timestamp: string,
): string {
  const msg = `${timestamp}.${method.toUpperCase()}.${pathWithQuery}.${sha256Hex(rawBody)}`;
  return createHmac("sha256", secret).update(msg, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

// ---------- Inbound verification (used by route handlers) ------------------

export type VerifyResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

export type VerifyChannel = "task" | "log";

export function verifyKitRequest(
  channel: VerifyChannel,
  method: string,
  pathWithQuery: string,
  rawBody: string,
  headers: Headers,
): VerifyResult {
  const mod = headers.get("x-kylo-module");
  const ts = headers.get("x-kylo-timestamp");
  const sig = headers.get("x-kylo-signature");

  if (!mod || !ts || !sig) {
    return { ok: false, status: 401, reason: "Missing Kylo HMAC headers" };
  }
  if (mod.toLowerCase() !== EXPECTED_PEER_MODULE) {
    return { ok: false, status: 401, reason: `Unexpected X-Kylo-Module: ${mod}` };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, status: 401, reason: "Invalid timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: "Timestamp outside tolerance" };
  }

  const secret = channel === "task" ? getTaskSecret() : getLogSecret();
  const expected = sign(secret, method, pathWithQuery, rawBody, ts);
  if (!safeEqualHex(expected, sig)) {
    return { ok: false, status: 401, reason: "Invalid signature" };
  }
  return { ok: true };
}

// ---------- Outbound callback to Kit ---------------------------------------

export type KitCallbackPayload = {
  task_id: string;
  tenant_id: string;
  status: "completed" | "failed";
  result?: unknown;
  error?: string;
  log_available: boolean;
  log_url?: string;
};

export type KitCallbackResult =
  | { ok: true; status: number }
  | { ok: false; status: number; error: string; body?: string };

export async function sendKitCallback(
  kitCallbackUrl: string,
  payload: KitCallbackPayload,
): Promise<KitCallbackResult> {
  let parsed: URL;
  try {
    parsed = new URL(kitCallbackUrl);
  } catch {
    return { ok: false, status: 0, error: "Invalid kit_callback_url" };
  }

  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Sign with path + query (no host) so it matches Kit's verification.
  const pathWithQuery = `${parsed.pathname}${parsed.search}`;
  const signature = sign(
    getTaskSecret(),
    "POST",
    pathWithQuery,
    rawBody,
    timestamp,
  );

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Kylo-Module": MODULE_NAME,
    "X-Kylo-Timestamp": timestamp,
    "X-Kylo-Signature": signature,
    "X-Tenant-ID": payload.tenant_id,
    "Idempotency-Key": payload.task_id,
  };

  try {
    const res = await fetch(kitCallbackUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `Kit callback responded ${res.status}`,
        body: text,
      };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: `Kit callback fetch failed: ${message}` };
  }
}

// ---------- Public log URL helper ------------------------------------------

export function brainBaseUrl(): string {
  return (
    process.env.BRAIN_PUBLIC_BASE_URL ??
    "https://project--7d89e05a-a0ab-454c-a80a-3c9b8715c912.lovable.app"
  ).replace(/\/+$/, "");
}

export function buildLogUrl(taskId: string): string {
  return `${brainBaseUrl()}/api/public/cross/kit/task/${encodeURIComponent(taskId)}/log`;
}
