/**
 * Kylo Vault — helyi ügynök (Vault Agent) szerveroldali segédek.
 *
 * Az ügynök egy otthoni/irodai gépen fut, párosító kóddal kapcsolódik, majd
 * saját tokennel jelentkezik be. A fájlok mindig a VPS titkosított széfjébe
 * kerülnek: a Brain csak átfolyatja a bájtokat, másolatot nem tárol.
 *
 * Tárolási hely a széfen belül: agents/<agent_id>/<mappa-slug>/<relatív út>
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const AGENT_ONLINE_WINDOW_MS = 3 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB / fájl
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Kódok és tokenek
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 6 jegyű, nagybetűs-numerikus párosító kód (összetéveszthető jelek nélkül). */
export function generatePairCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** 32 bájtos ügynök-token (csak egyszer, párosításkor látható). */
export function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Útvonalak
// ---------------------------------------------------------------------------

/** Abszolút gépi útvonalból biztonságos mappanév a széfen belül. */
export function folderSlug(absolutePath: string): string {
  const base =
    absolutePath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .slice(-2)
      .join("-") || "root";
  const slug = base
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  const suffix = sha256Hex(absolutePath).slice(0, 8);
  return `${slug || "mappa"}-${suffix}`;
}

/** Relatív út ellenőrzése: nincs kilépés, nincs abszolút út, nincs meghajtóbetű. */
export function sanitizeRel(rel: string): string | null {
  const value = String(rel || "").trim();
  if (!value) return null;
  if (/^[a-zA-Z]:/.test(value)) return null;
  if (value.startsWith("/") || value.startsWith("\\")) return null;
  if (value.includes("\0")) return null;
  const segments = value.replace(/\\/g, "/").split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  if (segments.length > 40) return null;
  const joined = segments.join("/");
  if (joined.length > 900) return null;
  return joined;
}

export function agentVaultPath(agentId: string, slug: string, rel?: string): string {
  const base = `agents/${agentId}/${slug}`;
  return rel ? `${base}/${rel}` : base;
}

/** base64 fejléc-érték visszafejtése (útvonalak ékezetekkel is). */
export function decodeHeaderB64(value: string | null): string | null {
  if (!value) return null;
  try {
    const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Publikus végpont címe (ezt kapja az ügynök)
// ---------------------------------------------------------------------------

export function agentEndpoint(): string {
  const base = (
    process.env.VAULT_PUBLIC_BASE_URL ||
    process.env.BRAIN_PUBLIC_BASE_URL ||
    "https://brain.kylosystems.com"
  ).replace(/\/+$/, "");
  return `${base}/api/public/vault/agent`;
}

// ---------------------------------------------------------------------------
// Ügynök hitelesítés
// ---------------------------------------------------------------------------

export type AgentRow = {
  id: string;
  tenant_id: string;
  hostname: string | null;
  platform: string | null;
  version: string | null;
  revoked_at: string | null;
};

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/** Bearer token → ügynök sor (vagy null, ha érvénytelen / visszavont). */
export async function authenticateAgent(request: Request): Promise<AgentRow | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("vault_agents")
    .select("id,tenant_id,hostname,platform,version,revoked_at")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  return data as AgentRow;
}

// ---------------------------------------------------------------------------
// Egyszerű esemény-napló + IP alapú sebességkorlát
// ---------------------------------------------------------------------------

export async function logAgentEvent(
  event: string,
  opts: { tenantId?: string | null; agentId?: string | null; ip?: string | null; detail?: unknown },
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("vault_agent_events").insert({
      event,
      tenant_id: opts.tenantId ?? null,
      agent_id: opts.agentId ?? null,
      ip: opts.ip ?? null,
      detail: (opts.detail ?? {}) as never,
    });
  } catch {
    /* a naplózás soha ne akassza meg a műveletet */
  }
}

export function requestIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Igaz, ha az adott IP túllépte a percenkénti keretet az adott eseményből. */
export async function isRateLimited(
  event: string,
  ip: string,
  limitPerMinute: number,
): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabaseAdmin
    .from("vault_agent_events")
    .select("id", { count: "exact", head: true })
    .eq("event", event)
    .eq("ip", ip)
    .gte("created_at", since);
  return (count ?? 0) >= limitPerMinute;
}

// ---------------------------------------------------------------------------
// VPS fájlkiszolgáló — feltöltés (a Brain csak átfolyatja a bájtokat)
// ---------------------------------------------------------------------------

function fileServer(): { base: string; token: string } {
  const base = process.env.VAULT_FILE_BASE_URL?.replace(/\/+$/, "");
  const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
  if (!base) throw new Error("VAULT_FILE_BASE_URL nincs beállítva");
  if (!token) throw new Error("WORKER_API_TOKEN nincs beállítva");
  return { base, token };
}

export async function uploadToVault(
  vaultPath: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer,
  opts: { hash?: string | null; mtime?: string | null; contentLength?: string | null },
): Promise<Response> {
  const { base, token } = fileServer();
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/octet-stream",
  };
  if (opts.hash) headers["x-vault-hash"] = opts.hash;
  if (opts.mtime) headers["x-vault-mtime"] = opts.mtime;
  if (opts.contentLength) headers["content-length"] = opts.contentLength;

  return fetch(`${base}/upload?path=${encodeURIComponent(vaultPath)}`, {
    method: "PUT",
    headers,
    body: body as BodyInit,
    // Streamelt kérés – nem pufferelünk 2 GB-ot a memóriában.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
