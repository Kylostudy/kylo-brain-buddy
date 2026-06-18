// worker/executor/run.js
// Egyetlen workflow-futtatás. A spec JSON-t a SPEC_JSON env-ből olvassa,
// Playwright-tel végrehajtja a megadott lépéseket, és JSON-line logokat ír
// a stdout-ra. A worker-orchestrator olvassa ezeket vissza.

import { chromium } from "playwright";

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
  let spec;
  try {
    spec = JSON.parse(process.env.SPEC_JSON || "{}");
  } catch (e) {
    return finish("failed", null, `SPEC_JSON parse hiba: ${e.message}`);
  }

  log("info", `Indítás — platform: ${spec.platform || "n/a"}, fiók: ${spec.account_label || "n/a"}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    // TODO: itt jönnek majd a per-platform stratégiák
    //   if (spec.platform === "TikTok") { await runTikTok(page, spec); }
    //   if (spec.platform === "Instagram") { await runInstagram(page, spec); }
    // Most csak demo: nyitunk egy semleges oldalt.
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    log("info", `Megnyitva: ${await page.title()}`);
    log("warn", "Per-platform feltöltő szkriptek még nincsenek implementálva.");

    await browser.close();
    finish("succeeded", { demo: true });
  } catch (e) {
    log("error", `Futtatás hibára futott: ${e.message}`);
    await browser.close().catch(() => {});
    finish("failed", null, e.message);
  }
}

main().catch((e) => finish("failed", null, e.message));
