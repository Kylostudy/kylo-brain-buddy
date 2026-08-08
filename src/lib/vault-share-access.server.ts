/**
 * Kylo Vault — publikus megosztás feloldása, naplózás és találgatás-védelem.
 * Csak szerveroldalon fut.
 */

import { clientIp, verifyPassword, type ShareOutcome } from "./vault-shares.server";

export type ShareRow = {
  id: string;
  tenant_id: string;
  path: string;
  label: string | null;
  token: string;
  password_hash: string | null;
  expires_at: string;
  max_downloads: number | null;
  download_count: number;
  allow_download: boolean;
  revoked_at: string | null;
};

export type ResolveResult =
  | { ok: true; share: ShareRow }
  | { ok: false; outcome: Exclude<ShareOutcome, "ok">; status: number };

/** Semleges üzenet — nem áruljuk el, hogy a link létezett-e valaha. */
export const NEUTRAL_MESSAGE = "Ez a link már nem érvényes.";

const WINDOW_MINUTES = 10;
const MAX_FAILURES_PER_IP = 15;
const MAX_FAILURES_PER_TOKEN = 10;

export async function logAccess(opts: {
  shareId: string | null;
  token: string;
  request: Request;
  outcome: ShareOutcome;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("vault_share_access").insert({
      share_id: opts.shareId,
      token_attempted: opts.shareId ? null : opts.token.slice(0, 12),
      ip: clientIp(opts.request),
      user_agent: opts.request.headers.get("user-agent")?.slice(0, 500) ?? null,
      outcome: opts.outcome,
    });
  } catch (e) {
    console.error("vault share access log failed", e);
  }
}

/** Egyszerű találgatás-védelem: sok sikertelen próbálkozás IP-re vagy tokenre. */
async function isRateLimited(token: string, request: Request): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const failures = ["bad_password", "not_found", "rate_limited"];

  const [{ count: ipCount }, { count: tokenCount }] = await Promise.all([
    supabaseAdmin
      .from("vault_share_access")
      .select("id", { count: "exact", head: true })
      .eq("ip", clientIp(request))
      .in("outcome", failures)
      .gte("ts", since),
    supabaseAdmin
      .from("vault_share_access")
      .select("id", { count: "exact", head: true })
      .eq("token_attempted", token.slice(0, 12))
      .in("outcome", failures)
      .gte("ts", since),
  ]);

  return (ipCount ?? 0) >= MAX_FAILURES_PER_IP || (tokenCount ?? 0) >= MAX_FAILURES_PER_TOKEN;
}

/**
 * Megkeresi és ellenőrzi a megosztást. Minden elutasítás ugyanazt a semleges
 * üzenetet kapja a hívó oldalon.
 */
export async function resolveShare(
  token: string,
  password: string | null,
  request: Request,
): Promise<ResolveResult> {
  if (!token || token.length < 20 || token.length > 100) {
    await logAccess({ shareId: null, token, request, outcome: "not_found" });
    return { ok: false, outcome: "not_found", status: 404 };
  }

  if (await isRateLimited(token, request)) {
    await logAccess({ shareId: null, token, request, outcome: "rate_limited" });
    return { ok: false, outcome: "rate_limited", status: 429 };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("vault_shares")
    .select(
      "id,tenant_id,path,label,token,password_hash,expires_at,max_downloads,download_count,allow_download,revoked_at",
    )
    .eq("token", token)
    .maybeSingle();

  const share = data as ShareRow | null;
  if (!share) {
    await logAccess({ shareId: null, token, request, outcome: "not_found" });
    return { ok: false, outcome: "not_found", status: 404 };
  }

  if (share.revoked_at) {
    await logAccess({ shareId: share.id, token, request, outcome: "revoked" });
    return { ok: false, outcome: "revoked", status: 404 };
  }

  if (new Date(share.expires_at).getTime() < Date.now()) {
    await logAccess({ shareId: share.id, token, request, outcome: "expired" });
    return { ok: false, outcome: "expired", status: 404 };
  }

  if (share.max_downloads !== null && share.download_count >= share.max_downloads) {
    await logAccess({ shareId: share.id, token, request, outcome: "limit_reached" });
    return { ok: false, outcome: "limit_reached", status: 404 };
  }

  if (share.password_hash) {
    if (!password || !(await verifyPassword(password, share.password_hash))) {
      await logAccess({ shareId: share.id, token, request, outcome: "bad_password" });
      return { ok: false, outcome: "bad_password", status: 401 };
    }
  }

  return { ok: true, share };
}

export async function bumpDownloadCount(share: ShareRow): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("vault_shares")
    .update({
      download_count: share.download_count + 1,
      last_access_at: new Date().toISOString(),
    })
    .eq("id", share.id);
}
