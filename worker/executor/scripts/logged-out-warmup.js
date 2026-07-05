// worker/executor/scripts/logged-out-warmup.js
//
// Kijelentkezett warmup — holland civil böngészés.
// A cél: sütitárat gyűjteni és a proxy+fingerprint kombót "megjáratni"
// mielőtt először bejelentkeznénk a célplatformra. A célplatform host-ja
// (linkedin.com, instagram.com, tiktok.com, pinterest.com stb.) EXPLICIT
// feketelistán van — soha nem lép rá, még ha egy hírportál oda linkelne is.
//
// A szkript **nem** dől el egyetlen oldal hibáján — try/catch mindenütt,
// és ha egy site nem jön be, csak lépünk a következőre. A várható időt
// (duration_min) végigfuttatja.
//
// Spec mezők (mind opcionális):
//   duration_min       : hány percig fusson (alap: 45)
//   sites              : portál lista (alap alább)
//   search_queries     : NL kereső kifejezések (alap alább)
//   target_platform    : csak címke a logban (linkedin | instagram | tiktok | pinterest)
//   blacklist_hosts    : extra tiltott host-ok, hozzáadódnak az alaphoz
//   min_dwell_sec, max_dwell_sec : oldalanként dwell (alap 20/90)
//
// Return:
//   {
//     duration_sec, pages_visited, cookies_collected, domains,
//     blacklist_blocks, target_platform,
//     cookies_export  // <-- ezt a brain oldal titkosítva menti workflow_credentials.cookie_ciphertext-be
//   }

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanIdleDrift,
  humanThink,
  humanType,
  humanWait,
  reseedHuman,
} from "./humanize.js";

import enLocale from "./warmup-locales/en.js";
import huLocale from "./warmup-locales/hu.js";
import deLocale from "./warmup-locales/de.js";
import esLocale from "./warmup-locales/es.js";
import svLocale from "./warmup-locales/sv.js";
import plLocale from "./warmup-locales/pl.js";
import ptBRLocale from "./warmup-locales/pt-BR.js";

const LOCALES = {
  en: enLocale,
  hu: huLocale,
  de: deLocale,
  es: esLocale,
  sv: svLocale,
  pl: plLocale,
  "pt-BR": ptBRLocale,
  "pt-br": ptBRLocale,
  pt: ptBRLocale,
};

// Fallback (angol) — ha valamiért nem érkezik spec.language.
const DEFAULT_LOCALE = enLocale;

// Ide SEMMILYEN körülmények között nem megyünk warmup közben.
const HARD_BLACKLIST = [
  "linkedin.com",
  "instagram.com",
  "tiktok.com",
  "pinterest.com",
  "pinterest.nl",
  "facebook.com",
  "fb.com",
  "x.com",
  "twitter.com",
  "threads.net",
];

function resolveLocale(language) {
  if (!language) return DEFAULT_LOCALE;
  const key = String(language).trim();
  return LOCALES[key] || LOCALES[key.toLowerCase()] || DEFAULT_LOCALE;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isBlacklisted(url, extra = []) {
  const h = hostOf(url);
  if (!h) return true;
  const list = [...HARD_BLACKLIST, ...extra.map((s) => String(s).toLowerCase())];
  return list.some((b) => h === b || h.endsWith("." + b));
}

async function tryCloseCookieBanner(page, cookieAcceptTexts, log) {
  try {
    for (const rx of cookieAcceptTexts) {
      const btn = page.getByRole("button", { name: rx }).first();
      if (await btn.count().catch(() => 0)) {
        await humanClick(page, btn, { timeout: 3000 }).catch(() => {});
        await humanWait(page, 600);
        return true;
      }
    }
    // Google consent iframe
    const frames = page.frames();
    for (const f of frames) {
      if (!/consent/i.test(f.url())) continue;
      for (const rx of cookieAcceptTexts) {
        const b = f.getByRole("button", { name: rx }).first();
        if (await b.count().catch(() => 0)) {
          await b.click({ timeout: 3000 }).catch(() => {});
          await humanWait(page, 700);
          return true;
        }
      }
    }
  } catch (e) {
    log("warn", `Cookie banner heurisztika hiba (folytatjuk): ${e.message}`);
  }
  return false;
}

async function safeGoto(page, url, log) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    return true;
  } catch (e) {
    log("warn", `Betöltés sikertelen: ${url} — ${e.message}`);
    return false;
  }
}

