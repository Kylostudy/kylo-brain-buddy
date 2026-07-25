/**
 * Gmail OAuth szerver-oldali segédfüggvények.
 * SERVER-ONLY. Soha ne importáld kliens kódból.
 *
 * A refresh tokent titkosítva tároljuk (crypto.server.ts).
 * Az access tokent minden hívás előtt frissítjük Google-tól.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { encryptString, decryptString } from "@/lib/credentials/crypto.server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
].join(" ");

function serviceSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/* ------------------------------------------------------------------ */
/*  Állapot (state) aláírás — HMAC-SHA256, hogy a redirect ne legyen  */
/*  hamisítható. A state hordozza a workflowId-t és egy lejárati időt.*/
/* ------------------------------------------------------------------ */

async function hmac(data: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  const bytes = new Uint8Array(sig);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signState(
  workflowId: string,
  redirectUri: string,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 600; // 10 perc
  const ru = btoa(redirectUri)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payload = `${workflowId}.${exp}.${ru}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifyState(
  state: string,
): Promise<{ workflowId: string; redirectUri: string } | null> {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [workflowId, expStr, ru, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const expected = await hmac(`${workflowId}.${expStr}.${ru}`);
  if (expected !== sig) return null;
  try {
    const pad = "=".repeat((4 - (ru.length % 4)) % 4);
    const redirectUri = atob(ru.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return { workflowId, redirectUri };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Auth URL építés                                                    */
/* ------------------------------------------------------------------ */

export function buildAuthUrl(params: {
  state: string;
  redirectUri: string;
  loginHint?: string | null;
}): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID!);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent select_account"); // fiókválasztó + refresh token
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", params.state);
  if (params.loginHint) u.searchParams.set("login_hint", params.loginHint);
  return u.toString();
}

/* ------------------------------------------------------------------ */
/*  Kód → token csere                                                  */
/* ------------------------------------------------------------------ */

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCode(params: {
  code: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Google token csere sikertelen: ${r.status} ${text}`);
  }
  return (await r.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Google token frissítés sikertelen: ${r.status} ${text}`);
  }
  const j = (await r.json()) as TokenResponse;
  return j.access_token;
}

/* ------------------------------------------------------------------ */
/*  Email cím lekérése az access tokennel (userinfo endpoint)          */
/* ------------------------------------------------------------------ */

export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("Nem sikerült lekérni az e-mail címet a Google-től.");
  const j = (await r.json()) as { email?: string };
  if (!j.email) throw new Error("Google userinfo válaszban nincs e-mail.");
  return j.email;
}

/* ------------------------------------------------------------------ */
/*  Refresh token tárolás                                              */
/* ------------------------------------------------------------------ */

export async function saveGmailTokens(params: {
  workflowId: string;
  email: string;
  refreshToken: string;
}) {
  const enc = await encryptString(params.refreshToken);
  const sb = serviceSupabase();
  const { error } = await sb
    .from("workflow_credentials")
    .upsert(
      {
        workflow_id: params.workflowId,
        platform: "gmail",
        username: params.email,
        gmail_email: params.email,
        gmail_refresh_ciphertext: enc.ciphertext,
        gmail_refresh_nonce: enc.nonce,
        gmail_connected_at: new Date().toISOString(),
      } as never,
      { onConflict: "workflow_id,platform" },
    );
  if (error) throw new Error(error.message);
}

export async function clearGmailTokens(workflowId: string) {
  const sb = serviceSupabase();
  const { error } = await sb
    .from("workflow_credentials")
    .update({
      gmail_email: null,
      gmail_refresh_ciphertext: null,
      gmail_refresh_nonce: null,
      gmail_connected_at: null,
    } as never)
    .eq("workflow_id", workflowId)
    .eq("platform", "gmail");
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/*  Access token szerzés futáskor                                      */
/* ------------------------------------------------------------------ */

export async function getGmailAccessTokenServer(
  workflowId: string,
): Promise<{ accessToken: string; email: string } | null> {
  const sb = serviceSupabase();
  const { data: row, error } = await sb
    .from("workflow_credentials")
    .select("gmail_email, gmail_refresh_ciphertext, gmail_refresh_nonce")
    .eq("workflow_id", workflowId)
    .eq("platform", "gmail")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const r = row as {
    gmail_email?: string | null;
    gmail_refresh_ciphertext?: string | null;
    gmail_refresh_nonce?: string | null;
  } | null;
  if (!r?.gmail_refresh_ciphertext || !r.gmail_refresh_nonce || !r.gmail_email) {
    return null;
  }
  const refreshToken = await decryptString(
    r.gmail_refresh_ciphertext,
    r.gmail_refresh_nonce,
  );
  const accessToken = await refreshAccessToken(refreshToken);
  return { accessToken, email: r.gmail_email };
}

/* ------------------------------------------------------------------ */
/*  Verifikációs kód keresés a bejövő levelek között                   */
/* ------------------------------------------------------------------ */

export async function findVerificationCodeServer(params: {
  workflowId: string;
  /** pl. "tiktok", "instagram" — csak a megfelelő feladóktól nézzük */
  platform?: string;
  /** hány másodpercnél frissebb legyen a levél (alap: 300s) */
  freshWithinSec?: number;
}): Promise<{ code: string; from: string; subject: string } | null> {
  const tok = await getGmailAccessTokenServer(params.workflowId);
  if (!tok) return null;
  const fresh = params.freshWithinSec ?? 300;
  const afterSec = Math.floor(Date.now() / 1000) - fresh;

  // Egyszerű keresés: friss levelek, amelyekben szerepel "code" / "verification" / "verify"
  const q = `newer_than:1d after:${afterSec} (verification OR verify OR code OR "kód" OR biztonsági)`;
  const listR = await fetch(
    `${GMAIL_API}/users/me/messages?maxResults=10&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${tok.accessToken}` } },
  );
  if (!listR.ok) return null;
  const list = (await listR.json()) as { messages?: { id: string }[] };
  if (!list.messages?.length) return null;

  const codeRegex = /\b(\d{4,8})\b/;
  for (const m of list.messages) {
    const mr = await fetch(
      `${GMAIL_API}/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${tok.accessToken}` } },
    );
    if (!mr.ok) continue;
    const meta = (await mr.json()) as {
      snippet?: string;
      payload?: { headers?: { name: string; value: string }[] };
    };
    const headers = meta.payload?.headers ?? [];
    const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
    const subject =
      headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
    if (
      params.platform &&
      !from.toLowerCase().includes(params.platform.toLowerCase()) &&
      !subject.toLowerCase().includes(params.platform.toLowerCase())
    ) {
      continue;
    }
    const hay = `${subject} ${meta.snippet ?? ""}`;
    const match = hay.match(codeRegex);
    if (match) return { code: match[1], from, subject };
  }
  return null;
}

function decodeBase64Url(data: string | null | undefined): string {
  if (!data) return "";
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return decodeURIComponent(
      Array.from(atob(padded))
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
  } catch {
    try {
      return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return "";
    }
  }
}

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailMessagePart & { headers?: { name: string; value: string }[] };
};

function collectMessageText(part: GmailMessagePart | null | undefined): string {
  if (!part) return "";
  const own = part.body?.data ? decodeBase64Url(part.body.data) : "";
  const children = (part.parts ?? []).map(collectMessageText).join("\n");
  return [own, children].filter(Boolean).join("\n");
}

function extractCandidateLinks(text: string): string[] {
  const decoded = text
    .replace(/=\r?\n/g, "")
    .replace(/=3D/g, "=")
    .replace(/&amp;/g, "&")
    .replace(/&#x3D;/g, "=")
    .replace(/&#61;/g, "=")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  const links = new Set<string>();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = hrefRegex.exec(decoded))) {
    links.add(hrefMatch[1]);
  }
  const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(decoded))) {
    links.add(urlMatch[0].replace(/[).,;]+$/, ""));
  }
  return Array.from(links)
    .map((link) => link.trim())
    .filter((link) => /^https?:\/\//i.test(link));
}

function pickConfirmationLink(links: string[]): string | null {
  const clean = links.filter((link) => {
    try {
      const host = new URL(link).hostname.toLowerCase();
      return !host.includes("google.com") && !host.includes("gmail.com") && !host.includes("gstatic.com");
    } catch {
      return false;
    }
  });
  const preferred = clean.find((link) => /kylo\.study/i.test(link));
  return preferred ?? clean[0] ?? null;
}

async function gmailJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail keresés sikertelen: ${response.status} ${text.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

function getHeader(
  headers: { name: string; value: string }[] | undefined,
  name: string,
): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeGmailAddress(value: string): string {
  const email = normalizeEmail(value);
  const match = email.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const address = match?.[0] ?? email;
  const [local, domain] = address.split("@");
  if (!local || !domain) return address;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.split("+")[0]?.replace(/\./g, "")}@gmail.com`;
  }
  return address;
}

