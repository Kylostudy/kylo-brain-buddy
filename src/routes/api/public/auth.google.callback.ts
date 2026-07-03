import { createFileRoute } from "@tanstack/react-router";

/**
 * Publikus Google OAuth callback — /api/public/* alatt van, így
 * NEM védi a Lovable preview auth-gate-je (403). Google ide küldi vissza
 * a felhasználót, mi feldolgozzuk a code+state-et szerver oldalon és
 * átirányítunk a workflow oldalra.
 */
export const Route = createFileRoute("/api/public/auth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const oauthError = url.searchParams.get("error") ?? "";
        // A redirect_uri-t pontosan úgy kell átadni a Google-nek a token
        // cserénél, ahogy az auth kérésben szerepelt.
        const redirectUri = `${url.origin}/api/public/auth/google/callback`;

        const fail = (msg: string, wf?: string) => {
          const target = new URL(wf ? `/w/${wf}` : "/", url.origin);
          target.searchParams.set("gmail", "error");
          target.searchParams.set("gmail_msg", msg);
          return Response.redirect(target.toString(), 302);
        };

        if (oauthError) return fail(oauthError);
        if (!code || !state) return fail("Hiányzó kód vagy state.");

        try {
          const {
            verifyState,
            exchangeCode,
            fetchGoogleEmail,
            saveGmailTokens,
          } = await import("@/lib/gmail/oauth.server");

          const verified = await verifyState(state);
          if (!verified) return fail("Érvénytelen vagy lejárt state.");

          const tokens = await exchangeCode({ code, redirectUri });
          if (!tokens.refresh_token) {
            return fail(
              "A Google nem küldött refresh tokent. Vond vissza a hozzáférést (myaccount.google.com/permissions) és próbáld újra.",
              verified.workflowId,
            );
          }
          const email = await fetchGoogleEmail(tokens.access_token);
          await saveGmailTokens({
            workflowId: verified.workflowId,
            email,
            refreshToken: tokens.refresh_token,
          });

          const target = new URL(`/w/${verified.workflowId}`, url.origin);
          target.searchParams.set("gmail", "ok");
          target.searchParams.set("gmail_email", email);
          return Response.redirect(target.toString(), 302);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },
  },
});
