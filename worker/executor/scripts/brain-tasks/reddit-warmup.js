// worker/executor/scripts/brain-tasks/reddit-warmup.js
//
// REDDIT FIÓK-MELEGÍTÉS (bejelentkezve).
// Nem tévesztendő össze az országos, kijelentkezett sütigyűjtéssel!
// Itt a MEGLÉVŐ Reddit fiókot járatjuk meg emberi módon:
//   bejelentkezés (süti vagy jelszó) → főoldal görgetés → posztok megnyitása
//   → alkalmi upvote → kommentek olvasása → subreddit böngészés → kilépés nélkül vége.
//
// Sosem posztol és nem kommentel — ez tisztán passzív bemelegítés.

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

const HOME = "https://www.reddit.com/";

/** Bármely lépést időkorlát közé zár — semmi nem ragadhat be némán. */
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
    await humanWait(page, 2000);
    const url = page.url();
    if (/\/login/i.test(url)) return false;
    // A bejelentkezett felületen ott a felhasználói menü.
    const marker = page
      .locator(
        [
          '#expand-user-drawer-button',
          'faceplate-tracker[noun="user_drawer"]',
          'a[href*="/user/"]',
          'a[href*="/settings/account"]',
          'button[aria-label*="Create" i]',
          'a[aria-label*="Create" i]',
        ].join(', '),
      )
      .first();
    if ((await marker.count().catch(() => 0)) > 0) return true;

    const loginButton = page
      .locator('a[href*="/login"], button:has-text("Log In"), button:has-text("Log in")')
      .first();
    return (await loginButton.count().catch(() => 0)) === 0;
  } catch {
    return false;
  }
}

async function acceptCookieBanner(page, log) {
  for (const rx of [/accept all/i, /accept/i, /i agree/i, /got it/i]) {
    try {
      const b = page.getByRole("button", { name: rx }).first();
      if (await b.count().catch(() => 0)) {
        await humanClick(page, b, { timeout: 3000 }).catch(() => {});
        await humanWait(page, 600);
        return;
      }
    } catch {}
  }
}

async function loginWithPassword(page, creds, log) {
  if (!creds?.username || !creds?.password) {
    log("warn", "Nincs mentett Reddit felhasználónév/jelszó — csak sütivel próbálkozunk.");
    return false;
  }
  log("info", `Bejelentkezés jelszóval: ${creds.username}`);
  await page.goto("https://www.reddit.com/login/", {
    waitUntil: "domcontentloaded",
    timeout: 40000,
  });
  await humanWait(page, 1500);
  await acceptCookieBanner(page, log);

  try {
    const user = page.locator('input[name="username"], input#login-username').first();
    await user.waitFor({ state: "visible", timeout: 15000 });
    await humanClick(page, user, { noMisclick: true });
    await humanType(page, creds.username, { meanCharMs: 130 });
    await humanThink(page, 900);

    const pass = page.locator('input[name="password"], input#login-password').first();
    await humanClick(page, pass, { noMisclick: true });
    await humanType(page, creds.password, { meanCharMs: 120 });
    await humanThink(page, 1200);

    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    await humanWait(page, 4000);
  } catch (e) {
    log("warn", `Bejelentkezési űrlap hiba: ${e.message}`);
    return false;
  }

  const ok = await isLoggedIn(page);
  log(ok ? "info" : "warn", ok ? "Bejelentkezve." : "A bejelentkezés nem sikerült (captcha vagy hibás adat?).");
  return ok;
}

