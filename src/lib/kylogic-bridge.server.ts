/**
 * Kylogic ↔ Brain bridge — server-only HMAC helpers.
 *
 * Two shared secrets (Stripe-style scheme, ±5 min tolerance):
 *   - BRAIN_KYLOGIC_TASK_SECRET → inbound POST /api/public/cross/kylogic/task
 *                                  outbound POST {kylogic_callback_url}
 *   - BRAIN_KYLOGIC_LOG_SECRET  → outbound POST audit push to Kylogic
 *
 * Signed string: `${timestamp}.${METHOD}.${path}.${sha256_hex(rawBody)}`
 *   - `path` includes the query string for GET
 *   - rawBody is "" for empty bodies
 *
 * Headers on every signed request:
 *   X-Kylo-Module:    "brain" outbound, "kylogic" expected inbound
 *   X-Kylo-Timestamp: unix seconds
 *   X-Kylo-Signature: hex(HMAC-SHA256(secret, signedString))
 *
 * Plus on cross-module task traffic:
 *   X-Tenant-ID:     ten_...
 *   Idempotency-Key: task_id
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MODULE_NAME = "brain";
const EXPECTED_PEER_MODULE = "kylogic";
const CLOCK_SKEW_SECONDS = 5 * 60;

function getTaskSecret(): string {
  const s = process.env.BRAIN_KYLOGIC_TASK_SECRET;
  if (!s) throw new Error("BRAIN_KYLOGIC_TASK_SECRET is not configured");
  return s;
}

function getLogSecret(): string {
  const s = process.env.BRAIN_KYLOGIC_LOG_SECRET;
  if (!s) throw new Error("BRAIN_KYLOGIC_LOG_SECRET is not configured");
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

// ---------- Inbound verification ------------------------------------------

export type VerifyResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

export function verifyKylogicTaskRequest(
  method: string,
  pathWithQuery: string,
  rawBody: string,
  headers: Headers,
): VerifyResult {
  const mod = headers.get("x-kylo-module");
  const tsHeader = headers.get("x-kylo-timestamp");
  const sigHeader = headers.get("x-kylo-signature");

  if (!mod || !sigHeader) {
    return { ok: false, status: 401, reason: "Missing Kylo HMAC headers" };
  }
  if (mod.toLowerCase() !== EXPECTED_PEER_MODULE) {
    return { ok: false, status: 401, reason: `Unexpected X-Kylo-Module: ${mod}` };
  }

  let ts: string | null = tsHeader;
  let sigHex: string | null = null;

  if (/^[0-9a-fA-F]+$/.test(sigHeader.trim())) {
    sigHex = sigHeader.trim();
  } else {
    const parts = sigHeader.split(",").map((p) => p.trim());
    const v1s: string[] = [];
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim();
      if (k === "t") ts = v;
      else if (k === "v1") v1s.push(v);
    }
    if (v1s.length === 0) {
      return { ok: false, status: 401, reason: "No v1 signature found in header" };
    }
    sigHex = v1s[0];
  }

  if (!ts) return { ok: false, status: 401, reason: "Missing timestamp" };
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, status: 401, reason: "Invalid timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: "Timestamp outside tolerance" };
  }

  const expected = sign(getTaskSecret(), method, pathWithQuery, rawBody, ts);

  const candidates: string[] = [];
  if (/^[0-9a-fA-F]+$/.test(sigHeader.trim())) {
    candidates.push(sigHeader.trim());
  } else {
    for (const p of sigHeader.split(",")) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      if (p.slice(0, eq).trim() === "v1") candidates.push(p.slice(eq + 1).trim());
    }
  }
  for (const c of candidates) {
    if (safeEqualHex(expected, c)) return { ok: true };
  }
  // Reference unused-on-this-path locals to satisfy strict TS.
  void sigHex;
  return { ok: false, status: 401, reason: "Invalid signature" };
}

// ---------- Outbound: task callback to Kylogic -----------------------------

export type KylogicCallbackPayload = {
  task_id: string;
  tenant_id: string;
  status: "completed" | "failed";
  result?: unknown;
  error?: string;
};

export type KylogicCallbackResult =
  | { ok: true; status: number }
  | { ok: false; status: number; error: string; body?: string };

export async function sendKylogicCallback(
  kylogicCallbackUrl: string,
  payload: KylogicCallbackPayload,
): Promise<KylogicCallbackResult> {
  let parsed: URL;
  try {
    parsed = new URL(kylogicCallbackUrl);
  } catch {
    return { ok: false, status: 0, error: "Invalid kylogic_callback_url" };
  }

  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
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
    const res = await fetch(kylogicCallbackUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `Kylogic callback responded ${res.status}`,
        body: text,
      };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: `Kylogic callback fetch failed: ${message}` };
  }
}

// ---------- Outbound: audit push to Kylogic --------------------------------

const KYLOGIC_AUDIT_URL =
  process.env.KYLOGIC_AUDIT_URL ??
  "https://yqhipzwmgpopelfcenie.supabase.co/functions/v1/brain-audit-receive";

export type KylogicAuditEvent = {
  tenant_id: string;
  event: string;
  outcome?: "success" | "failure" | "info";
  task_id?: string;
  detail?: Record<string, unknown>;
  occurred_at?: string;
};

export async function sendKylogicAudit(
  event: KylogicAuditEvent,
): Promise<KylogicCallbackResult> {
  let parsed: URL;
  try {
    parsed = new URL(KYLOGIC_AUDIT_URL);
  } catch {
    return { ok: false, status: 0, error: "Invalid KYLOGIC_AUDIT_URL" };
  }

  const body = {
    module: MODULE_NAME,
    tenant_id: event.tenant_id,
    event: event.event,
    outcome: event.outcome ?? "info",
    task_id: event.task_id,
    detail: event.detail ?? {},
    occurred_at: event.occurred_at ?? new Date().toISOString(),
  };

  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const pathWithQuery = `${parsed.pathname}${parsed.search}`;
  const signature = sign(
    getLogSecret(),
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
    "X-Tenant-ID": event.tenant_id,
  };

  try {
    const res = await fetch(KYLOGIC_AUDIT_URL, {
      method: "POST",
      headers,
      body: rawBody,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `Kylogic audit responded ${res.status}`,
        body: text,
      };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: `Kylogic audit fetch failed: ${message}` };
  }
}
