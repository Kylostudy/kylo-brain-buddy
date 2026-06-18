// worker/executor/run.js
// Egyetlen workflow-futtatás. A spec JSON-t a SPEC_JSON env-ből olvassa, a
// visszafejtett hitelesítő adatokat a CREDENTIALS_JSON env-ből. Playwright-tel
// végrehajtja a megadott lépéseket, és JSON-line logokat ír a stdout-ra.
// A worker-orchestrator olvassa ezeket vissza.

import { chromium } from "playwright";
import { runTikTok } from "./scripts/tiktok.js";

function log(level, message, extra = {}) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, message, ...extra }) +
      "\n",
  );
}

function finish(status, result = null, error = null) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), final: true, status, result, error }) +
      "\n",
  );
  process.exit(status === "succeeded" ? 0 : 1);
}

async function main() {
  let spec, creds;
  try {
    spec = JSON.parse(process.env.SPEC_JSON || "{}");
  } catch (e) {
    return finish("failed", null, `SPEC_JSON parse hiba: ${e.message}`);
  }
  try {
    creds = process.env.CREDENTIALS_JSON
      ? JSON.parse(process.env.CREDENTIALS_JSON)
      : null;
  } catch (e) {
    return finish("failed", null, `CREDENTIALS_JSON parse hiba: ${e.message}`);
  }

  log(
    "info",
    `Indítás — platform: ${spec.platform || "n/a"}, fiók: ${spec.account_label || "n/a"}, cred: ${creds ? "✓" : "✗"}`,
  );

  const runner = (process.env.RUNNER || "docker").toLowerCase();

  // Proxy átirányítás, ha a credentialben van. Formátum: http://user:pass@host:port
  const launchOpts = { headless: true };
  if (creds?.proxy) {
    try {
      const u = new URL(creds.proxy);
      launchOpts.proxy = {
        server: `${u.protocol}//${u.host}`,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
      log("info", `Proxy aktív: ${u.host} (Dolphin-azonos IP)`);
    } catch (e) {
      log("warn", `Proxy URL nem értelmezhető: ${e.message}`);
    }
  }

  let browser;
  let context;

  if (runner === "steel") {
    // === Steel.dev: távoli felhő-böngésző, CDP-n keresztül ===
    const apiKey = process.env.STEEL_API_KEY;
    if (!apiKey) return finish("failed", null, "STEEL_API_KEY hiányzik az orchestrator env-jéből.");

    const sessionBody = {
      sessionTimeout: 10 * 60 * 1000,
      blockAds: true,
      stealthConfig: { humanlikeInteractions: true, skipFingerprintInjection: false },
    };
    if (launchOpts.proxy) {
      sessionBody.proxyUrl = creds.proxy; // Steel a teljes URL-t várja
    }

    log("info", "Steel session létrehozása…");
    const res = await fetch("https://api.steel.dev/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Steel-Api-Key": apiKey },
      body: JSON.stringify(sessionBody),
    });
    if (!res.ok) {
      const txt = await res.text();
      return finish("failed", null, `Steel API ${res.status}: ${txt.slice(0, 200)}`);
    }
    const session = await res.json();
    log("info", `Steel session: ${session.id}`);
    if (session.sessionViewerUrl) log("info", `Viewer: ${session.sessionViewerUrl}`);

    const wsUrl =
      session.websocketUrl ||
      `wss://connect.steel.dev?apiKey=${apiKey}&sessionId=${session.id}`;
    browser = await chromium.connectOverCDP(wsUrl);
    // Steel mindig ad egy default contextet — azt használjuk
    context = browser.contexts()[0] || (await browser.newContext());
    log("info", "Playwright csatlakozott a Steel browserhez (CDP).");
  } else {
    // === Saját Docker worker: helyi Chromium ===
    browser = await chromium.launch(launchOpts);
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
  }

  // Session cookie-k injektálása (Dolphin / EditThisCookie JSON export)
  if (creds?.cookies) {
    try {
      const parsed = JSON.parse(creds.cookies);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const norm = parsed
          .map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || "/",
            expires: c.expirationDate || c.expires || -1,
            httpOnly: !!c.httpOnly,
            secure: !!c.secure,
            sameSite:
              c.sameSite === "no_restriction" || c.sameSite === "None"
                ? "None"
                : c.sameSite === "lax" || c.sameSite === "Lax"
                  ? "Lax"
                  : "Strict",
          }))
          .filter((c) => c.name && c.domain);
        await context.addCookies(norm);
        log("info", `Cookie-k injektálva: ${norm.length} db (session folytatás).`);
      }
    } catch (e) {
      log("warn", `Cookie parse hiba: ${e.message}`);
    }
  }

  const page = context.pages()[0] || (await context.newPage());

  try {
    const platform = (spec.platform || "").toLowerCase();
    let result;
    if (platform === "tiktok") {
      result = await runTikTok({ page, context, spec, creds, log });
    } else {
      log("warn", `Platform "${spec.platform}" még nincs implementálva — demo.`);
      await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
      result = { demo: true };
    }

    await browser.close();
    finish("succeeded", result);
  } catch (e) {
    log("error", `Futtatás hibára futott: ${e.message}`);
    await browser.close().catch(() => {});
    finish("failed", null, e.message);
  }
}

main().catch((e) => finish("failed", null, e.message));
