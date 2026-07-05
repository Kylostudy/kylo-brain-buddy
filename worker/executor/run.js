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

// playwright-extra + stealth plugin — elrejti a webdriver flag-et, javítja a
// navigator.plugins / languages / WebGL / Canvas / window.chrome / Permissions
// fingerprinteket. A cél: bot.sannysoft.com zöld, CreepJS trust >= 60.
// A `chromium` API-ja teljesen azonos a sima playwright-tel, csak plugin-eket
// tud fogadni a .use() metódussal.
import { chromium as _chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
_chromium.use(StealthPlugin());
const chromium = _chromium;
import { runTikTok } from "./scripts/tiktok.js";
import { runDecathlonStock } from "./scripts/decathlon-stock.js";
import { runBotSmokeTest } from "./scripts/bot-smoke-test.js";
import { humanWait, humanCasualScroll, humanIdleDrift } from "./scripts/humanize.js";
import {
  isBrainTask,
  needsBrowser,
  runBrainTask,
} from "./scripts/brain-tasks/index.js";

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
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      final: true,
      status,
      result,
      error,
    }) + "\n";
  // FONTOS: process.stdout.write ASYNC egy pipe-on. Nagy base64 payloadnál
  // (bot-smoke-test screenshotok) a puffer nem ürül ki, mielőtt process.exit()
  // megölné a folyamatot — így a final rekord elveszne. Megvárjuk a flush-t.
  const code = status === "succeeded" ? 0 : 1;
  const doExit = () => process.exit(code);
  const ok = process.stdout.write(line, () => doExit());
  if (!ok) {
    // A stream tele van; várunk a drain-re, aztán a callback amúgy is lefut.
    process.stdout.once("drain", doExit);
  }
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

  // ---- Brain task rövid ág: ping ----
  // A ping böngészőt sem nyit — még a proxy/preflight előtt visszatérünk.
  // A böngészős brain_task-ok (metrics_snapshot stb.) a normál futás során,
  // a proxy + preflight + cookie injektálás UTÁN dispatch-elődnek — lásd
  // lentebb a "monitor típus dispatch" blokkban.
  if (isBrainTask(spec)) {
    const bt = spec.brain_task;
    log(
      "info",
      `Brain task ág aktív — task_type=${bt.task_type}, kylogic_task_id=${bt.kylogic_task_id ?? "n/a"}`,
    );
    if (!needsBrowser(bt)) {
      try {
        const result = await runBrainTask({ brainTask: bt, log });
        return finish("succeeded", result);
      } catch (e) {
        log("error", `brain_task hiba: ${e.message}`);
        return finish("failed", null, e.message);
      }
    }
    // Böngészős brain_task → tovább a normál flow-ra, a main dispatch fogja futtatni.
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

  // Per-workflow fingerprint: a claim endpoint determinisztikusan generálja
  // (workflow id + proxy ország alapján). Ha valamiért nem jött, biztonságos
  // fallback értékek.
  const fp = spec.fingerprint || {};
  const contextOpts = {
    userAgent:
      fp.userAgent ||
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    viewport:
      fp.viewport && fp.viewport.width && fp.viewport.height
        ? { width: fp.viewport.width, height: fp.viewport.height }
        : { width: 1280, height: 800 },
    locale: fp.locale || spec.locale || "hu-HU",
  };
  if (fp.timezoneId) contextOpts.timezoneId = fp.timezoneId;
  if (fp.deviceScaleFactor) contextOpts.deviceScaleFactor = fp.deviceScaleFactor;
  const context = await browser.newContext(contextOpts);
  log(
    "info",
    `Fingerprint: ${fp.platform || "?"} · Chrome ${fp.chromeMajor || "?"} · ${contextOpts.viewport.width}x${contextOpts.viewport.height} · ${contextOpts.locale} · ${fp.timezoneId || "default TZ"}`,
  );


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

  // ---- 2. LÉPÉS: Fingerprint audit (első run + heti) ---------------------
  // A claim endpoint dönt róla és a spec.run_fingerprint_audit flag-en át
  // kéri. Nem állítja meg a futást, csak beteszi az eredményt a result-ba,
  // hogy a UI-ban látható legyen (piros zászlók, trust score, screenshotok).
  let fingerprintAudit = null;
  if (spec.run_fingerprint_audit) {
    log("info", "Fingerprint audit indul (sannysoft + CreepJS)…");
    const auditPage = await context.newPage();
    try {
      fingerprintAudit = await runBotSmokeTest({
        page: auditPage,
        spec: { ...spec, targets: ["sannysoft", "creepjs"] },
        log,
      });
      fingerprintAudit.ran_at = new Date().toISOString();
      log(
        "info",
        `Fingerprint audit kész — ${fingerprintAudit.all_ok ? "ZÖLD ✅" : "PIROS ❌"}`,
      );
    } catch (e) {
      log("warn", `Fingerprint audit hiba (folytatjuk): ${e.message}`);
      fingerprintAudit = { error: e.message, ran_at: new Date().toISOString() };
    } finally {
      try {
        await auditPage.close();
      } catch {}
    }
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
        log("info", `Cookie-k injektálva: ${norm.length} db.`);
      }
    } catch (e) {
      log("warn", `Cookie parse hiba: ${e.message}`);
    }
  }

  const page = context.pages()[0] || (await context.newPage());

  try {
    let result;
    // Böngészős brain_task ág (metrics_snapshot stb.) — a page/context/creds
    // rendelkezésre áll, mert végigment a proxy + preflight + cookie lépéseken.
    if (isBrainTask(spec) && needsBrowser(spec.brain_task)) {
      result = await runBrainTask({
        brainTask: spec.brain_task,
        page,
        context,
        spec,
        creds,
        log,
      });
    } else if (monitorType === "tiktok") {
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

    if (fingerprintAudit) {
      result = { ...(result || {}), fingerprint_audit: fingerprintAudit };
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
