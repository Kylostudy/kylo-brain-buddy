// worker/executor/scripts/currency-rules.js
//
// Elvárt fizetési pénznem a geolokáció (számlázási ország) alapján:
//  - Magyarország: HUF (forint)
//  - EU többi tagállama + Svájc + Egyesült Királyság: EUR
//  - minden más ország: USD

const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI",
  "ES", "SE",
];

const EUR_COUNTRIES = new Set([...EU_COUNTRIES, "CH", "GB"]);

export function expectedCurrency(country) {
  const cc = String(country || "").toUpperCase();
  if (cc === "HU") return "HUF";
  if (EUR_COUNTRIES.has(cc)) return "EUR";
  return "USD";
}

// Pénznem felismerése a Stripe / fizetési oldal szövegéből.
export function detectCurrencyFromText(text) {
  const t = String(text || "");
  const hits = new Set();
  const codes = new Set();
  if (/\bHUF\b/i.test(t) || /\d\s?Ft\b/.test(t) || /forint/i.test(t)) { hits.add("HUF"); if (/\bHUF\b/i.test(t)) codes.add("HUF"); }
  if (/\bEUR\b/i.test(t) || /€/.test(t) || /euró|euro\b/i.test(t)) { hits.add("EUR"); if (/\bEUR\b/i.test(t)) codes.add("EUR"); }
  if (/\bUSD\b/i.test(t) || /US\$/.test(t) || /(^|[\s(])\$\s?\d/m.test(t)) { hits.add("USD"); if (/\bUSD\b/i.test(t) || /US\$/.test(t)) codes.add("USD"); }
  if (/\bGBP\b/i.test(t) || /£/.test(t)) { hits.add("GBP"); if (/\bGBP\b/i.test(t)) codes.add("GBP"); }
  if (/\bCHF\b/i.test(t)) { hits.add("CHF"); codes.add("CHF"); }
  if (/\bAUD\b/i.test(t) || /A\$\s?\d/.test(t)) { hits.add("AUD"); if (/\bAUD\b/i.test(t)) codes.add("AUD"); }
  if (/\bNZD\b/i.test(t) || /NZ\$\s?\d/.test(t)) { hits.add("NZD"); if (/\bNZD\b/i.test(t)) codes.add("NZD"); }
  if (/\bCAD\b/i.test(t) || /CA\$\s?\d/.test(t) || /C\$\s?\d/.test(t)) { hits.add("CAD"); if (/\bCAD\b/i.test(t)) codes.add("CAD"); }
  const list = Array.from(hits);
  // Ha több jelölt is van, a kiírt pénznem-KÓD (pl. "USD") erősebb jel,
  // mint a puszta szimbólum ("$"), ezért azt fogadjuk el.
  const codeList = Array.from(codes);
  const detected =
    list.length === 1 ? list[0] : codeList.length === 1 ? codeList[0] : null;
  return { detected, candidates: list };
}

// A Stripe összeg gyakran beágyazott iframe-ben (Payment Element / Checkout)
// jelenik meg, ezért minden keretből össze kell szedni a szöveget, és néhányszor
// újra kell próbálni, amíg az ár betöltődik.
async function collectAllFramesText(page) {
  const chunks = [];
  let frames = [];
  try {
    frames = page.frames();
  } catch {
    frames = [];
  }
  for (const f of frames) {
    try {
      const t = await f.evaluate(() => document.body?.innerText || "");
      if (t) chunks.push(t);
    } catch {
      /* keresztdomain / bezárt keret — kihagyjuk */
    }
  }
  if (chunks.length === 0) {
    try {
      chunks.push(await page.evaluate(() => document.body?.innerText || ""));
    } catch {
      /* nincs mit olvasni */
    }
  }
  return chunks.join("\n");
}

export async function checkStripeCurrency(page, country, log) {
  const expected = expectedCurrency(country);
  let detected = null;
  let candidates = [];
  let text = "";

  // Max ~12 másodperc türelem az ár megjelenésére.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    text = await collectAllFramesText(page);
    const res = detectCurrencyFromText(text);
    detected = res.detected;
    candidates = res.candidates;
    if (detected || candidates.length > 0) break;
    await page.waitForTimeout(1500);
  }

  const undetected = !detected && candidates.length === 0;
  // Ha egyáltalán nem sikerült pénznemet olvasni, azt NEM tekintjük hibának:
  // ok = null (ismeretlen), csak figyelmeztetünk.
  const ok = undetected ? null : detected ? detected === expected : candidates.includes(expected);

  const result = {
    expected_currency: expected,
    detected_currency: detected,
    currency_candidates: candidates,
    ok,
    undetected,
  };
  if (typeof log === "function") {
    log(
      ok === false ? "warn" : "info",
      `Pénznem ellenőrzés (${country}): elvárt=${expected} · észlelt=${detected || candidates.join("/") || "nem felismerhető"} → ${ok === true ? "OK" : ok === false ? "ELTÉRÉS" : "NEM OLVASHATÓ (nem hiba)"}`,
    );
  }
  return result;
}
