// worker/executor/scripts/brain-tasks/facebook-warmup.js
//
// FACEBOOK FIÓK-MELEGÍTÉS (bejelentkezve, magyar IP alól).
// A Facebook a legparanoidabb platform, ezért itt SZÁNDÉKOSAN kevesebbet
// csinálunk, mint Redditen:
//   - SOHA nem posztol, nem kommentel, nem küld üzenetet, nem jelöl be ismerőst.
//   - Reakció (like) csak ritkán, és csak a hírfolyamban.
//   - Nincs jelszavas belépés: kizárólag mentett sütikkel dolgozunk. Ha a süti
//     lejárt, HIBÁT dobunk — a jelszavas belépés új helyről azonnal
//     ellenőrző-kódot és fiókzárolást hozna.
//
// brain_task mezők: duration_min (alap 20)

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanIdleDrift,
  humanThink,
  humanWait,
  reseedHuman,
} from "../humanize.js";

const HOME = "https://www.facebook.com/";

/** Semmi nem ragadhat be némán. */
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

async function acceptCookieBanner(page) {
  for (const rx of [/összes cookie engedélyezése/i, /az összes elfogadása/i, /allow all cookies/i, /accept all/i]) {
    try {
      const b = page.getByRole("button", { name: rx }).first();
      if (await b.count().catch(() => 0)) {
        await humanClick(page, b, { timeout: 3000 }).catch(() => {});
        await humanWait(page, 800);
        return;
      }
    } catch {}
  }
}

async function isLoggedIn(page) {
  try {
    await humanWait(page, 2500);
    const url = page.url();
    if (/login|checkpoint|recover|two_step/i.test(url)) return false;
    const marker = page
      .locator(
        [
          'div[role="banner"] a[aria-label*="Profil" i]',
          'div[aria-label="Fiók vezérlése" i]',
          'div[aria-label="Your profile" i]',
          'a[href*="/me/"]',
          'div[role="navigation"] a[aria-label*="Kezdőlap" i]',
          'div[role="navigation"] a[aria-label*="Home" i]',
          'div[role="feed"]',
        ].join(", "),
      )
      .first();
    if ((await marker.count().catch(() => 0)) > 0) return true;

    const loginForm = page.locator('input[name="pass"], form[action*="login"]').first();
    return (await loginForm.count().catch(() => 0)) === 0;
  } catch {
    return false;
  }
}

/** Ellenőrző-pont / zárolás felismerése — ilyenkor azonnal kiszállunk. */
async function detectCheckpoint(page) {
  const url = page.url();
  if (/checkpoint|disabled|confirmemail|two_step/i.test(url)) return `URL: ${url}`;
  try {
    const txt = (await page.locator("body").innerText({ timeout: 4000 })).slice(0, 4000);
    if (/(fiókod zárolva|fiókja zárolva|account has been locked|temporarily blocked|ideiglenesen letiltottuk|biztonsági ellenőrzés|security check)/i.test(txt)) {
      return "Ellenőrző-pont szöveg a képernyőn";
    }
  } catch {}
  return null;
}

/** Hírfolyam görgetés, alkalmi videó-megállás. */
async function browseFeed(page, stats, log) {
  await withTimeout(() => humanCasualScroll(page, { rounds: 3 + Math.floor(Math.random() * 4) }), 60000, "hírfolyam görgetés", log);
  stats.feed_scrolls++;
  await humanThink(page, 2500 + Math.random() * 5000);
  if (Math.random() < 0.4) await withTimeout(() => humanIdleDrift(page), 15000, "kurzor drift", log);

  // ~20% eséllyel egyetlen like a látható posztok közül.
  if (Math.random() < 0.2) {
    try {
      const likes = page.locator('div[role="feed"] div[aria-label="Tetszik"], div[role="feed"] div[aria-label="Like"]');
      const n = await likes.count().catch(() => 0);
      if (n > 0) {
        await humanClick(page, likes.nth(Math.floor(Math.random() * Math.min(n, 5))), { timeout: 5000 });
        stats.reactions++;
        log("info", "Egy reakció leadva a hírfolyamban.");
        await humanWait(page, 1500);
      }
    } catch (e) {
      log("warn", `Reakció nem sikerült: ${e.message}`);
    }
  }
  await withTimeout(() => humanBrowseMoment(page), 25000, "olvasási pillanat", log);
}

