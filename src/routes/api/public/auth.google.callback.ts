import { createFileRoute } from "@tanstack/react-router";

/**
 * Publikus Google OAuth callback — /api/public/* alatt van, így
 * NEM védi a Lovable preview auth-gate-je (403). Google ide küldi vissza
 * a felhasználót, mi feldolgozzuk a code+state-et szerver oldalon és
 * egy önmagát becsukó kis HTML oldalt adunk vissza (a nyitó ablak
 * automatikusan frissíti a Gmail státuszt fókuszra).
 */
export const Route = createFileRoute("/api/public/auth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const oauthError = url.searchParams.get("error") ?? "";
        const redirectUri = `${url.origin}/api/public/auth/google/callback`;

        const htmlPage = (opts: {
          ok: boolean;
          title: string;
          message: string;
          email?: string;
        }) => {
          const color = opts.ok ? "#16a34a" : "#dc2626";
          const icon = opts.ok ? "✅" : "⚠️";
          const emailLine = opts.email
            ? `<p style="color:#475569;font-size:14px;margin:8px 0 0">${opts.email}</p>`
            : "";
          const body = `<!doctype html><html lang="hu"><head><meta charset="utf-8"/>
<title>${opts.title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;color:#0f172a}
  .card{background:#fff;border-radius:16px;padding:32px 28px;max-width:420px;width:100%;
        box-shadow:0 10px 30px rgba(15,23,42,.08);text-align:center}
  h1{font-size:20px;margin:12px 0 4px;color:${color}}
  p{color:#334155;font-size:15px;line-height:1.5;margin:8px 0 0}
  button{margin-top:20px;background:#0f172a;color:#fff;border:0;border-radius:10px;
         padding:10px 18px;font-size:14px;cursor:pointer}
  .icon{font-size:44px}
</style></head><body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${opts.title}</h1>
  <p>${opts.message}</p>
  ${emailLine}
  <button onclick="window.close()">Bezárás</button>
</div>
<script>
  try { if (window.opener) window.opener.focus(); } catch(e) {}
  setTimeout(function(){ try { window.close(); } catch(e){} }, ${opts.ok ? 1200 : 4000});
</script>
</body></html>`;
          return new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        };

        const fail = (msg: string) =>
          htmlPage({ ok: false, title: "Sikertelen csatlakozás", message: msg });

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
            );
          }
          const email = await fetchGoogleEmail(tokens.access_token);
          await saveGmailTokens({
            workflowId: verified.workflowId,
            email,
            refreshToken: tokens.refresh_token,
          });

          return htmlPage({
            ok: true,
            title: "Gmail csatlakoztatva",
            message: "Ez az ablak automatikusan bezáródik. Visszatérhetsz a workflow-hoz.",
            email,
          });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },
  },
});
