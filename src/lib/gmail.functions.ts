import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Gmail csatlakoztatás állapota egy workflow-hoz.
 */
export const getGmailStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("workflow_credentials")
      .select("gmail_email, gmail_connected_at")
      .eq("workflow_id", data.workflowId)
      .maybeSingle();
    const r = row as {
      gmail_email?: string | null;
      gmail_connected_at?: string | null;
    } | null;
    return {
      connected: !!r?.gmail_email,
      email: r?.gmail_email ?? null,
      connectedAt: r?.gmail_connected_at ?? null,
    };
  });

/**
 * Elindítja az OAuth flow-t: aláírt state-tel visszaadja a Google-nál kezdődő URL-t.
 */
export const startGmailOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workflowId: z.string().uuid(),
        redirectUri: z.string().url(),
        loginHint: z.string().email().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { signState, buildAuthUrl } = await import("@/lib/gmail/oauth.server");
    const state = await signState(data.workflowId, data.redirectUri);
    const url = buildAuthUrl({
      state,
      redirectUri: data.redirectUri,
      loginHint: data.loginHint ?? null,
    });
    return { url };
  });

/**
 * A callback oldal hívja: code + state → refresh token, e-mail elmentve.
 */
export const finishGmailOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: z.string().min(1),
        state: z.string().min(1),
        redirectUri: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const {
      verifyState,
      exchangeCode,
      fetchGoogleEmail,
      saveGmailTokens,
    } = await import("@/lib/gmail/oauth.server");
    const verified = await verifyState(data.state);
    if (!verified) throw new Error("Érvénytelen vagy lejárt state — kérlek próbáld újra.");
    const tokens = await exchangeCode({
      code: data.code,
      redirectUri: data.redirectUri,
    });
    if (!tokens.refresh_token) {
      throw new Error(
        "A Google nem küldött refresh tokent. Vond vissza a hozzáférést (myaccount.google.com/permissions) és próbáld újra.",
      );
    }
    const email = await fetchGoogleEmail(tokens.access_token);
    await saveGmailTokens({
      workflowId: verified.workflowId,
      email,
      refreshToken: tokens.refresh_token,
    });
    return { ok: true as const, email, workflowId: verified.workflowId };
  });

export const disconnectGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workflowId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { clearGmailTokens } = await import("@/lib/gmail/oauth.server");
    await clearGmailTokens(data.workflowId);
    return { ok: true as const };
  });