/** Egy „mellékutca" — csoport, oldal, Marketplace, videók. Csak nézelődés. */
async function visitSection(page, stats, log) {
  const sections = [
    { url: "https://www.facebook.com/watch/", name: "Videók" },
    { url: "https://www.facebook.com/marketplace/", name: "Marketplace" },
    { url: "https://www.facebook.com/groups/feed/", name: "Csoportok" },
    { url: "https://www.facebook.com/friends/", name: "Ismerősök" },
  ];
  const s = sections[Math.floor(Math.random() * sections.length)];
  log("info", `Nézelődés: ${s.name}`);
  const ok = await page
    .goto(s.url, { waitUntil: "domcontentloaded", timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  stats.sections_visited.add(s.name);
  await humanWait(page, 2000);
  await withTimeout(() => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 3) }), 45000, `${s.name} görgetés`, log);
  await humanThink(page, 2500 + Math.random() * 4000);
}

export async function runFacebookWarmup({ page, spec, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "facebook-warmup", Date.now()]);

  const durationMin = Math.max(5, Math.min(60, Number(brainTask?.duration_min) || 20));
  const durationMs = durationMin * 60 * 1000;

  log("info", `Facebook fiók-melegítés indul — ${durationMin} perc. Posztolás/kommentelés kizárva.`);

  const stats = {
    feed_scrolls: 0,
    reactions: 0,
    sections_visited: new Set(),
    logged_in: false,
  };

  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await humanWait(page, 3000);
  await acceptCookieBanner(page);

  const cp = await detectCheckpoint(page);
  if (cp) throw new Error(`Facebook ellenőrző-pont — a melegítés leállt (${cp}). Lépj be kézzel a profilba.`);

  stats.logged_in = await isLoggedIn(page);
  if (!stats.logged_in) {
    throw new Error(
      "A mentett Facebook sütikkel nem vagyunk bejelentkezve. Frissítsd a sütiket (kézi belépés ugyanarról a magyar IP-ről), jelszavas belépést itt szándékosan nem próbálunk.",
    );
  }
  log("info", "Bejelentkezve a mentett sütikkel.");

  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const remaining = Math.floor((durationMs - (Date.now() - started)) / 1000);
    log(
      "info",
      `Még ~${remaining}s — eddig ${stats.feed_scrolls} hírfolyam-kör, ${stats.reactions} reakció, ${stats.sections_visited.size} menüpont.`,
    );

    const cp2 = await detectCheckpoint(page);
    if (cp2) {
      log("warn", `Ellenőrző-pont észlelve (${cp2}) — azonnal befejezzük.`);
      break;
    }

    if (Math.random() < 0.65) {
      if (!/facebook\.com\/?($|\?)/.test(page.url())) {
        await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        await humanWait(page, 2000);
      }
      await browseFeed(page, stats, log);
    } else {
      await withTimeout(() => visitSection(page, stats, log), 120000, "menüpont látogatás", log);
    }

    await humanWait(page, 4000 + Math.random() * 7000).catch(() => {});
  }

  const durationSec = Math.round((Date.now() - started) / 1000);
  log(
    "info",
    `Facebook melegítés kész — ${durationSec}s, ${stats.feed_scrolls} hírfolyam-kör, ${stats.reactions} reakció.`,
  );

  return {
    facebook_warmup: {
      duration_sec: durationSec,
      feed_scrolls: stats.feed_scrolls,
      reactions: stats.reactions,
      sections_visited: [...stats.sections_visited],
      logged_in: stats.logged_in,
    },
  };
}