/** Egy poszt megnyitása, olvasása, néha upvote. */
async function readPost(page, stats, log) {
  const links = await page
    .$$eval('a[href*="/comments/"]', (as) =>
      as
        .map((a) => a.href)
        .filter((h) => /reddit\.com\/r\/[^/]+\/comments\//.test(h))
        .slice(0, 40),
    )
    .catch(() => []);
  if (!links.length) return;

  const url = links[Math.floor(Math.random() * links.length)];
  log("info", `Poszt megnyitása: ${url.slice(0, 90)}`);
  const ok = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  stats.posts_read++;

  await humanWait(page, 1500);
  await withTimeout(() => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 3) }), 45000, "poszt görgetés", log);
  await humanThink(page, 2000 + Math.random() * 4000);
  if (Math.random() < 0.4) await withTimeout(() => humanIdleDrift(page), 15000, "kurzor drift", log);

  // ~35% eséllyel upvote — nem minden posztot pontozunk, az feltűnő lenne.
  if (Math.random() < 0.35) {
    try {
      const up = page
        .locator('button[aria-label*="upvote" i], shreddit-post >>> button[upvote], [data-post-click-location="vote"] button')
        .first();
      if (await up.count().catch(() => 0)) {
        await humanClick(page, up, { timeout: 5000 });
        stats.upvotes++;
        log("info", "Upvote leadva.");
        await humanWait(page, 1200);
      }
    } catch (e) {
      log("warn", `Upvote nem sikerült: ${e.message}`);
    }
  }

  await withTimeout(() => humanBrowseMoment(page), 25000, "olvasási pillanat", log);
}

/** Egy subreddit meglátogatása a target listából. */
async function visitSubreddit(page, sub, stats, log) {
  const url = `https://www.reddit.com/r/${String(sub).replace(/^r\//, "")}/`;
  log("info", `Subreddit: ${url}`);
  const ok = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  stats.subreddits_visited.add(String(sub).replace(/^r\//, ""));
  await humanWait(page, 1500);
  await withTimeout(() => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 3) }), 45000, "subreddit görgetés", log);
  await humanThink(page, 2000 + Math.random() * 3000);
}

export async function runRedditWarmup({ page, spec, creds, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "reddit-warmup", Date.now()]);

  const durationMin = Math.max(5, Math.min(120, Number(brainTask?.duration_min) || 30));
  const durationMs = durationMin * 60 * 1000;
  const targetSubs = Array.isArray(spec?.target_subreddits) ? spec.target_subreddits : [];

  log("info", `Reddit fiók-melegítés indul — ${durationMin} perc, cél subredditek: ${targetSubs.length || "nincs megadva"}`);

  const stats = {
    posts_read: 0,
    upvotes: 0,
    subreddits_visited: new Set(),
    logged_in: false,
  };

  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await humanWait(page, 2000);
  await acceptCookieBanner(page, log);

  stats.logged_in = await isLoggedIn(page);
  if (stats.logged_in) {
    log("info", "A mentett sütikkel már be vagyunk jelentkezve.");
  } else {
    stats.logged_in = await loginWithPassword(page, creds, log);
  }
  if (!stats.logged_in) {
    throw new Error(
      "Nem sikerült bejelentkezni a Reddit fiókba — ellenőrizd a mentett jelszót vagy a sütiket.",
    );
  }

  const started = Date.now();
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await humanWait(page, 2000);

  while (Date.now() - started < durationMs) {
    const remaining = Math.floor((durationMs - (Date.now() - started)) / 1000);
    log(
      "info",
      `Még ~${remaining}s — eddig ${stats.posts_read} poszt, ${stats.upvotes} upvote, ${stats.subreddits_visited.size} subreddit.`,
    );

    const roll = Math.random();
    if (targetSubs.length && roll < 0.35) {
      const sub = targetSubs[Math.floor(Math.random() * targetSubs.length)];
      await withTimeout(() => visitSubreddit(page, sub, stats, log), 120000, "subreddit látogatás", log);
    } else if (roll < 0.8) {
      await withTimeout(() => readPost(page, stats, log), 150000, "poszt olvasás", log);
    } else {
      log("info", "Vissza a főoldalra, görgetés.");
      await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await withTimeout(() => humanCasualScroll(page, { rounds: 3 }), 45000, "főoldal görgetés", log);
      await humanThink(page, 3000 + Math.random() * 4000);
    }

    await humanWait(page, 3000 + Math.random() * 5000).catch(() => {});
  }

  const durationSec = Math.round((Date.now() - started) / 1000);
  log(
    "info",
    `Fiók-melegítés kész — ${durationSec}s, ${stats.posts_read} poszt olvasva, ${stats.upvotes} upvote, ${stats.subreddits_visited.size} subreddit.`,
  );

  return {
    reddit_warmup: {
      duration_sec: durationSec,
      posts_read: stats.posts_read,
      upvotes: stats.upvotes,
      subreddits_visited: [...stats.subreddits_visited],
      logged_in: stats.logged_in,
    },
  };
}