function recipientMatches(headers: { name: string; value: string }[] | undefined, recipient: string): boolean {
  const expected = normalizeGmailAddress(recipient);
  const haystack = [
    getHeader(headers, "To"),
    getHeader(headers, "Delivered-To"),
    getHeader(headers, "X-Original-To"),
    getHeader(headers, "Cc"),
  ].join(" ");
  return normalizeGmailAddress(haystack).includes(expected);
}

function messageMillis(message: GmailMessage): number | null {
  const millis = Number(message.internalDate);
  return Number.isFinite(millis) ? millis : null;
}

function scoreMessageForConfirmation(params: {
  message: GmailMessage;
  link: string | null;
  recipient?: string | null;
}): number {
  const headers = params.message.payload?.headers ?? [];
  const from = getHeader(headers, "From").toLowerCase();
  const subject = getHeader(headers, "Subject").toLowerCase();
  const body = collectMessageText(params.message.payload).toLowerCase();
  const link = params.link?.toLowerCase() ?? "";
  const combined = `${from}\n${subject}\n${params.message.snippet ?? ""}\n${body}\n${link}`;
  let score = 0;
  if (link.includes("kylo.study")) score += 100;
  if (combined.includes("kylo")) score += 35;
  if (/confirm|confirmation|verify|verification|activate|activation|megerős|visszaigazol/i.test(combined)) score += 20;
  if (params.recipient && recipientMatches(headers, params.recipient)) score += 10;
  return score;
}

