// worker/executor/scripts/brain-tasks/pinterest-warmup.js
//
// PINTEREST FIÓK-MELEGÍTÉS (bejelentkezve, mentett sütikkel).
//   - SOHA nem pineel, nem ment táblára, nem kommentel, nem követ senkit,
//     nem küld üzenetet.
//   - Csak hírfolyam-görgetés, pin-nézegetés, keresés, ritka menüpont-nézelődés.
//   - Nincs jelszavas belépés: ha a süti lejárt, HIBÁT dobunk.
//
// brain_task mezők: duration_min (alap 15)

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanIdleDrift,
  humanThink,
  humanType,
  humanWait,
  reseedHuman,
} from "../humanize.js";

const HOME = "https://www.pinterest.com/";

const SEARCH_QUERIES = [
  "home decor ideas",
  "easy dinner recipes",
  "travel inspiration",
  "garden ideas",
  "outfit ideas",
  "diy crafts",
  "healthy breakfast",
  "living room design",
];

function withTimeout(factory, ms, label, log) {
  let timer;
  return Promise.race([
    Promise.resolve()
      .then(factory)
      .finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        try {
          log("warn", `Időkorlát (${Math.round(ms / 1000)}s) — lépés kihagyva: ${label}`);
        } catch {}
        resolve(null);
      }, ms);
    }),
  ]).catch((e) => {
    try {
      log("warn", `Lépés hiba (${label}): ${e?.message || e}`);
    } catch {}
    return null;
  });
}

async function isLoggedIn(page) {
  try {
    await humanWait(page, 2500);
    if (/\/(login|signup)/i.test(page.url())) return false;
    // Bejelentkezett állapot jelzői: profil/avatar gomb a fejlécben.
    const marker = page
      .locator(
        [
          'a[href^="/settings"]',
          'button[aria-label*="profile" i]',
          'button[aria-label*="profiel" i]',
          'div[data-test-id="header-avatar"]',
          'img[data-test-id="user-avatar"]',
        ].join(", "),
      )
      .first();
    return (await marker.count().catch(() => 0)) > 0;
  } catch {
    return false;
  }
}

async function detectCheckpoint(page) {
  if (/checkpoint|challenge|verify|captcha/i.test(page.url())) return `URL: ${page.url()}`;
  try {
    const txt = (await page.locator("body").innerText({ timeout: 4000 })).slice(0, 3000);
    if (/(unusual activity|verify your identity|account suspended|suspicious activity|security check)/i.test(txt)) {
      return "Ellenőrző-pont szöveg a képernyőn";
    }
  } catch {}
  return null;
}

async function browseFeed(page, stats, log) {
  await withTimeout(
    () => humanCasualScroll(page, { rounds: 3 + Math.floor(Math.random() * 4) }),
    60000,
    "hírfolyam görgetés",
    log,
  );
  stats.feed_scrolls++;
  await humanThink(page, 2500 + Math.random() * 5000);
  if (Math.random() < 0.4) await withTimeout(() => humanIdleDrift(page), 15000, "kurzor drift", log);

  // ~25% eséllyel megnyitunk egy pint közelről (csak nézzük, nem mentjük).
  if (Math.random() < 0.25) {
    try {
      const pins = page.locator('a[href^="/pin/"]');
      const n = await pins.count().catch(() => 0);
      if (n > 0) {
        await humanClick(page, pins.nth(Math.floor(Math.random() * Math.min(n, 6))), { timeout: 5000 });
        stats.pins_viewed++;
        log("info", "Egy pin megnyitva közelről.");
        await humanWait(page, 3000 + Math.random() * 6000);
        await withTimeout(
          () => humanCasualScroll(page, { rounds: 1 + Math.floor(Math.random() * 2) }),
          30000,
          "pin részletek görgetés",
          log,
        );
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await humanWait(page, 2000);
      }
    } catch (e) {
      log("warn", `Pin megnyitás nem sikerült: ${e.message}`);
    }
  }
  await withTimeout(() => humanBrowseMoment(page), 25000, "olvasási pillanat", log);
}

