// worker/executor/scripts/brain-tasks/reddit-karma-build.js
//
// REDDIT KARMA-ÉPÍTÉS.
// A bemelegítés (passzív görgetés) után ez a következő fokozat: a fiók
// napi 1–3 értelmes, témába vágó kommentet ír a SAJÁT célsubredditjeibe.
// Semmilyen link, márka vagy termék nem szerepelhet a kommentekben.
//
// Menete: belépés → főoldal/subreddit görgetés → poszt megnyitása → olvasás
// → a Brain AI megírja a hozzászólást (vagy kihagyja) → emberi gépelés → küldés
// → tovább böngészés. Sosem kommentel két posztot közvetlenül egymás után.

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
import { draftRedditComment } from "./brain-api.js";

const HOME = "https://www.reddit.com/";

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

async function isLoggedIn(page) {
  try {
    await humanWait(page, 1500);
    if (/\/login/i.test(page.url())) return false;
    const marker = page
      .locator(
        [
          "#expand-user-drawer-button",
          'faceplate-tracker[noun="user_drawer"]',
          'a[href*="/settings/account"]',
          'button[aria-label*="Create" i]',
        ].join(", "),
      )
      .first();
    return (await marker.count().catch(() => 0)) > 0;
  } catch {
    return false;
  }
}

async function loginWithPassword(page, creds, log) {
  if (!creds?.username || !creds?.password) return false;
  log("info", `Bejelentkezés jelszóval: ${creds.username}`);
  await page.goto("https://www.reddit.com/login/", { waitUntil: "domcontentloaded", timeout: 40000 });
  await humanWait(page, 1500);
  await acceptCookieBanner(page);
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
  return await isLoggedIn(page);
}

