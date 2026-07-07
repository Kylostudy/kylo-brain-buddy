// worker/executor/scripts/brain-tasks/pinterest-metrics-snapshot.js
//
// Pinterest analytics snapshot — a bejelentkezett Business account "Top pins"
// listája: pin URL + impressions / saves / pin clicks / outbound clicks.
//
// Céloldal: https://www.pinterest.com/business/hub/analytics/
//   (átirányít az aktuális biz profil analytics overview-jára; itt egy
//    "Top Pins" táblázat mutatja az utóbbi 30 nap pin-jeit a fő metrikákkal)
//
// Ugyanaz a 3-rétegű öngyógyító logika, mint a LinkedIn snapshotnál:
//   1) DB-ből tanult szelektorok
//   2) beépített heurisztikus szelektorok
//   3) Gemini vision fallback + új szelektor visszaírás
//
// A humanize.js-ből humán scroll / wait / idle.

import { humanWait, humanCasualScroll, humanIdleDrift } from "../humanize.js";
import {
  lookupLearnedSelectors,
  upsertLearnedSelector,
  visionExtract,
} from "./brain-api.js";

const PAGE_TYPE = "analytics_overview";
const PLATFORM = "pinterest";

// Pinterest gyakran cseréli a class-okat is; data-test-id és aria-label
// stabilabb. A "top pins" táblázat sorai az overview oldal alján vannak.
const DEFAULT_SELECTORS = {
  pin_row:
    'div[data-test-id*="top-pins"] tr, div[data-test-id*="topPins"] tr, [data-test-id*="pin-analytics-row"], tbody tr',
  pin_url: 'a[href*="/pin/"]',
  impressions:
    '[data-test-id*="impression"], [aria-label*="impression"], td[data-column="IMPRESSION"]',
  saves:
    '[data-test-id*="save"], [aria-label*="save"], td[data-column="SAVE"]',
  pin_clicks:
    '[data-test-id*="pin-click"], [aria-label*="pin click"], td[data-column="PIN_CLICK"]',
  outbound_clicks:
    '[data-test-id*="outbound"], [aria-label*="outbound"], td[data-column="OUTBOUND_CLICK"]',
};

const FIELDS = ["impressions", "saves", "pin_clicks", "outbound_clicks"];

function parseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/^([0-9]+(?:[.,][0-9]+)?)([KkMm])?$/);
  if (m) {
    const num = parseFloat(m[1].replace(",", "."));
    const suf = (m[2] || "").toLowerCase();
    const mult = suf === "k" ? 1_000 : suf === "m" ? 1_000_000 : 1;
    return Math.round(num * mult);
  }
  const digits = s.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

async function tryDomExtract(page, selectors, log) {
  const missing = new Set();
  const pins = await page.evaluate(
    ({ sel, fields }) => {
      const rows = Array.from(document.querySelectorAll(sel.pin_row));
      const out = [];
      for (const row of rows) {
        const urlEl = row.querySelector(sel.pin_url);
        const pin = {
          pin_url: urlEl ? urlEl.getAttribute("href") : null,
          raw_text: row.innerText ? row.innerText.slice(0, 300) : null,
        };
        for (const f of fields) {
          const el = sel[f] ? row.querySelector(sel[f]) : null;
          pin[f] = el ? el.textContent.trim() : null;
        }
        out.push(pin);
      }
      return out;
    },
    { sel: selectors, fields: FIELDS },
  );

  const total = pins.length;
  if (total === 0) {
    for (const f of FIELDS) missing.add(f);
    return { pins: [], missing };
  }
  for (const f of FIELDS) {
    const gotAny = pins.some((p) => p[f] != null && p[f] !== "");
    if (!gotAny) missing.add(f);
  }
  log(
    "info",
    `DOM kiolvasás: ${total} pin, hiányzó mezők: ${missing.size ? [...missing].join(", ") : "nincs"}`,
  );
  return { pins, missing };
}

const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    pins: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pin_url: { type: ["string", "null"], description: "A pin URL-je, ha látszik" },
          impressions: { type: ["number", "null"], description: "Megjelenítések" },
          saves: { type: ["number", "null"], description: "Mentések" },
          pin_clicks: { type: ["number", "null"], description: "Pin kattintások" },
          outbound_clicks: { type: ["number", "null"], description: "Kimenő kattintások" },
        },
        required: ["impressions", "saves", "pin_clicks", "outbound_clicks"],
      },
    },
  },
  required: ["pins"],
};

