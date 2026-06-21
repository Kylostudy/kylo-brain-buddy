// worker/executor/run.js
// Egyetlen workflow-futtatás. A spec JSON-t a SPEC_JSON env-ből olvassa,
// a visszafejtett hitelesítő adatokat (ha vannak) a CREDENTIALS_JSON env-ből.
// Playwright-tel végrehajtja a megadott lépéseket, és JSON-line logokat ír a
// stdout-ra. A worker-orchestrator olvassa ezeket vissza.

import { chromium } from "playwright";
import { runTikTok } from "./scripts/tiktok.js";
import { runDecathlonStock } from "./scripts/decathlon-stock.js";

function log(level, message, extra = {}) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, message, ...extra }) +
      "\n",
  );
}

function finish(status, result = null, error = null) {
  process.stdout.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      final: true,
      status,
      result,
      error,
    }) + "\n",
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

  const monitorType = (spec.monitor_type || spec.platform || "").toLowerCase();
  log(
    "info",
    `Indítás — típus: ${monitorType || "n/a"}, fiók: ${spec.account_label || "n/a"}, cred: ${creds ? "✓" : "✗"}`,
  );

  // Proxy átirányítás, ha a credentialben van.
  const launchOpts = { headless: true };
  if (creds?.proxy) {
    try {
      const u = new URL(creds.proxy);
      launchOpts.proxy = {
        server: `${u.protocol}//${u.host}`,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
      log("info", `Proxy aktív: ${u.host}`);
    } catch (e) {
      log("warn", `Proxy URL nem értelmezhető: ${e.message}`);
    }
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: spec.locale || "hu-HU",
  });

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
        log("info", `Cookie-k injektálva: ${norm.length} db.`);
      }
    } catch (e) {
      log("warn", `Cookie parse hiba: ${e.message}`);
    }
  }

  const page = context.pages()[0] || (await context.newPage());

  try {
    let result;
    if (monitorType === "tiktok") {
      result = await runTikTok({ page, context, spec, creds, log });
    } else if (monitorType === "decathlon-stock") {
      result = await runDecathlonStock({ page, spec, log });
    } else {
      log("warn", `Típus "${monitorType}" még nincs implementálva — demo.`);
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