async function pickRandomInternalLink(page, currentHost, blockedHosts) {
  const links = await page
    .$$eval(
      "a[href]",
      (as, args) => {
        const { currentHost, blocked } = args;
        const out = [];
        for (const a of as) {
          const href = a.getAttribute("href");
          if (!href) continue;
          if (href.startsWith("#")) continue;
          if (href.startsWith("javascript:")) continue;
          if (href.startsWith("mailto:") || href.startsWith("tel:")) continue;
          let abs;
          try {
            abs = new URL(href, location.href).href;
          } catch {
            continue;
          }
          const host = new URL(abs).hostname.toLowerCase();
          // Csak azonos domain marad — nem ugrunk el random helyre.
          if (!host.endsWith(currentHost.replace(/^www\./, ""))) continue;
          if (blocked.some((b) => host === b || host.endsWith("." + b))) continue;
          const rect = a.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) continue;
          out.push({ href: abs, text: (a.textContent || "").trim().slice(0, 80) });
        }
        return out;
      },
      { currentHost, blocked: blockedHosts },
    )
    .catch(() => []);
  if (!links.length) return null;
  return links[Math.floor(Math.random() * links.length)];
}

async function browsePage(page, log) {
  // 1-3 kör görgetés + drift + gondolkodó pauza
  const rounds = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < rounds; i++) {
    await humanCasualScroll(page, { rounds: 1 + Math.floor(Math.random() * 2) });
    if (Math.random() < 0.4) await humanIdleDrift(page);
    await humanThink(page, 1500 + Math.random() * 2500);
  }
  await humanBrowseMoment(page);
}

async function googleSearchAndClick(page, query, googleDomain, cookieAcceptTexts, blockedHosts, log) {
  await safeGoto(page, googleDomain, log);
  await humanWait(page, 800);
  await tryCloseCookieBanner(page, cookieAcceptTexts, log);
  await humanWait(page, 400);

  try {
    const input = page.locator('textarea[name="q"], input[name="q"]').first();
    await input.waitFor({ state: "visible", timeout: 8000 });
    await humanClick(page, input, { noMisclick: true });
    await humanType(page, query, { meanCharMs: 110 });
    await humanWait(page, 500);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await humanWait(page, 1400);
    await humanCasualScroll(page, { rounds: 2 });
    await humanThink(page, 1200);

    // Nem az első találat — 2. vagy 3.
    const results = await page.$$eval("a h3", (nodes) => {
      const out = [];
      for (const h of nodes) {
        const a = h.closest("a");
        if (!a) continue;
        const href = a.getAttribute("href");
        if (!href || !href.startsWith("http")) continue;
        out.push(href);
      }
      return out.slice(0, 8);
    }).catch(() => []);

    const candidates = results.filter((u) => !isBlacklisted(u, blockedHosts));
    if (!candidates.length) return null;
    const pick = candidates[1] ?? candidates[0];
    log("info", `Google találat választva: ${pick.slice(0, 90)}`);
    return pick;
  } catch (e) {
    log("warn", `Google keresés hiba: ${e.message}`);
    return null;
  }
}