async function runPinterestMetricsSnapshot({ page, spec, creds, log }) {
  const pinLimit = Math.max(1, Math.min(50, Number(spec.pin_limit) || 15));

  if (!creds || !creds.cookies)
    throw new Error(
      "Pinterest cookie-k hiányoznak a credential-ből (JSON export a Dolphin Anty / EditThisCookie-ból)",
    );

  const url = "https://www.pinterest.com/business/hub/analytics/";
  log("info", `Navigáció: ${url} (utolsó ${pinLimit} pin)`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await humanWait(page, 2500);

  if (/\/login|\/signup/.test(page.url())) {
    throw new Error(
      `Pinterest átirányított bejelentkezésre (${page.url()}). A cookie-k lejártak vagy nem érvényesek.`,
    );
  }
  if (/\/business\/create/.test(page.url()) || /\/business\/convert/.test(page.url())) {
    throw new Error(
      "A fiók még nem Business account — analytics nem elérhető. Váltsd Business-re a Pinteresten.",
    );
  }

  // Görgetés amíg legalább `pinLimit` sor nem látszik (max 8 kör)
  let rows = 0;
  for (let i = 0; i < 8; i++) {
    rows = await page.evaluate(
      (sel) => document.querySelectorAll(sel).length,
      DEFAULT_SELECTORS.pin_row,
    );
    log("info", `Pin sorok betöltve: ${rows}`);
    if (rows >= pinLimit) break;
    await humanCasualScroll(page, { rounds: 2 });
    await humanIdleDrift(page);
    await humanWait(page, 1500);
  }

  // 1. Tanult szelektorok
  let learned = {};
  try {
    learned = await lookupLearnedSelectors(PLATFORM, PAGE_TYPE);
    log(
      "info",
      `Tanult szelektorok: ${Object.keys(learned).length ? Object.keys(learned).join(", ") : "nincs"}`,
    );
  } catch (e) {
    log("warn", `Tanult szelektorok betöltése sikertelen: ${e.message}`);
  }

  const selectors = { ...DEFAULT_SELECTORS };
  for (const [field, row] of Object.entries(learned)) {
    if (row?.selector) selectors[field] = row.selector;
  }

  // 2. Első DOM próba
  let { pins, missing } = await tryDomExtract(page, selectors, log);

  // Fallback default-tal ott, ahol a tanult nem talált
  if (missing.size > 0) {
    const fallbackSelectors = { ...selectors };
    for (const f of missing) fallbackSelectors[f] = DEFAULT_SELECTORS[f];
    log("info", "Tanult szelektor(ok) nem hoztak eredményt — próbálom a default heurisztikát");
    const retry = await tryDomExtract(page, fallbackSelectors, log);
    for (const f of FIELDS) {
      if (!missing.has(f)) continue;
      const gotNow = retry.pins.some((p) => p[f] != null && p[f] !== "");
      if (gotNow) {
        for (let i = 0; i < pins.length && i < retry.pins.length; i++) {
          pins[i][f] = retry.pins[i][f];
        }
        missing.delete(f);
        try {
          if (learned[f]?.selector) {
            await upsertLearnedSelector({
              platform: PLATFORM,
              pageType: PAGE_TYPE,
              field: f,
              selector: learned[f].selector,
              learnedFrom: learned[f].learned_from,
              success: false,
              notes: "tanult szelektor nem talált, default segített",
            });
          }
        } catch (e) {
          log("warn", `Selector fail-mentés hiba: ${e.message}`);
        }
      }
    }
  }

  // 3. Gemini fallback
  let geminiCallsUsed = 0;
  if (missing.size > 0) {
    log("warn", `Gemini fallback aktiválódik: ${[...missing].join(", ")}`);
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 70, fullPage: true });
      const b64 = buf.toString("base64");
      const missingList = [...missing].join(", ");
      const prompt = `Ez egy Pinterest Business analytics overview screenshot. Olvasd ki a "Top Pins" táblázat első ${pinLimit} sorát fentről lefelé.
Minden pin-re add vissza: impressions (megjelenítések), saves (mentések), pin_clicks (pin kattintások), outbound_clicks (kimenő kattintások).
Ha egy szám 1.2K vagy 3M formátumú, alakítsd át egész számmá (1200, 3000000).
Ha egy mezőt nem látsz, tegyél null-t. Különös figyelmet ide: ${missingList}.
A sorrend fentről lefelé haladjon.`;
      const geminiResp = await visionExtract({
        screenshotB64: b64,
        prompt,
        schema: GEMINI_SCHEMA,
      });
      geminiCallsUsed = 1;
      const geminiPins = geminiResp?.data?.pins;
      if (Array.isArray(geminiPins)) {
        log("info", `Gemini ${geminiPins.length} pinre adott adatot`);
        for (let i = 0; i < pins.length && i < geminiPins.length; i++) {
          for (const f of missing) {
            const v = geminiPins[i]?.[f];
            if (v != null) pins[i][f] = String(v);
          }
        }
        for (const f of missing) {
          try {
            await upsertLearnedSelector({
              platform: PLATFORM,
              pageType: PAGE_TYPE,
              field: f,
              selector: DEFAULT_SELECTORS[f],
              learnedFrom: "gemini_vision",
              success: false,
              notes: "gemini vision használva — új szelektor javaslat még TODO",
            });
          } catch {}
        }
      } else {
        log("warn", "Gemini nem strukturált választ adott, kihagyjuk");
      }
    } catch (e) {
      log("error", `Gemini fallback hiba: ${e.message}`);
    }
  }

  // 4. Sikeres tanult szelektorok jutalmazása
  for (const f of FIELDS) {
    if (missing.has(f)) continue;
    if (!learned[f]?.selector) continue;
    try {
      await upsertLearnedSelector({
        platform: PLATFORM,
        pageType: PAGE_TYPE,
        field: f,
        selector: learned[f].selector,
        learnedFrom: learned[f].learned_from || "dom_heuristic",
        success: true,
      });
    } catch (e) {
      log("warn", `Selector success-mentés hiba: ${e.message}`);
    }
  }

  // 5. Végleges strukturálás
  const trimmed = pins.slice(0, pinLimit).map((p) => ({
    pin_url: p.pin_url
      ? p.pin_url.startsWith("http")
        ? p.pin_url
        : `https://www.pinterest.com${p.pin_url}`
      : null,
    impressions: parseNumber(p.impressions),
    saves: parseNumber(p.saves),
    pin_clicks: parseNumber(p.pin_clicks),
    outbound_clicks: parseNumber(p.outbound_clicks),
  }));

  return {
    platform: PLATFORM,
    page_type: PAGE_TYPE,
    scraped_at: new Date().toISOString(),
    pin_count: trimmed.length,
    pins: trimmed,
    gemini_calls_used: geminiCallsUsed,
    fields_from_gemini: [...missing],
  };
}

export { runPinterestMetricsSnapshot };
