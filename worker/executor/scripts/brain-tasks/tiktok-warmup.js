// worker/executor/scripts/brain-tasks/tiktok-warmup.js
//
// TIKTOK FIÓK-MELEGÍTÉS (bejelentkezve, magyar IP alól).
//   - SOHA nem posztol, nem kommentel, nem követ be senkit, nem üzen.
//   - Lájk csak ritkán (~15%), a "Neked ajánljuk" folyamban.
//   - Kizárólag mentett sütikkel lép be. Jelszavas belépés TILOS
//     (a TikTok új helyről azonnal ellenőrző-kódot / puzzle-t kér).
//   - Captcha / ellenőrző-pont esetén azonnal leáll.
//
// A TikTok videós felület: itt a "görgetés" valójában videónézés — ezért
// hosszabb megállásokkal és nyílbillentyűs továbblépéssel dolgozunk.
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

const HOME = "https://www.tiktok.com/";

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
    /allow all/i,
    /accept all/i,
    /elfogadom/i,
    /most nem/i,
    /not now/i,
    /skip/i,
    /kihagyás/i,
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
  // Bejelentkezési modál bezárása, ha felugrott.
  try {
    const close = page.locator('div[id*="login-modal"] button, [data-e2e="modal-close-inner-button"]').first();
    if (await close.count().catch(() => 0)) {
      await humanClick(page, close, { timeout: 3000 }).catch(() => {});
      await humanWait(page, 700);
    }
  } catch {}
  log("info", "Felugró ablakok elintézve (ha voltak).");
}

async function detectCheckpoint(page) {
  const url = page.url();
  if (/captcha|verify|suspend|banned|login\/challenge/i.test(url)) return `URL: ${url}`;
  try {
    const txt = (await page.locator("body").innerText({ timeout: 4000 })).slice(0, 4000);
    if (
      /(húzd el a kirakós|biztonsági ellenőrzés|erősítsd meg, hogy te vagy|too many attempts|account (is )?(suspended|banned)|verify to continue|drag the puzzle)/i.test(
        txt,
      )
    ) {
      return "Ellenőrző-pont / captcha a képernyőn";
    }
  } catch {}
  return null;
}

async function isLoggedIn(page) {
  try {
    await humanWait(page, 3000);
    const marker = page
      .locator(
        [
          '[data-e2e="profile-icon"]',
          '[data-e2e="nav-profile"]',
          'a[href*="/upload"]',
          'div[data-e2e="nav-more-menu"]',
        ].join(", "),
      )
      .first();
    if ((await marker.count().catch(() => 0)) > 0) return true;
    const loginBtn = page.locator('[data-e2e="top-login-button"], button:has-text("Bejelentkezés")').first();
    return (await loginBtn.count().catch(() => 0)) === 0;
  } catch {
    return false;
  }
}

/** Videónézés: pár másodperc figyelés, majd tovább a következőre. */
async function watchVideos(page, stats, log) {
  const rounds = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < rounds; i++) {
    // 6–28 másodperc "nézés" — van, amit végignéz, van, amit átugrik.
    const watchMs = Math.random() < 0.3 ? 6000 + Math.random() * 6000 : 12000 + Math.random() * 16000;
    await humanWait(page, watchMs).catch(() => {});
    stats.videos_watched++;

    if (Math.random() < 0.15) {
      try {
        const like = page.locator('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]').first();
        if (await like.count().catch(() => 0)) {
          await humanClick(page, like, { timeout: 5000 });
          stats.reactions++;
          log("info", "Egy lájk leadva.");
          await humanWait(page, 1500);
        }
      } catch (e) {
        log("warn", `Lájk nem sikerült: ${e.message}`);
      }
    }

    if (Math.random() < 0.35) await withTimeout(() => humanIdleDrift(page), 12000, "kurzor drift", log);

    // Tovább a következő videóra.
    await page.keyboard.press("ArrowDown").catch(() => {});
    await humanWait(page, 1200 + Math.random() * 2000).catch(() => {});
  }
  await withTimeout(() => humanBrowseMoment(page), 20000, "megállás", log);
}

async function visitSection(page, stats, log) {
  const sections = [
    { url: "https://www.tiktok.com/explore", name: "Felfedezés" },
    { url: "https://www.tiktok.com/following", name: "Követett" },
    { url: "https://www.tiktok.com/", name: "Neked ajánljuk" },
  ];
  const s = sections[Math.floor(Math.random() * sections.length)];
  log("info", `Nézelődés: ${s.name}`);
  const ok = await page
    .goto(s.url, { waitUntil: "domcontentloaded", timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  stats.sections_visited.add(s.name);
  await humanWait(page, 2500);
  await withTimeout(
    () => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 2) }),
    40000,
    `${s.name} görgetés`,
    log,
  );
  await humanThink(page, 2500 + Math.random() * 4000);
}

export async function runTikTokWarmup({ page, spec, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "tiktok-warmup", Date.now()]);

  const durationMin = Math.max(5, Math.min(60, Number(brainTask?.duration_min) || 15));
  const durationMs = durationMin * 60 * 1000;

  log("info", `TikTok fiók-melegítés indul — ${durationMin} perc. Posztolás/kommentelés kizárva.`);

  const stats = { videos_watched: 0, reactions: 0, sections_visited: new Set(), logged_in: false };

  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await humanWait(page, 3500);
  await dismissDialogs(page, log);

  const cp = await detectCheckpoint(page);
  if (cp) throw new Error(`TikTok ellenőrző-pont — a melegítés leállt (${cp}). Lépj be kézzel a fiókba.`);

  stats.logged_in = await isLoggedIn(page);
  if (!stats.logged_in) {
    throw new Error(
      "A mentett TikTok sütikkel nem vagyunk bejelentkezve. Frissítsd a sütiket (kézi belépés ugyanarról a magyar IP-ről), jelszavas belépést itt szándékosan nem próbálunk.",
    );
  }
  log("info", "Bejelentkezve a mentett sütikkel.");

  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const remaining = Math.floor((durationMs - (Date.now() - started)) / 1000);
    log(
      "info",
      `Még ~${remaining}s — eddig ${stats.videos_watched} videó, ${stats.reactions} lájk, ${stats.sections_visited.size} menüpont.`,
    );

    const cp2 = await detectCheckpoint(page);
    if (cp2) {
      log("warn", `Ellenőrző-pont észlelve (${cp2}) — azonnal befejezzük.`);
      break;
    }

    if (Math.random() < 0.75) {
      await watchVideos(page, stats, log);
    } else {
      await withTimeout(() => visitSection(page, stats, log), 120000, "menüpont látogatás", log);
    }

    await humanWait(page, 3000 + Math.random() * 6000).catch(() => {});
  }

  const durationSec = Math.round((Date.now() - started) / 1000);
  log(
    "info",
    `TikTok melegítés kész — ${durationSec}s, ${stats.videos_watched} videó, ${stats.reactions} lájk.`,
  );

  return {
    tiktok_warmup: {
      duration_sec: durationSec,
      videos_watched: stats.videos_watched,
      reactions: stats.reactions,
      sections_visited: [...stats.sections_visited],
      logged_in: stats.logged_in,
    },
  };
}
