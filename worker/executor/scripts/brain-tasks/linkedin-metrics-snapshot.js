// worker/executor/scripts/brain-tasks/linkedin-metrics-snapshot.js
//
// LinkedIn Company Page metrikák snapshot — utolsó N poszt impressions / like /
// komment / megosztás értékei az admin analytics oldaláról.
//
// Céloldal:  https://www.linkedin.com/company/<slug>/admin/analytics/updates/
//
// Kiolvasás rétegek (öngyógyító szelektorok):
//   1) Ha van a DB-ben tanult szelektor → azzal próbáljuk elsőként
//   2) Ha nincs vagy nem talál → beépített heurisztikus szelektorok
//   3) Ha az sem működik → screenshot + Gemini vision, majd az új szelektor
//      elmentése a DB-be, hogy legközelebb már DOM-ból menjen
//
// A humanize.js-ből használjuk a human-scroll/wait/idle funkciókat, hogy ne
// robotszerű legyen a viselkedés.

import { humanWait, humanCasualScroll, humanIdleDrift } from "../humanize.js";
import {
  lookupLearnedSelectors,
  upsertLearnedSelector,
  visionExtract,
} from "./brain-api.js";

const PAGE_TYPE = "analytics_updates";
const PLATFORM = "linkedin";

// Beépített heurisztikus szelektorok — ezek a "biztonsági háló" ha nincs
// tanult, vagy ha a tanult nem működik. LinkedIn gyakran változtatja a
// class-okat, de az aria-label és data-test-* attribútumok stabilabbak.
const DEFAULT_SELECTORS = {
  post_card: 'li[data-test-id*="analytics-update"], div[data-test-id*="update-analytics-card"], article',
  post_url: 'a[href*="/feed/update/"]',
  impressions: '[data-test-id*="impression"] strong, [aria-label*="impression"], [data-test-id*="views"] strong',
  reactions: '[data-test-id*="reaction"] strong, [aria-label*="reaction"]',
  comments: '[data-test-id*="comment"] strong, [aria-label*="comment"]',
  reposts: '[data-test-id*="repost"] strong, [data-test-id*="share"] strong, [aria-label*="repost"]',
};

const FIELDS = ["impressions", "reactions", "comments", "reposts"];

function parseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, "");
  if (!s) return null;
  // "1.2K", "3,4E", "1 234", "12M" — mérnöki jelölés kezelése
  const m = s.match(/^([0-9]+(?:[.,][0-9]+)?)([KkEeMm])?$/);
  if (m) {
    const num = parseFloat(m[1].replace(",", "."));
    const suf = (m[2] || "").toLowerCase();
    const mult = suf === "k" || suf === "e" ? 1_000 : suf === "m" ? 1_000_000 : 1;
    return Math.round(num * mult);
  }
  // Egyszerű szám elválasztókkal
  const digits = s.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

async function tryDomExtract(page, selectors, log) {
  // Visszaadja: { posts: [...], missingFields: Set }
  const missing = new Set();
  const posts = await page.evaluate(
    ({ sel, fields }) => {
      const cards = Array.from(document.querySelectorAll(sel.post_card));
      const out = [];
      for (const card of cards) {
        const urlEl = card.querySelector(sel.post_url);
        const post = {
          post_url: urlEl ? urlEl.getAttribute("href") : null,
          raw_text: card.innerText ? card.innerText.slice(0, 300) : null,
        };
        for (const f of fields) {
          const el = sel[f] ? card.querySelector(sel[f]) : null;
          post[f] = el ? el.textContent.trim() : null;
        }
        out.push(post);
      }
      return out;
    },
    { sel: selectors, fields: FIELDS },
  );

  // Ha egy poszton semelyik mező nem jött ki, azt gyanús — de csak akkor
  // számoljuk hiányzónak, ha az ÖSSZES poszton hiányzik.
  const total = posts.length;
  if (total === 0) {
    for (const f of FIELDS) missing.add(f);
    return { posts: [], missing };
  }

  for (const f of FIELDS) {
    const gotAny = posts.some((p) => p[f] != null && p[f] !== "");
    if (!gotAny) missing.add(f);
  }
  log(
    "info",
    `DOM kiolvasás: ${total} poszt, hiányzó mezők: ${missing.size ? [...missing].join(", ") : "nincs"}`,
  );
  return { posts, missing };
}

const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          post_url: { type: ["string", "null"], description: "A poszt URL-je, ha látszik" },
          impressions: { type: ["number", "null"], description: "Megtekintések száma" },
          reactions: { type: ["number", "null"], description: "Reakciók / like-ok száma" },
          comments: { type: ["number", "null"], description: "Kommentek száma" },
          reposts: { type: ["number", "null"], description: "Megosztások / repost-ok száma" },
        },
        required: ["impressions", "reactions", "comments", "reposts"],
      },
    },
  },
  required: ["posts"],
};