async function doSearch(page, stats, log) {
  const q = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  log("info", `Keresés: „${q}"`);
  try {
    const box = page
      .locator('input[data-test-id="search-box-input"], input[aria-label*="Search" i], input[type="text"]')
      .first();
    if ((await box.count().catch(() => 0)) === 0) return;
    await humanClick(page, box, { timeout: 5000 });
    await humanType(page, box, q);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    stats.searches++;
    await humanWait(page, 2500);
    await withTimeout(
      () => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 3) }),
      45000,
      "keresési találatok görgetés",
      log,
    );
  } catch (e) {
    log("warn", `Keresés nem sikerült: ${e.message}`);
  }
}

async function visitSection(page, stats, log) {
  const sections = [
    { path: "/notifications/", name: "Értesítések" },
    { path: "/settings/profile/", name: "Profil beállítások" },
  ];
  const s = sections[Math.floor(Math.random() * sections.length)];
  log("info", `Nézelődés: ${s.name}`);
  const ok = await page
    .goto(`https://www.pinterest.com${s.path}`, { waitUntil: "domcontentloaded", timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  stats.sections_visited.add(s.name);
  await humanWait(page, 2000);
  await withTimeout(
    () => humanCasualScroll(page, { rounds: 1 + Math.floor(Math.random() * 2) }),
    30000,
    `${s.name} görgetés`,
    log,
  );
  await humanThink(page, 2500 + Math.random() * 4000);
}

export async function runPinterestWarmup({ page, spec, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "pinterest-warmup", Date.now()]);

  const durationMin = Math.max(5, Math.min(60, Number(brainTask?.duration_min) || 15));
  const durationMs = durationMin * 60 * 1000;

  log("info", `Pinterest fiók-melegítés indul — ${durationMin} perc. Pineelés/mentés/követés kizárva.`);

  const stats = {
    feed_scrolls: 0,
    pins_viewed: 0,
    searches: 0,
    sections_visited: new Set(),
    logged_in: false,
  };

  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await humanWait(page, 3000);

  const cp = await detectCheckpoint(page);
  if (cp) throw new Error(`Pinterest ellenőrző-pont — a melegítés leállt (${cp}). Lépj be kézzel a profilba.`);

  stats.logged_in = await isLoggedIn(page);
  if (!stats.logged_in) {
    throw new Error(
      "A mentett Pinterest sütikkel nem vagyunk bejelentkezve. Frissítsd a sütiket (kézi belépés ugyanarról az IP-ről) — jelszavas belépést itt szándékosan nem próbálunk.",
    );
  }
  log("info", "Bejelentkezve a mentett sütikkel.");

  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const remaining = Math.floor((durationMs - (Date.now() - started)) / 1000);
    log(
      "info",
      `Még ~${remaining}s — eddig ${stats.feed_scrolls} hírfolyam-kör, ${stats.pins_viewed} pin, ${stats.searches} keresés, ${stats.sections_visited.size} menüpont.`,
    );

    const cp2 = await detectCheckpoint(page);
    if (cp2) {
      log("warn", `Ellenőrző-pont észlelve (${cp2}) — azonnal befejezzük.`);
      break;
    }

    const roll = Math.random();
    if (roll < 0.6) {
      if (!/pinterest\.com\/?$/.test(new URL(page.url()).pathname)) {
        await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        await humanWait(page, 2000);
      }
      await browseFeed(page, stats, log);
    } else if (roll < 0.85) {
      await withTimeout(() => doSearch(page, stats, log), 90000, "keresés", log);
    } else {
      await withTimeout(() => visitSection(page, stats, log), 90000, "menüpont látogatás", log);
    }

    await humanThink(page, 3000 + Math.random() * 8000);
  }

  const durationSec = Math.round((Date.now() - started) / 1000);
  log(
    "info",
    `Pinterest-melegítés kész — ${durationSec}s, ${stats.feed_scrolls} hírfolyam-kör, ${stats.pins_viewed} pin, ${stats.searches} keresés.`,
  );

  return {
    pinterest_warmup: {
      duration_sec: durationSec,
      feed_scrolls: stats.feed_scrolls,
      pins_viewed: stats.pins_viewed,
      searches: stats.searches,
      sections_visited: [...stats.sections_visited],
      logged_in: stats.logged_in,
    },
  };
}
