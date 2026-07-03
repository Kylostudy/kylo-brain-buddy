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

export async function signState(workflowId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 600; // 10 perc
  const payload = `${workflowId}.${exp}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifyState(
  state: string,
): Promise<{ workflowId: string } | null> {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [workflowId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const expected = await hmac(`${workflowId}.${expStr}`);
  if (expected !== sig) return null;
  return { workflowId };
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
      { onConflict: "workflow_id" },
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
    .eq("workflow_id", workflowId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/*  Access token szerzés futáskor                                      */
/* ------------------------------------------------------------------ */

export async function getGmailAccessTokenServer(
  workflowId: string,
): Promise<{ accessToken: string; email: string } | null> {
  const sb = serviceSupabase();
  const { data: row } = await sb
    .from("workflow_credentials")
    .select("gmail_email, gmail_refresh_ciphertext, gmail_refresh_nonce")
    .eq("workflow_id", workflowId)
    .maybeSingle();
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
