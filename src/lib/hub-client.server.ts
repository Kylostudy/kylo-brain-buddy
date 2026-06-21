/**
 * KyloGateway Hub client (server-only).
 *
 * Builds HMAC-SHA256 signed requests to the Hub cross-module endpoints
 * using the Stripe-style scheme agreed with Hub:
 *
 *   Headers:
 *     X-Kylo-Module:    "brain"
 *     X-Kylo-Timestamp: <unix seconds>
 *     X-Kylo-Signature: <hex hmac-sha256>
 *
 *   Signed string: `${timestamp}.${method}.${path}.${body_sha256_hex}`
 *     - path includes the query string for GET
 *     - body_sha256 is sha256 of raw body for POST, sha256("") for GET/empty
 *
 * Timestamp tolerance: ±5 minutes (enforced by Hub).
 *
 * Required env vars (server-only):
 *   - BRAIN_TO_HUB_SECRET (32-byte hex; shared with Hub)
 *   - HUB_BASE_URL (optional; defaults to the Hub published URL)
 */

import { createHash, createHmac } from "node:crypto";

const DEFAULT_HUB_BASE_URL =
  "https://project--31365e7e-5b5b-4198-8441-c89e59d7106b.lovable.app";

const MODULE_NAME = "brain";

function getHubBaseUrl(): string {
  return (process.env.HUB_BASE_URL ?? DEFAULT_HUB_BASE_URL).replace(/\/+$/, "");
}

function getSecret(): string {
  const secret = process.env.BRAIN_TO_HUB_SECRET;
  if (!secret) {
    throw new Error(
      "BRAIN_TO_HUB_SECRET is not configured. Add it to project secrets with the same value Hub uses.",
    );
  }
  return secret;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function sign(
  method: string,
  pathWithQuery: string,
  rawBody: string,
  timestamp: string,
): string {
  const bodyHash = sha256Hex(rawBody);
  const message = `${timestamp}.${method.toUpperCase()}.${pathWithQuery}.${bodyHash}`;
  return createHmac("sha256", getSecret()).update(message, "utf8").digest("hex");
}

type HubRequestInit = {
  method: "GET" | "POST";
  /** Path starting with "/api/public/..." — query string included for GET. */
  path: string;
  /** Plain object; will be JSON-stringified for POST. Ignored for GET. */
  body?: unknown;
};

export type HubResponse<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; body?: string };

export async function hubFetch<T = unknown>(
  init: HubRequestInit,
): Promise<HubResponse<T>> {
  const { method, path } = init;
  const rawBody = method === "POST" && init.body !== undefined
    ? JSON.stringify(init.body)
    : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = sign(method, path, rawBody, timestamp);

  const url = `${getHubBaseUrl()}${path}`;

  const headers: Record<string, string> = {
    "X-Kylo-Module": MODULE_NAME,
    "X-Kylo-Timestamp": timestamp,
    "X-Kylo-Signature": signature,
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? rawBody : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: `Hub fetch failed: ${message}` };
  }

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `Hub responded ${response.status}`,
      body: text,
    };
  }

  try {
    const data = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    return { ok: true, status: response.status, data };
  } catch {
    return {
      ok: false,
      status: response.status,
      error: "Hub returned non-JSON response",
      body: text,
    };
  }
}

// ----- Typed wrappers around the two Hub endpoints --------------------------

export type RegisterTenantResponse = {
  tenant_id: string;
  created: boolean;
};

export type ResolveTenantResponse = {
  tenant_id: string;
  module_user_ids: Record<string, string>;
  cached_until: string;
};

export function hubRegisterTenant(
  moduleUserId: string,
  primaryEmail: string,
): Promise<HubResponse<RegisterTenantResponse>> {
  return hubFetch<RegisterTenantResponse>({
    method: "POST",
    path: "/api/public/cross/tenant/register",
    body: {
      module: MODULE_NAME,
      module_user_id: moduleUserId,
      primary_email: primaryEmail,
    },
  });
}

export function hubResolveTenant(
  module: string,
  userId: string,
): Promise<HubResponse<ResolveTenantResponse>> {
  const qs = new URLSearchParams({ module, user_id: userId }).toString();
  return hubFetch<ResolveTenantResponse>({
    method: "GET",
    path: `/api/public/cross/tenant/resolve?${qs}`,
  });
}