async function runLinkedInMetricsSnapshot({ page, context, spec, creds, log }) {
  const slug = spec.linkedin_company_slug;
  const postLimit = Math.max(1, Math.min(50, Number(spec.post_limit) || 15));

  if (!slug) throw new Error("spec.linkedin_company_slug hiányzik");
  if (!creds || !creds.cookies)
    throw new Error(
      "LinkedIn cookie-k hiányoznak a credential-ből (JSON export a Dolphin/EditThisCookie-ból)",
    );

  const url = `https://www.linkedin.com/company/${encodeURIComponent(slug)}/admin/analytics/updates/`;
  log("info", `Navigáció: ${url} (utolsó ${postLimit} poszt)`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await humanWait(page, 2500);

  // Ha átirányított sign-in-re → nincs érvényes session
  if (/\/login|\/checkpoint|\/uas\//.test(page.url())) {
    throw new Error(
      `LinkedIn átirányított bejelentkezésre (${page.url()}). A cookie-k lejártak vagy nem érvényesek.`,
    );
  }

  // Görgetés amíg legalább `postLimit` kártya nem látszik (max 8 kör)
  let cards = 0;
  for (let i = 0; i < 8; i++) {
    cards = await page.evaluate(
      (sel) => document.querySelectorAll(sel).length,
      DEFAULT_SELECTORS.post_card,
    );
    log("info", `Kártyák betöltve: ${cards}`);
    if (cards >= postLimit) break;
    await humanCasualScroll(page, { rounds: 2 });
    await humanIdleDrift(page);
    await humanWait(page, 1500);
  }

  // 1. Tanult szelektorok betöltése
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

  // Összeépítjük a próbálandó szelektorokat: tanult > default
  const selectors = { ...DEFAULT_SELECTORS };
  for (const [field, row] of Object.entries(learned)) {
    if (row?.selector) selectors[field] = row.selector;
  }

  // 2. Első DOM próba
  let { posts, missing } = await tryDomExtract(page, selectors, log);

  // Ha van hiányzó mező, próbáljuk a default szelektorokat (ha eltértek a tanulttól)
  if (missing.size > 0) {
    const fallbackSelectors = { ...selectors };
    for (const f of missing) fallbackSelectors[f] = DEFAULT_SELECTORS[f];
    log("info", "Tanult szelektor(ok) nem hoztak eredményt — próbálom a default heurisztikát");
    const retry = await tryDomExtract(page, fallbackSelectors, log);
    // A retry sikeres mezőit írjuk felül a posts-ban
    for (const f of FIELDS) {
      if (!missing.has(f)) continue;
      const gotNow = retry.posts.some((p) => p[f] != null && p[f] !== "");
      if (gotNow) {
        for (let i = 0; i < posts.length && i < retry.posts.length; i++) {
          posts[i][f] = retry.posts[i][f];
        }
        missing.delete(f);
        // A tanultat "büntetjük", a default szelektort "jutalmazzuk" mint dom_heuristic
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

  // 3. Gemini fallback a még mindig hiányzó mezőkre
  let geminiCallsUsed = 0;
  if (missing.size > 0) {
    log("warn", `Gemini fallback aktiválódik: ${[...missing].join(", ")}`);
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 70, fullPage: true });
      const b64 = buf.toString("base64");
      const missingList = [...missing].join(", ");
      const prompt = `Ez egy LinkedIn Company Page analytics screenshot. Olvasd ki az első ${postLimit} poszt metrikáit fentről lefelé haladva.
Minden posztra add vissza: impressions (megtekintések), reactions (like/reakciók), comments (kommentek), reposts (megosztások).
Ha egy szám 1.2K vagy 3M formátumú, alakítsd át egész számmá (1200, 3000000).
Ha egy mezőt nem látsz, tegyél null-t. Különös figyelmet a következőre: ${missingList}.
A poszt sorrend fentről lefelé haladjon.`;
      const geminiResp = await visionExtract({
        screenshotB64: b64,
        prompt,
        schema: GEMINI_SCHEMA,
      });
      geminiCallsUsed = 1;
      const geminiPosts = geminiResp?.data?.posts;
      if (Array.isArray(geminiPosts)) {
        log("info", `Gemini ${geminiPosts.length} posztra adott adatot`);
        for (let i = 0; i < posts.length && i < geminiPosts.length; i++) {
          for (const f of missing) {
            const v = geminiPosts[i]?.[f];
            if (v != null) posts[i][f] = String(v);
          }
        }
        // A hiányzó mezőknél nem tudunk pontos új szelektort visszatanulni a
        // sima chat-vision hívásból — csak azt jelezzük a DB felé, hogy a
        // Gemini kellett. Egy külön "selector proposal" prompt majd később
        // (amikor a poszt-kártya HTML-fragmentet is odaadjuk a modellnek).
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

  // 4. Sikeres tanult szelektorok "jutalmazása"
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

  // 5. Végleges strukturálás: számokká konvertáljuk
  const trimmed = posts.slice(0, postLimit).map((p) => ({
    post_url: p.post_url
      ? p.post_url.startsWith("http")
        ? p.post_url
        : `https://www.linkedin.com${p.post_url}`
      : null,
    impressions: parseNumber(p.impressions),
    reactions: parseNumber(p.reactions),
    comments: parseNumber(p.comments),
    reposts: parseNumber(p.reposts),
  }));

  return {
    platform: PLATFORM,
    page_type: PAGE_TYPE,
    scraped_at: new Date().toISOString(),
    post_count: trimmed.length,
    posts: trimmed,
    gemini_calls_used: geminiCallsUsed,
    fields_from_gemini: [...missing],
  };
}

export { runLinkedInMetricsSnapshot };
