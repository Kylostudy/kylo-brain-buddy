// worker/executor/scripts/brain-tasks/instagram-warmup.js
//
// INSTAGRAM FIÓK-MELEGÍTÉS (bejelentkezve, magyar IP alól).
// Ugyanaz az óvatos elv, mint a Facebooknál (mindkettő Meta):
//   - SOHA nem posztol, nem kommentel, nem küld üzenetet, nem követ be senkit.
//   - Lájk csak ritkán (~15%), és csak a hírfolyamban.
//   - Kizárólag mentett sütikkel lép be. Jelszavas belépés TILOS.
//   - Checkpoint / „gyanús tevékenység" esetén azonnal leáll.
//
// brain_task mezők: duration_min (alap 18)

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanIdleDrift,
  humanThink,
  humanWait,
  reseedHuman,
} from "../humanize.js";

const HOME = "https://www.instagram.com/";

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

async function dismissDialogs(page, log) {
  const patterns = [
    /összes cookie engedélyezése/i,
    /az összes elfogadása/i,
    /allow all cookies/i,
    /csak a szükséges cookie-k/i,
    /most nem/i,
    /not now/i,
    /később/i,
    /mégse/i,
  ];
  for (const rx of patterns) {
    try {
      const b = page.getByRole("button", { name: rx }).first();
      if (await b.count().catch(() => 0)) {
        await humanClick(page, b, { timeout: 3000 }).catch(() => {});
        await humanWait(page, 900);
      }
    } catch {}
  }
  log("info", "Felugró ablakok elintézve (ha voltak).");
}

async function detectCheckpoint(page) {
  const url = page.url();
  if (/challenge|checkpoint|suspended|accounts\/disabled|two_factor/i.test(url)) return `URL: ${url}`;
  try {
    const txt = (await page.locator("body").innerText({ timeout: 4000 })).slice(0, 4000);
    if (
      /(gyanús tevékenység|erősítsd meg, hogy te vagy|fiókod zárolva|account has been (disabled|locked)|suspicious (login|activity)|help us confirm|biztonsági ellenőrzés)/i.test(
        txt,
      )
    ) {
      return "Ellenőrző-pont szöveg a képernyőn";
    }
  } catch {}
  return null;
}

async function isLoggedIn(page) {
  try {
    await humanWait(page, 2500);
    if (/\/accounts\/login/i.test(page.url())) return false;
    const marker = page
      .locator(
        [
          'svg[aria-label="Kezdőlap"]',
          'svg[aria-label="Home"]',
          'a[href="/direct/inbox/"]',
          'nav a[href*="/explore/"]',
          'div[role="main"] article',
        ].join(", "),
      )
      .first();
    if ((await marker.count().catch(() => 0)) > 0) return true;
    const loginForm = page.locator('input[name="password"]').first();
    return (await loginForm.count().catch(() => 0)) === 0;
  } catch {
    return false;
  }
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

  // ~15% eséllyel egyetlen lájk a látható posztok közül.
  if (Math.random() < 0.15) {
    try {
      const likes = page.locator('article svg[aria-label="Tetszik"], article svg[aria-label="Like"]');
      const n = await likes.count().catch(() => 0);
      if (n > 0) {
        await humanClick(page, likes.nth(Math.floor(Math.random() * Math.min(n, 4))), { timeout: 5000 });
        stats.reactions++;
        log("info", "Egy lájk leadva a hírfolyamban.");
        await humanWait(page, 1500);
      }
    } catch (e) {
      log("warn", `Lájk nem sikerült: ${e.message}`);
    }
  }
  await withTimeout(() => humanBrowseMoment(page), 25000, "olvasási pillanat", log);
}

async function visitSection(page, stats, log) {
  const sections = [
    { url: "https://www.instagram.com/explore/", name: "Felfedezés" },
    { url: "https://www.instagram.com/reels/", name: "Reels" },
    { url: "https://www.instagram.com/explore/search/", name: "Keresés" },
  ];
  const s = sections[Math.floor(Math.random() * sections.length)];
  log("info", `Nézelődés: ${s.name}`);
  const ok = await page
    .goto(s.url, { waitUntil: "domcontentloaded", timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  stats.sections_visited.add(s.name);
  await humanWait(page, 2200);
  await withTimeout(
    () => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 3) }),
    45000,
    `${s.name} görgetés`,
    log,
  );
  await humanThink(page, 2500 + Math.random() * 4000);
}

export async function runInstagramWarmup({ page, spec, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "instagram-warmup", Date.now()]);

  const durationMin = Math.max(5, Math.min(60, Number(brainTask?.duration_min) || 18));
  const durationMs = durationMin * 60 * 1000;

  log("info", `Instagram fiók-melegítés indul — ${durationMin} perc. Posztolás/kommentelés kizárva.`);

  const stats = { feed_scrolls: 0, reactions: 0, sections_visited: new Set(), logged_in: false };

  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await humanWait(page, 3000);
  await dismissDialogs(page, log);

  const cp = await detectCheckpoint(page);
  if (cp) throw new Error(`Instagram ellenőrző-pont — a melegítés leállt (${cp}). Lépj be kézzel a profilba.`);

  stats.logged_in = await isLoggedIn(page);
  if (!stats.logged_in) {
    throw new Error(
      "A mentett Instagram sütikkel nem vagyunk bejelentkezve. Frissítsd a sütiket (kézi belépés ugyanarról a magyar IP-ről), jelszavas belépést itt szándékosan nem próbálunk.",
    );
  }
  log("info", "Bejelentkezve a mentett sütikkel.");

  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const remaining = Math.floor((durationMs - (Date.now() - started)) / 1000);
    log(
      "info",
      `Még ~${remaining}s — eddig ${stats.feed_scrolls} hírfolyam-kör, ${stats.reactions} lájk, ${stats.sections_visited.size} menüpont.`,
    );

    const cp2 = await detectCheckpoint(page);
    if (cp2) {
      log("warn", `Ellenőrző-pont észlelve (${cp2}) — azonnal befejezzük.`);
      break;
    }

    if (Math.random() < 0.7) {
      if (!/instagram\.com\/?($|\?)/.test(page.url())) {
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
    `Instagram melegítés kész — ${durationSec}s, ${stats.feed_scrolls} hírfolyam-kör, ${stats.reactions} lájk.`,
  );

  return {
    instagram_warmup: {
      duration_sec: durationSec,
      feed_scrolls: stats.feed_scrolls,
      reactions: stats.reactions,
      sections_visited: [...stats.sections_visited],
      logged_in: stats.logged_in,
    },
  };
}
