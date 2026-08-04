// worker/executor/scripts/brain-tasks/linkedin-warmup.js
//
// LINKEDIN FIÓK-MELEGÍTÉS (bejelentkezve, mentett sütikkel).
//   - SOHA nem posztol, nem kommentel, nem küld üzenetet, nem jelöl be senkit.
//   - Csak hírfolyam-görgetés, olvasás, ritka reakció, alkalmi menüpont-nézelődés.
//   - Nincs jelszavas belépés: ha a süti lejárt, HIBÁT dobunk.
//
// brain_task mezők: duration_min (alap 15)

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanIdleDrift,
  humanThink,
  humanWait,
  reseedHuman,
} from "../humanize.js";

const HOME = "https://www.linkedin.com/feed/";

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
    if (/\/(login|checkpoint|uas\/login|authwall)/i.test(page.url())) return false;
    const marker = page
      .locator(
        [
          "div.feed-shared-update-v2",
          'main[aria-label*="feed" i]',
          "button.global-nav__primary-link-me-menu-trigger",
          'img.global-nav__me-photo',
        ].join(", "),
      )
      .first();
    return (await marker.count().catch(() => 0)) > 0;
  } catch {
    return false;
  }
}

async function detectCheckpoint(page) {
  if (/checkpoint|authwall|challenge/i.test(page.url())) return `URL: ${page.url()}`;
  try {
    const txt = (await page.locator("body").innerText({ timeout: 4000 })).slice(0, 3000);
    if (/(security verification|verify your identity|account has been restricted|unusual activity)/i.test(txt)) {
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

  // ~15% eséllyel egyetlen „Tetszik" a látható posztokon.
  if (Math.random() < 0.15) {
    try {
      const likes = page.locator('button[aria-label^="React Like" i], button[aria-label*="Tetszik" i]');
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

async function visitSection(page, stats, log) {
  const sections = [
    { url: "https://www.linkedin.com/mynetwork/", name: "Kapcsolatok" },
    { url: "https://www.linkedin.com/notifications/", name: "Értesítések" },
    { url: "https://www.linkedin.com/jobs/", name: "Állások" },
    { url: "https://www.linkedin.com/in/me/", name: "Saját profil" },
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
  await withTimeout(
    () => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 3) }),
    45000,
    `${s.name} görgetés`,
    log,
  );
  await humanThink(page, 2500 + Math.random() * 4000);
}

export async function runLinkedInWarmup({ page, spec, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "linkedin-warmup", Date.now()]);

  const durationMin = Math.max(5, Math.min(60, Number(brainTask?.duration_min) || 15));
  const durationMs = durationMin * 60 * 1000;

  log("info", `LinkedIn fiók-melegítés indul — ${durationMin} perc. Posztolás/kommentelés kizárva.`);

  const stats = {
    feed_scrolls: 0,
    reactions: 0,
    sections_visited: new Set(),
    logged_in: false,
  };

  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await humanWait(page, 3000);

  const cp = await detectCheckpoint(page);
  if (cp) throw new Error(`LinkedIn ellenőrző-pont — a melegítés leállt (${cp}). Lépj be kézzel a profilba.`);

  stats.logged_in = await isLoggedIn(page);
  if (!stats.logged_in) {
    throw new Error(
      "A mentett LinkedIn sütikkel nem vagyunk bejelentkezve. Frissítsd a sütiket (kézi belépés ugyanarról az IP-ről) — jelszavas belépést itt szándékosan nem próbálunk.",
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

    if (Math.random() < 0.7) {
      if (!/linkedin\.com\/feed/.test(page.url())) {
        await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        await humanWait(page, 2000);
      }
      await browseFeed(page, stats, log);
    } else {
      await withTimeout(() => visitSection(page, stats, log), 120000, "menüpont látogatás", log);
    }

    await humanThink(page, 3000 + Math.random() * 8000);
  }

  const durationSec = Math.round((Date.now() - started) / 1000);
  log(
    "info",
    `LinkedIn-melegítés kész — ${durationSec}s, ${stats.feed_scrolls} hírfolyam-kör, ${stats.reactions} reakció, ${stats.sections_visited.size} menüpont.`,
  );

  return {
    linkedin_warmup: {
      duration_sec: durationSec,
      feed_scrolls: stats.feed_scrolls,
      reactions: stats.reactions,
      sections_visited: [...stats.sections_visited],
      logged_in: stats.logged_in,
    },
  };
}
