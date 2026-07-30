// worker/executor/scripts/country-lang.js
//
// Ország (proxy valódi kimeneti IP-je) → elvárt oldalnyelv és pénznem.
//
// Fontos: az elvárást MINDIG a preflightban ténylegesen mért IP-ország adja,
// nem a proxy címkéje. Így ha egy „francia" proxy valójában más országból jön
// ki, akkor is a valós ország nyelvét várjuk el az oldaltól — pont ezt kell
// ellenőrizni: lefordítja-e a Kylo az oldalt a látogató országa szerint.

export const COUNTRY_TO_LANG = {
  US: "en-US", GB: "en-GB", CA: "en-CA", AU: "en-AU", NZ: "en-NZ", IE: "en-IE",
  HU: "hu", DE: "de", AT: "de", CH: "de", FR: "fr", BE: "nl", NL: "nl",
  IT: "it", ES: "es", PT: "pt-PT", PL: "pl", SE: "sv", FI: "fi", NO: "no",
  DK: "da", CZ: "cs", SK: "sk", RO: "ro", BG: "bg", HR: "hr", SI: "sl",
  LT: "lt", LV: "lv", EE: "et", GR: "el", TR: "tr", UA: "uk", RU: "ru",
  JP: "ja", KR: "ko", CN: "zh-CN", TW: "zh-TW", HK: "zh-TW",
  IN: "en-GB", ID: "id", TH: "th", VN: "vi",
  BR: "pt-BR", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es",
  ZA: "en-GB", SG: "en-GB", PH: "en-GB", MY: "en-GB", NG: "en-GB", KE: "en-GB",
  AE: "ar", SA: "ar", EG: "ar", IL: "he",
};

const EUR = new Set([
  "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LT", "LU", "LV", "MT", "NL",
  "NO", "PL", "PT", "RO", "SE", "SI", "SK", "TR",
]);

/** Ország → elvárt oldalnyelv. Ismeretlen ország esetén a fallback jön vissza. */
export function langForCountry(cc, fallback = "en-GB") {
  const c = String(cc || "").toUpperCase();
  if (!c) return fallback;
  return COUNTRY_TO_LANG[c] || fallback;
}

/** Ország → elvárt pénznem (a Kylo Stripe csak EUR / USD / CNY / RUB-ot fogad). */
export function currencyForCountry(cc, fallback = "USD") {
  const c = String(cc || "").toUpperCase();
  if (!c) return fallback;
  if (EUR.has(c)) return "EUR";
  if (c === "CN") return "CNY";
  if (c === "RU") return "RUB";
  return "USD";
}
