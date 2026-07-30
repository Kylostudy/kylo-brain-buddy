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
  if (/\bHUF\b/i.test(t) || /\bFt\b/.test(t) || /forint/i.test(t)) hits.add("HUF");
  if (/\bEUR\b/i.test(t) || /€/.test(t) || /euró|euro\b/i.test(t)) hits.add("EUR");
  if (/\bUSD\b/i.test(t) || /US\$/.test(t) || /(^|[\s(])\$\s?\d/.test(t)) hits.add("USD");
  if (/\bGBP\b/i.test(t) || /£/.test(t)) hits.add("GBP");
  if (/\bCHF\b/i.test(t)) hits.add("CHF");
  const list = Array.from(hits);
  // Ha több is szerepel, a "legerősebb" jelet (kód > szimbólum) nem tudjuk
  // biztosan eldönteni, ezért mindet visszaadjuk.
  return { detected: list.length === 1 ? list[0] : null, candidates: list };
}

export async function checkStripeCurrency(page, country, log) {
  const expected = expectedCurrency(country);
  let text = "";
  try {
    text = await page.evaluate(() => document.body?.innerText || "");
  } catch {
    text = "";
  }
  // Az összeg gyakran a Stripe összegzés blokkjában van, de az innerText elég.
  const { detected, candidates } = detectCurrencyFromText(text);
  const ok = detected ? detected === expected : candidates.includes(expected);
  const result = {
    expected_currency: expected,
    detected_currency: detected,
    currency_candidates: candidates,
    ok: !!ok,
    undetected: !detected && candidates.length === 0,
  };
  if (typeof log === "function") {
    log(
      ok ? "info" : "warn",
      `Pénznem ellenőrzés (${country}): elvárt=${expected} · észlelt=${detected || candidates.join("/") || "nem felismerhető"} → ${ok ? "OK" : "ELTÉRÉS"}`,
    );
  }
  return result;
}