/** A megnyitott poszt szövegének kiolvasása. */
async function readPostContent(page) {
  return await page
    .evaluate(() => {
      const t =
        document.querySelector("h1")?.innerText ||
        document.querySelector('[slot="title"]')?.innerText ||
        document.title;
      const bodyEl =
        document.querySelector('[slot="text-body"]') ||
        document.querySelector('[data-post-click-location="text-body"]') ||
        document.querySelector("shreddit-post");
      const comments = [...document.querySelectorAll('[slot="comment"]')]
        .slice(0, 3)
        .map((c) => (c.innerText || "").trim().slice(0, 500))
        .filter(Boolean);
      const m = location.pathname.match(/\/r\/([^/]+)\//);
      return {
        title: (t || "").trim().slice(0, 500),
        body: (bodyEl?.innerText || "").trim().slice(0, 4000),
        top_comments: comments,
        subreddit: m ? m[1] : "",
      };
    })
    .catch(() => null);
}

/** Kommentmező megkeresése, gépelés, küldés. */
async function postComment(page, text, log) {
  // Reddit új felület: a "Add a comment" mező egy rich-text editor.
  const opener = page
    .locator(
      [
        'button:has-text("Add a comment")',
        '[name="comment"]',
        'div[contenteditable="true"]',
        "shreddit-composer",
      ].join(", "),
    )
    .first();
  if (!(await opener.count().catch(() => 0))) {
    log("warn", "Nem találom a kommentmezőt.");
    return false;
  }
  await humanClick(page, opener, { timeout: 8000, noMisclick: true }).catch(() => {});
  await humanWait(page, 1200);

  const editor = page.locator('div[contenteditable="true"]').first();
  if (!(await editor.count().catch(() => 0))) {
    log("warn", "A szerkesztő nem nyílt meg.");
    return false;
  }
  await humanClick(page, editor, { timeout: 8000, noMisclick: true }).catch(() => {});
  await humanType(page, text, { meanCharMs: 95 });
  await humanThink(page, 2500 + Math.random() * 3000); // átolvassuk, mint egy ember

  const submit = page
    .locator(
      [
        'button[slot="submit-button"]',
        'button:has-text("Comment")',
        'button[type="submit"]:has-text("Reply")',
      ].join(", "),
    )
    .first();
  if (!(await submit.count().catch(() => 0))) {
    log("warn", "Nincs küldés gomb.");
    return false;
  }
  await humanClick(page, submit, { timeout: 8000 });
  await humanWait(page, 4000);
  log("info", "Komment elküldve.");
  return true;
}

export async function runRedditKarmaBuild({ page, spec, creds, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "reddit-karma", Date.now()]);

  const durationMin = Math.max(8, Math.min(90, Number(brainTask?.duration_min) || 35));
  const durationMs = durationMin * 60 * 1000;
  const maxComments = Math.max(1, Math.min(3, Number(brainTask?.max_comments) || 2));
  const language = brainTask?.language || spec?.language || spec?.locale || "en";
  const targetSubs = Array.isArray(spec?.target_subreddits) ? spec.target_subreddits : [];

  log(
    "info",
    `Karma-építés indul — ${durationMin} perc, max ${maxComments} komment, ${targetSubs.length} cél subreddit.`,
  );

  const stats = {
    posts_read: 0,
    upvotes: 0,
    comments_posted: 0,
    comments_skipped: 0,
    subreddits_visited: new Set(),
    comment_permalinks: [],
  };

  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await humanWait(page, 2000);
  await acceptCookieBanner(page);

  let loggedIn = await isLoggedIn(page);
  if (!loggedIn) loggedIn = await loginWithPassword(page, creds, log);
  if (!loggedIn) {
    throw new Error("Nem sikerült bejelentkezni a Reddit fiókba (süti vagy jelszó hiba).");
  }

  const started = Date.now();
  let lastCommentAt = 0;

  while (Date.now() - started < durationMs) {
    // 1) Egy cél subreddit megnyitása (vagy főoldal)
    const sub = targetSubs.length
      ? String(targetSubs[Math.floor(Math.random() * targetSubs.length)]).replace(/^r\//, "")
      : null;
    const listUrl = sub ? `https://www.reddit.com/r/${sub}/new/` : HOME;
    await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 35000 }).catch(() => {});
    if (sub) stats.subreddits_visited.add(sub);
    await humanWait(page, 1500);
    await withTimeout(() => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 3) }), 45000, "lista görgetés", log);

    // 2) Poszt kiválasztása
    const links = await page
      .$$eval('a[href*="/comments/"]', (as) =>
        as
          .map((a) => a.href)
          .filter((h) => /reddit\.com\/r\/[^/]+\/comments\//.test(h))
          .slice(0, 25),
      )
      .catch(() => []);
    if (!links.length) {
      await humanWait(page, 4000);
      continue;
    }
    const url = links[Math.floor(Math.random() * links.length)];
    const ok = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) continue;
    stats.posts_read++;
    await humanWait(page, 1800);
    await withTimeout(() => humanCasualScroll(page, { rounds: 2 + Math.floor(Math.random() * 3) }), 45000, "poszt görgetés", log);
    await humanThink(page, 3000 + Math.random() * 5000);
    if (Math.random() < 0.35) await withTimeout(() => humanIdleDrift(page), 15000, "kurzor drift", log);

    // Néha upvote — mint bárki, aki olvas.
    if (Math.random() < 0.4) {
      try {
        const up = page.locator('button[aria-label*="upvote" i]').first();
        if (await up.count().catch(() => 0)) {
          await humanClick(page, up, { timeout: 5000 });
          stats.upvotes++;
        }
      } catch {}
    }

    // 3) Kommentelés — csak ha még van keret, és eltelt legalább 6 perc az előző óta.
    const canComment =
      stats.comments_posted < maxComments && Date.now() - lastCommentAt > 6 * 60 * 1000;

    if (canComment) {
      const content = await readPostContent(page);
      if (content?.title) {
        let draft = null;
        try {
          draft = await draftRedditComment({
            subreddit: content.subreddit || sub || "",
            title: content.title,
            body: content.body,
            topComments: content.top_comments,
            language,
          });
        } catch (e) {
          log("warn", `Kommentjavaslat hiba: ${e.message}`);
        }
        if (draft && !draft.skip && draft.comment) {
          log("info", `Komment terv: ${draft.comment.slice(0, 120)}`);
          const posted = await withTimeout(
            () => postComment(page, draft.comment, log),
            180000,
            "komment küldés",
            log,
          );
          if (posted) {
            stats.comments_posted++;
            stats.comment_permalinks.push(page.url());
            lastCommentAt = Date.now();
          } else {
            stats.comments_skipped++;
          }
        } else {
          stats.comments_skipped++;
          log("info", `Poszt kihagyva: ${draft?.reason || "nincs érdemi mondanivaló"}`);
        }
      }
    }

    await withTimeout(() => humanBrowseMoment(page), 25000, "olvasási pillanat", log);
    await humanWait(page, 5000 + Math.random() * 9000).catch(() => {});

    if (stats.comments_posted >= maxComments && Date.now() - started > durationMs * 0.6) break;
  }

  const durationSec = Math.round((Date.now() - started) / 1000);
  log(
    "info",
    `Karma-építés kész — ${durationSec}s, ${stats.posts_read} poszt, ${stats.comments_posted} komment, ${stats.upvotes} upvote.`,
  );

  return {
    reddit_karma_build: {
      duration_sec: durationSec,
      posts_read: stats.posts_read,
      upvotes: stats.upvotes,
      comments_posted: stats.comments_posted,
      comments_skipped: stats.comments_skipped,
      comment_permalinks: stats.comment_permalinks,
      subreddits_visited: [...stats.subreddits_visited],
    },
  };
}
