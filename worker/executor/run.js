// worker/executor/run.js
// Egyetlen workflow-futtatás. A spec JSON-t a SPEC_JSON env-ből olvassa,
// a visszafejtett hitelesítő adatokat (ha vannak) a CREDENTIALS_JSON env-ből,
// a hozzárendelt proxy adatait a PROXY_JSON env-ből.
// Playwright-tel végrehajtja a megadott lépéseket, és JSON-line logokat ír a
// stdout-ra. A worker-orchestrator olvassa ezeket vissza.
//
// KÖTELEZŐ ELSŐ LÉPÉS: whoer.net IP-ellenőrzés (preflight). Ha a proxy
// megadta az elvárt országot és az nem egyezik a whoer.net által látott
// országgal, a run azonnal `failed` státusszal leáll — a cél oldal (TikTok
// stb.) MEG SEM NYÍLIK. Így nem tudunk véletlenül rossz IP-vel belépni.

import { chromium } from "playwright";
import { runTikTok } from "./scripts/tiktok.js";
import { runDecathlonStock } from "./scripts/decathlon-stock.js";
import { runBotSmokeTest } from "./scripts/bot-smoke-test.js";
import { humanWait, humanCasualScroll, humanIdleDrift } from "./scripts/humanize.js";

function log(level, message, extra = {}) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, message, ...extra }) +
      "\n",
  );
}

function emitPreflight(payload) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), preflight: payload }) + "\n",
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

// ---- whoer.net preflight ----
// A whoer.net publikus HTML-t szolgál ki, JSON API nélkül. A böngésző
// (a proxyn keresztül) megnyitja, majd kiolvassa a DOM-ból az IP-t,
// az országot és a várost. Ha a UI változna, több szelektort próbálunk +
// szöveg-regex fallback.
async function whoerPreflight(context, expectedCountry) {
  const page = await context.newPage();
  const started = Date.now();
  const out = {
    ok: false,
    ip: null,
    country: null,
    country_code: null,
    city: null,
    gateway_country: null,
    expected_country: expectedCountry || null,
    duration_ms: 0,
    error: null,
    screenshot_b64: null,
  };
  try {
    await page.goto("https://whoer.net/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // Adjunk időt a whoer script-jeinek, hogy kitöltsék a DOM-ot — közben
    // az "ember" néz-nézeget (kis scroll + kurzor-drift), nem áll ki
    // tökéletesen mozdulatlanul az oldalon.
    await humanWait(page, 1800);
    await humanCasualScroll(page, { rounds: 2 });
    await humanIdleDrift(page);
    await humanWait(page, 1200);

    const parsed = await page.evaluate(() => {
      const pick = (selectors) => {
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el && el.textContent && el.textContent.trim()) {
            return el.textContent.trim();
          }
        }
        return null;
      };
      const bodyText = document.body ? document.body.innerText : "";
      const ipMatch = bodyText.match(
        /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/,
      );
      // Ország kód a zászló span classból: "flag flag-nl"
      let cc = null;
      const flag = document.querySelector("[class*='flag-']");
      if (flag) {
        const m = String(flag.className).match(/flag-([a-z]{2})/i);
        if (m) cc = m[1].toUpperCase();
      }
      return {
        ip:
          pick([
            ".your-ip .num",
            ".your-ip .value",
            ".ip-address",
            "[data-ip]",
          ]) || (ipMatch ? ipMatch[1] : null),
        country: pick([
          ".your-country .value",
          ".country .value",
          ".geoinfo .country",
        ]),
        country_code: cc,
        city: pick([".your-city .value", ".city .value", ".geoinfo .city"]),
        gateway_country: pick([
          ".gateway-country .value",
          ".gateway .country",
        ]),
      };
    });

    out.ip = parsed.ip;
    out.country = parsed.country;
    out.country_code = parsed.country_code;
    out.city = parsed.city;
    out.gateway_country = parsed.gateway_country;

    // Screenshot (kisméretű JPEG, base64) — a UI-ban megnézhető bizonyíték
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 55 });
      out.screenshot_b64 = buf.toString("base64");
    } catch {}

    // Egyeztetés
    if (expectedCountry) {
      const seen = (out.country_code || "").toUpperCase();
      const exp = expectedCountry.toUpperCase();
      if (!seen) {
        out.error = `Nem sikerült kiolvasni az országot a whoer.net-ről (elvárt: ${exp}).`;
      } else if (seen !== exp) {
        out.error = `IP ország eltérés — elvárt: ${exp}, kapott: ${seen}${out.city ? " (" + out.city + ")" : ""}. Rossz proxy / szivárog a valódi IP.`;
      } else {
        out.ok = true;
      }
    } else {
      // Nincs elvárt ország — csak informatív, elfogadjuk.
      out.ok = true;
    }
  } catch (e) {
    out.error = `whoer.net preflight hiba: ${e.message}`;
  } finally {
    out.duration_ms = Date.now() - started;
    try {
      await page.close();
    } catch {}
  }
  return out;
}

async function main() {
  let spec, creds, proxyInfo;
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
  try {
    proxyInfo = process.env.PROXY_JSON
      ? JSON.parse(process.env.PROXY_JSON)
      : null;
  } catch (e) {
    return finish("failed", null, `PROXY_JSON parse hiba: ${e.message}`);
  }

  const monitorType = (spec.monitor_type || spec.platform || "").toLowerCase();
  log(
    "info",
    `Indítás — típus: ${monitorType || "n/a"}, fiók: ${spec.account_label || "n/a"}, cred: ${creds ? "✓" : "✗"}, proxy: ${proxyInfo?.label ?? "nincs"}`,
  );

  // Proxy — prioritás: run-hoz csatolt proxy (proxyInfo), majd credentials.proxy fallback.
  const proxyUrl = proxyInfo?.url || creds?.proxy || null;
  const expectedCountry = proxyInfo?.expectedCountry || null;

  const launchOpts = {
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  };
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      launchOpts.proxy = {
        server: `${u.protocol}//${u.host}`,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
      };
      log("info", `Proxy aktív: ${u.host}${expectedCountry ? ` (elvárt: ${expectedCountry})` : ""}`);
    } catch (e) {
      log("warn", `Proxy URL nem értelmezhető: ${e.message}`);
    }
  } else {
    log("warn", "NINCS proxy — direkt IP-vel megy. TikTok/FB esetén ez tiltást okozhat!");
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: spec.locale || "hu-HU",
  });

  // ---- 1. LÉPÉS: whoer.net preflight (mindig, még proxy nélkül is informatív). ----
  log("info", "Preflight indul: whoer.net IP-ellenőrzés…");
  const preflight = await whoerPreflight(context, expectedCountry);
  emitPreflight(preflight);
  if (!preflight.ok) {
    log("error", preflight.error || "Preflight sikertelen.");
    await browser.close().catch(() => {});
    return finish(
      "failed",
      null,
      preflight.error ||
        "Preflight sikertelen — a cél oldal biztonsági okból nem lett megnyitva.",
    );
  }
  log(
    "info",
    `Preflight OK — IP ${preflight.ip ?? "?"} · ${preflight.country_code ?? "?"} · ${preflight.city ?? ""}`,
  );

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
    } else if (monitorType === "bot-smoke-test" || monitorType === "smoke") {
      result = await runBotSmokeTest({ page, spec, log });
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
