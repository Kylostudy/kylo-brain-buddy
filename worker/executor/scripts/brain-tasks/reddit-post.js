// worker/executor/scripts/brain-tasks/reddit-post.js
//
// REDDIT POSZT / KOMMENT — a Brain „Tartalom Stúdió" felületén beillesztett
// szöveget a worker EMBERI tempóban gépeli be (nem vágólap-beillesztés).
// A gépelés közben van gondolkodás, elgépelés-javítás, görgetés.
//
// brain_task mezők:
//   title, body, subreddit, submit (bool), dry_run (bool)

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanThink,
  humanType,
  humanWait,
  reseedHuman,
} from "../humanize.js";

async function firstVisible(page, selectors, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.isVisible({ timeout: 400 })) return loc;
      } catch {}
    }
    await page.waitForTimeout(300);
  }
  return null;
}

export async function runRedditPost(args) {
  const { page, brainTask, log } = args;
  reseedHuman();

  const title = (brainTask.title || "").trim();
  const body = (brainTask.body || "").trim();
  const subreddit = (brainTask.subreddit || "").replace(/^\/?r\//i, "").trim();
  const submit = brainTask.submit !== false && !brainTask.dry_run;

  if (!body) throw new Error("Nincs szöveg a poszthoz.");
  if (!subreddit) throw new Error("Nincs megadva subreddit.");

  const url = `https://www.reddit.com/r/${subreddit}/submit/?type=TEXT`;
  log("info", `Poszt előkészítése: r/${subreddit} (${body.length} karakter)`);

  // Előbb kicsit nézelődünk a subredditben — nem esünk be ajtóstul.
  await page.goto(`https://www.reddit.com/r/${subreddit}/`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await humanBrowseMoment(page);
  await humanCasualScroll(page, { steps: 3 });
  await humanThink(page, 2500);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await humanWait(page, 2500);

  const titleField = await firstVisible(page, [
    'textarea[name="title"]',
    'faceplate-textarea-input[name="title"] textarea',
    'textarea[placeholder*="Title" i]',
    'input[name="title"]',
  ], 15000);
  if (!titleField) throw new Error("Nem található a poszt címe mező (lehet, hogy nem vagyunk bejelentkezve).");

  await humanClick(page, titleField);
  await humanType(page, title || body.slice(0, 90), { meanCharMs: 105 });
  await humanThink(page, 2200);

  const bodyField = await firstVisible(page, [
    'div[contenteditable="true"][name="body"]',
    'shreddit-composer div[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'textarea[name="body"]',
  ], 12000);
  if (!bodyField) throw new Error("Nem található a poszt szövege mező.");

  await humanClick(page, bodyField);
  // Bekezdésenként gépelünk, közte gondolkodási szünettel.
  const paragraphs = body.split(/\n{2,}/);
  for (let i = 0; i < paragraphs.length; i++) {
    await humanType(page, paragraphs[i], { meanCharMs: 55 });
    if (i < paragraphs.length - 1) {
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await humanThink(page, 1800);
    }
  }

  await humanThink(page, 3500);
  await humanCasualScroll(page, { steps: 2 });

  if (!submit) {
    log("info", "Próbamenet — a poszt be van gépelve, de NEM küldtük el.");
    return { reddit_post: { typed: true, submitted: false, subreddit, chars: body.length } };
  }

  const postBtn = await firstVisible(page, [
    'button[slot="submit-button"]',
    'button:has-text("Post")',
    'button:has-text("Küldés")',
  ], 8000);
  if (!postBtn) throw new Error("Nem található a Post gomb.");
  await humanClick(page, postBtn);
  await humanWait(page, 6000);

  const finalUrl = page.url();
  log("info", `Poszt elküldve — URL: ${finalUrl}`);
  return {
    reddit_post: {
      typed: true,
      submitted: true,
      subreddit,
      chars: body.length,
      url: finalUrl,
    },
  };
}
