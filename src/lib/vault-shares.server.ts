/**
 * Kylo Vault — megosztó linkek (server-only segédek).
 *
 * A fájlok fizikailag a VPS titkosított széfjében vannak. A Brain soha nem
 * tárol másolatot: a letöltéskor átfolyatja (proxy) a bájtokat a VPS-en futó,
 * csak olvasó fájlkiszolgálóról. A látogató mindig csak a Brain címét látja.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type ShareOutcome =
  | "ok"
  | "expired"
  | "bad_password"
  | "limit_reached"
  | "not_found"
  | "revoked"
  | "rate_limited";

/** ZIP-ben letölthető mappa felső határa (5 GB). */
export const ZIP_MAX_BYTES = 5 * 1024 * 1024 * 1024;

const DEFAULT_EXPIRY_HOURS = 24 * 7;

export function defaultExpiryHours(): number {
  return DEFAULT_EXPIRY_HOURS;
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/** 32 bájt véletlen, URL-biztos token. */
export function generateShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Jelszó (PBKDF2-SHA256, WebCrypto — Worker-kompatibilis)
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 150_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64url(parts[2]!);
  const expected = fromBase64url(parts[3]!);
  const actual = await pbkdf2(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Rövid életű letöltő-kulcs (a jelszó soha nem kerül a linkbe)
// ---------------------------------------------------------------------------

const DL_KEY_TTL_SECONDS = 60 * 60; // 1 óra

function linkSecret(): string {
  const s = process.env.VAULT_SHARE_LINK_SECRET;
  if (!s) throw new Error("VAULT_SHARE_LINK_SECRET nincs beállítva");
  return s;
}

export function issueDownloadKey(token: string): string {
  const exp = Math.floor(Date.now() / 1000) + DL_KEY_TTL_SECONDS;
  const sig = createHmac("sha256", linkSecret()).update(`${token}.${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyDownloadKey(token: string, key: string | null): boolean {
  if (!key) return false;
  const [expStr, sig] = key.split(".");
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = createHmac("sha256", linkSecret()).update(`${token}.${exp}`).digest("hex");
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// VPS fájlkiszolgáló kliens
// ---------------------------------------------------------------------------

export type VaultEntry = { path: string; size: number };
export type VaultListing = {
  kind: "file" | "dir";
  name: string;
  size: number;
  files: VaultEntry[];
};

function fileServer(): { base: string; token: string } {
  const base = process.env.VAULT_FILE_BASE_URL?.replace(/\/+$/, "");
  const token = (process.env.WORKER_API_TOKEN_V2 || process.env.WORKER_API_TOKEN)?.trim();
  if (!base) throw new Error("VAULT_FILE_BASE_URL nincs beállítva");
  if (!token) throw new Error("WORKER_API_TOKEN nincs beállítva");
  return { base, token };
}

export async function listVaultPath(path: string): Promise<VaultListing | null> {
  const { base, token } = fileServer();
  const res = await fetch(`${base}/list?path=${encodeURIComponent(path)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fájlkiszolgáló hiba: ${res.status}`);
  return (await res.json()) as VaultListing;
}

/** Nyers stream a széfből: egy fájl, vagy egy mappa ZIP-ben. */
export async function fetchVaultStream(
  path: string,
  mode: "file" | "zip",
): Promise<Response> {
  const { base, token } = fileServer();
  const url =
    mode === "zip"
      ? `${base}/zip?path=${encodeURIComponent(path)}&maxBytes=${ZIP_MAX_BYTES}`
      : `${base}/file?path=${encodeURIComponent(path)}`;
  return fetch(url, { headers: { authorization: `Bearer ${token}` } });
}

// ---------------------------------------------------------------------------
// Útvonal-összefűzés (könyvtárból való kilépés tiltása)
// ---------------------------------------------------------------------------

export function joinSharePath(base: string, relative: string): string | null {
  const cleanBase = base.replace(/^\/+|\/+$/g, "");
  const rel = relative.replace(/^\/+/, "");
  if (!rel) return cleanBase;
  const segments = rel.split("/");
  if (segments.some((s) => s === ".." || s === "." || s === "")) return null;
  return `${cleanBase}/${segments.join("/")}`;
}

// ---------------------------------------------------------------------------
// Kliens IP
// ---------------------------------------------------------------------------

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
