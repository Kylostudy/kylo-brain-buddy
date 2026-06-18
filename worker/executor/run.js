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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

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