export async function runLoggedOutWarmup({ page, context, spec, log }) {
  reseedHuman([spec.workflow_id || "", "warmup", Date.now()]);

  const locale = resolveLocale(spec.language);
  const durationMin = Math.max(1, Math.min(120, Number(spec.duration_min) || 45));
  const durationMs = durationMin * 60 * 1000;
  const sites = (Array.isArray(spec.sites) && spec.sites.length ? spec.sites : locale.sites).slice();
  const queries = (Array.isArray(spec.search_queries) && spec.search_queries.length
    ? spec.search_queries
    : locale.queries
  ).slice();
  const googleDomain = spec.google_domain || locale.googleDomain;
  const cookieAcceptTexts = locale.cookieAcceptTexts;
  const targetPlatform = String(spec.target_platform || "").toLowerCase();
  const extraBlocked = Array.isArray(spec.blacklist_hosts) ? spec.blacklist_hosts : [];
  const minDwell = Math.max(5, Number(spec.min_dwell_sec) || 20);
  const maxDwell = Math.max(minDwell + 5, Number(spec.max_dwell_sec) || 90);

  log(
    "info",
    `Warmup indul — nyelv: ${spec.language || "en (default)"}, cél: ${targetPlatform || "általános"}, időtartam: ${durationMin} perc, oldalak: ${sites.length}, keresések: ${queries.length}, google: ${googleDomain}`,
  );
  log(
    "info",
    `Feketelista (soha nem megyünk oda): ${[...HARD_BLACKLIST, ...extraBlocked].join(", ")}`,
  );

  const started = Date.now();
  let pagesVisited = 0;
  let blacklistBlocks = 0;
  const visitedDomains = new Set();

  while (Date.now() - started < durationMs) {
    const remainingSec = Math.floor((durationMs - (Date.now() - started)) / 1000);
    log("info", `Még ~${remainingSec}s hátra a warmup-ból. Meglátogatva: ${pagesVisited} oldal, ${visitedDomains.size} domain.`);

    // 40% eséllyel Google-keresés, 60% direkt portál
    let landingUrl;
    if (Math.random() < 0.4) {
      const q = queries[Math.floor(Math.random() * queries.length)];
      log("info", `Google.nl keresés: "${q}"`);
      landingUrl = await googleSearchAndClick(page, q, extraBlocked, log);
      if (landingUrl) {
        if (isBlacklisted(landingUrl, extraBlocked)) {
          log("warn", `Feketelistás találat kihagyva: ${hostOf(landingUrl)}`);
          blacklistBlocks++;
          landingUrl = null;
        }
      }
    }
    if (!landingUrl) {
      landingUrl = sites[Math.floor(Math.random() * sites.length)];
      if (isBlacklisted(landingUrl, extraBlocked)) {
        blacklistBlocks++;
        continue;
      }
      log("info", `Portál: ${landingUrl}`);
    }

    const okLanding = await safeGoto(page, landingUrl, log);
    if (!okLanding) continue;
    pagesVisited++;
    visitedDomains.add(hostOf(landingUrl));

    await humanWait(page, 900);
    await tryCloseCookieBanner(page, log);
    await browsePage(page, log);

    // Belső kattintás 0-2 közötti mélységre
    const clicks = Math.floor(Math.random() * 3);
    for (let i = 0; i < clicks; i++) {
      if (Date.now() - started >= durationMs) break;
      const currentHost = hostOf(page.url());
      const link = await pickRandomInternalLink(page, currentHost, [
        ...HARD_BLACKLIST,
        ...extraBlocked,
      ]);
      if (!link) break;
      if (isBlacklisted(link.href, extraBlocked)) {
        blacklistBlocks++;
        continue;
      }
      log("info", `Belső link → ${link.text || hostOf(link.href)}`);
      const ok = await safeGoto(page, link.href, log);
      if (!ok) break;
      pagesVisited++;
      visitedDomains.add(hostOf(link.href));
      await browsePage(page, log);

      // Dwell 20-90 mp
      const dwellSec = minDwell + Math.random() * (maxDwell - minDwell);
      await page.waitForTimeout(dwellSec * 1000);
    }

    // Kis pauza két portál között
    await humanWait(page, 2500 + Math.random() * 3500);
  }

  // Sütitár export — Playwright standard formátum, ugyanaz mint a claim küld.
  let cookies = [];
  try {
    cookies = await context.cookies();
  } catch (e) {
    log("warn", `Cookie export hiba: ${e.message}`);
  }
  const cookieDomains = new Set(cookies.map((c) => c.domain));

  // Feketelistás sütiket kidobjuk — nem lehet a warmup exportjában social platform cookie.
  const cleanCookies = cookies.filter((c) => {
    const d = String(c.domain || "").toLowerCase().replace(/^\./, "");
    return !HARD_BLACKLIST.some((b) => d === b || d.endsWith("." + b));
  });

  const durationSec = Math.round((Date.now() - started) / 1000);
  log(
    "info",
    `Warmup vége — ${durationSec}s alatt ${pagesVisited} oldal, ${visitedDomains.size} böngészett domain, ${cleanCookies.length} süti ${cookieDomains.size} domain-ről (feketelistás sütik szűrve).`,
  );

  return {
    duration_sec: durationSec,
    pages_visited: pagesVisited,
    cookies_collected: cleanCookies.length,
    domains: [...visitedDomains],
    cookie_domains: [...cookieDomains],
    blacklist_blocks: blacklistBlocks,
    target_platform: targetPlatform || null,
    // Ezt olvassa vissza a brain worker/complete endpoint és menti titkosítva.
    cookies_export: JSON.stringify(cleanCookies),
  };
}
