// worker/executor/scripts/kylo-pricing.js
//
// „Csak árazás" audit: nem regisztrálunk, nem fizetünk, csak megnyitjuk az
// előfizetési csomagok oldalát a proxyn keresztül, és megnézzük:
//   - milyen NYELVEN jelenik meg az oldal,
//   - milyen PÉNZNEMBEN vannak az árak.
//
// Elvárás (a projekt szabálya):
//   HU → HUF · EU + CH + UK → EUR · minden más → USD
//
// Fontos: itt NEM adunk át ?lang= paramétert, mert pont azt akarjuk látni,
// amit egy valódi látogató lát az adott IP-ről. A nyelv és a pénznem együtt
// kerül a riportba, így az olyan eset is kiesik, amikor magyar szöveg mellett
// euró ár jelenik meg.

import { expectedCurrency, detectCurrencyFromText } from "./currency-rules.js";
import { langForCountry } from "./country-lang.js";

const DEFAULT_PATHS = ["/előfizetések", "/elofizetesek", "/pricing", "/subscriptions"];

async function shot(page, label) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
    return { label, at: new Date().toISOString(), b64: buf.toString("base64") };
  } catch (e) {
    return { label, at: new Date().toISOString(), error: e.message };
  }
}

async function acceptCookies(page) {
  const sels = [
    "#onetrust-accept-btn-handler",
    "button[id*='accept' i]",
    "button[class*='accept' i]",
    "[data-testid*='accept' i]",
  ];
  for (const sel of sels) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({ timeout: 1500 });
        await page.waitForTimeout(500);
        return true;
      }
    } catch {
      /* nincs banner */
    }
  }
  return false;
}

async function pageText(page) {
  const chunks = [];
  for (const f of page.frames()) {
    try {
      const t = await f.evaluate(() => document.body?.innerText || "");
      if (t) chunks.push(t);
    } catch {
      /* keresztdomain keret */
    }
  }
  return chunks.join("\n");
}

// Az oldal saját nyelvjelzése (html lang) + néhány egyszerű szövegjel.
async function detectPageLang(page) {
  let htmlLang = null;
  try {
    htmlLang = await page.evaluate(
      () => document.documentElement.getAttribute("lang") || null,
    );
  } catch {
    htmlLang = null;
  }
  return htmlLang ? String(htmlLang).trim() : null;
}

// Az árak környezetét gyűjtjük ki, hogy a riportban látszódjon a nyers szöveg.
function priceSamples(text) {
  const out = [];
  const re = /[^\n]*(?:\d[\d .,]*\s?(?:Ft|HUF|€|EUR|\$|USD|£|GBP|CHF)|(?:Ft|HUF|€|EUR|\$|USD|£|GBP|CHF)\s?\d)[^\n]*/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 12) {
    const line = m[0].trim();
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

export async function runKyloPricing({ page, spec, log }) {
  const cfg = spec.kylo_signup || {};
  const baseUrl = (cfg.base_url || "https://kylo.study").replace(/\/$/, "");
  const detectedCC = String(spec.detected_geo?.country_code || "").toUpperCase() || null;
  const labelCC = String(cfg.expected_country || "").toUpperCase() || null;
  const country = detectedCC || labelCC;

  const expCurrency = expectedCurrency(country);
  const expLang = langForCountry(country, "en-GB");

  const paths = cfg.pricing_paths?.length ? cfg.pricing_paths : DEFAULT_PATHS;
  const screenshots = [];
  const attempts = [];

  log(
    "info",
    `Pénznem-ellenőrzés — IP ország: ${country ?? "?"} · elvárt pénznem: ${expCurrency} · elvárt nyelv: ${expLang}`,
  );

  let usedUrl = null;
  let text = "";
  let detected = null;
  let candidates = [];

  for (const p of paths) {
    const url = `${baseUrl}${p}`;
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      const status = resp?.status() ?? 0;
      await acceptCookies(page);
      // Az árak gyakran kliensoldalon töltődnek — adunk rá néhány kört.
      for (let i = 0; i < 6; i += 1) {
        await page.waitForTimeout(1200);
        text = await pageText(page);
        const res = detectCurrencyFromText(text);
        detected = res.detected;
        candidates = res.candidates;
        if (detected || candidates.length > 0) break;
      }
      attempts.push({ url, status, found: !!(detected || candidates.length) });
      log(
        "info",
        `Megnyitva: ${url} (HTTP ${status}) — ${detected || candidates.join("/") || "még nincs ár"}`,
      );
      if (detected || candidates.length > 0) {
        usedUrl = url;
        break;
      }
    } catch (e) {
      attempts.push({ url, error: e.message });
      log("warn", `Nem sikerült megnyitni: ${url} — ${e.message}`);
    }
  }

  screenshots.push(await shot(page, "pricing"));

  const pageLang = await detectPageLang(page);
  const samples = priceSamples(text);

  const undetected = !detected && candidates.length === 0;
  const currencyOk = undetected
    ? null
    : detected
      ? detected === expCurrency
      : candidates.includes(expCurrency);

  // Nyelv: csak a fő nyelvkódot hasonlítjuk (hu vs hu-HU, en vs en-GB).
  const short = (v) => String(v || "").toLowerCase().split("-")[0];
  const langOk = pageLang ? short(pageLang) === short(expLang) : null;

  const issues = [];
  if (currencyOk === false) {
    issues.push(
      `Pénznem eltérés (${country}): elvárt ${expCurrency}, az oldalon ${detected || candidates.join("/")}.`,
    );
  }
  if (langOk === false) {
    issues.push(`Nyelvi eltérés (${country}): elvárt „${expLang}", az oldal „${pageLang}".`);
  }
  if (currencyOk === false && langOk === true) {
    issues.push(
      `Kombinált hiba: az oldal helyesen „${pageLang}" nyelvű, de az ár nem ${expCurrency}, hanem ${detected || candidates.join("/")}.`,
    );
  }
  if (undetected) {
    issues.push("Nem sikerült árat olvasni az előfizetési oldalról (nem termékhiba, ellenőrizd a képernyőfotót).");
  }

  const ok = currencyOk === true && langOk !== false;

  log(
    ok ? "info" : "warn",
    ok
      ? `RENDBEN — ${country}: ${detected} ár, „${pageLang}" nyelv.`
      : `ELTÉRÉS — ${issues.join(" ")}`,
  );

  return {
    mode: "pricing_only",
    ok,
    country,
    url: usedUrl,
    attempts,
    expected_currency: expCurrency,
    detected_currency: detected,
    currency_candidates: candidates,
    currency_ok: currencyOk,
    expected_lang: expLang,
    page_lang: pageLang,
    lang_ok: langOk,
    price_samples: samples,
    issues,
    screenshots,
    criteria: { pricing_currency_ok: currencyOk !== false, pricing_lang_ok: langOk !== false },
  };
}