export type GmailLookupDebug = {
  reason: string;
  query?: string;
  total?: number;
  latestSubject?: string | null;
  latestFrom?: string | null;
  latestAgeSec?: number | null;
  freshWindowSec?: number;
  rejects?: Array<{ subject: string; from: string; ageSec: number; reason: string; score?: number }>;
};

export type GmailLookupResult =
  | { link: string; from: string; subject: string; snippet: string; debug: GmailLookupDebug }
  | { link: null; from: null; subject: null; snippet: null; debug: GmailLookupDebug };

export async function findVerificationLinkServer(params: {
  workflowId: string;
  recipient?: string | null;
  platform?: string;
  freshWithinSec?: number;
}): Promise<GmailLookupResult> {
  const tok = await getGmailAccessTokenServer(params.workflowId);
  if (!tok) return { link: null, from: null, subject: null, snippet: null, debug: { reason: "no_gmail_token" } };
  const fresh = params.freshWithinSec ?? 6 * 60 * 60;
  const freshCutoff = Date.now() - fresh * 1000;
  const recipient = params.recipient?.trim();
  const platform = params.platform?.trim();

  const keywordQuery = `newer_than:2d (${platform ? `${platform} OR ` : ""}kylo OR confirm OR confirmation OR verify OR verification OR activate OR activation OR megerősítés OR visszaigazolás)`;
  const fallbackQuery = "newer_than:2d";
  const ids = new Map<string, true>();

  for (const q of [keywordQuery, fallbackQuery]) {
    try {
      const list = await gmailJson<{ messages?: { id: string }[] }>(
        `${GMAIL_API}/users/me/messages?maxResults=30&includeSpamTrash=true&q=${encodeURIComponent(q)}`,
        tok.accessToken,
      );
      for (const message of list.messages ?? []) {
        if (message.id) ids.set(message.id, true);
      }
    } catch (error) {
      if (q === fallbackQuery) throw error;
    }
  }

  let best: { score: number; link: string; from: string; subject: string; snippet: string } | null = null;
  let latestMeta: { subject: string; from: string; ageSec: number; hadLink: boolean; score: number } | null = null;
  const rejects: Array<{ subject: string; from: string; ageSec: number; reason: string; score?: number }> = [];

  for (const id of ids.keys()) {
    const msg = await gmailJson<GmailMessage>(
      `${GMAIL_API}/users/me/messages/${id}?format=full`,
      tok.accessToken,
    );
    const headers = msg.payload?.headers ?? [];
    const from = getHeader(headers, "From");
    const subject = getHeader(headers, "Subject");
    const millis = messageMillis(msg);
    const ageSec = millis ? Math.floor((Date.now() - millis) / 1000) : -1;

    if (!latestMeta || (millis && ageSec >= 0 && ageSec < latestMeta.ageSec)) {
      latestMeta = { subject, from, ageSec, hadLink: false, score: 0 };
    }

    if (millis && millis < freshCutoff) {
      rejects.push({ subject, from, ageSec, reason: "too_old" });
      continue;
    }
    const haystack = `${from}\n${subject}\n${msg.snippet ?? ""}\n${collectMessageText(msg.payload)}`;
    const link = pickConfirmationLink(extractCandidateLinks(haystack));
    if (!link) {
      rejects.push({ subject, from, ageSec, reason: "no_link" });
      continue;
    }
    const score = scoreMessageForConfirmation({ message: msg, link, recipient });
    if (latestMeta && latestMeta.subject === subject) {
      latestMeta.hadLink = true;
      latestMeta.score = score;
    }
    if (score < 35) {
      rejects.push({ subject, from, ageSec, reason: "low_score", score });
      continue;
    }
    if (!best || score > best.score) {
      best = { score, link, from, subject, snippet: msg.snippet ?? "" };
    }
  }

  const debug = {
    query: keywordQuery,
    total: ids.size,
    latestSubject: latestMeta?.subject ?? null,
    latestFrom: latestMeta?.from ?? null,
    latestAgeSec: latestMeta?.ageSec ?? null,
    freshWindowSec: fresh,
    rejects: rejects.slice(0, 5),
    reason: ids.size === 0 ? "no_messages_matched" : (best ? "match" : "no_qualifying_message"),
  };

  if (best) {
    return {
      link: best.link,
      from: best.from,
      subject: best.subject,
      snippet: best.snippet,
      debug,
    };
  }
  return { link: null, debug };
}
