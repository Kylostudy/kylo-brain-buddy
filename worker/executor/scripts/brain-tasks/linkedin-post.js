// worker/executor/scripts/brain-tasks/linkedin-post.js
//
// LINKEDIN POSZT — a Brain „Tartalom Stúdió" felületén beillesztett szöveget a
// worker EMBERI tempóban gépeli be a LinkedIn feed-szerkesztőjébe.
// Nincs vágólap-beillesztés, van gondolkodási szünet, görgetés, nézelődés.
//
// brain_task mezők:
//   body (kötelező), submit (bool), dry_run (bool)
//   target_ref: opcionális company slug/ID — ha meg van adva, a céges oldal
//               admin nézetéből posztolunk, különben személyes profilról.

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanThink,
  humanType,
  humanWait,
  reseedHuman,
} from "../humanize.js";

async function firstVisible(page, selectors, timeoutMs = 10000) {
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

export async function runLinkedInPost(args) {
  const { page, brainTask, log } = args;
  reseedHuman();

  const body = (brainTask.body || "").trim();
  const submit = brainTask.submit !== false && !brainTask.dry_run;
  const target = (brainTask.target_ref || brainTask.company || "").trim();

  if (!body) throw new Error("Nincs szöveg a LinkedIn poszthoz.");

  const feedUrl = target
    ? `https://www.linkedin.com/company/${target.replace(/^\/?company\//, "")}/admin/page-posts/published/`
    : "https://www.linkedin.com/feed/";

  log("info", `LinkedIn poszt előkészítése (${body.length} karakter) — ${target ? "céges oldal" : "személyes profil"}`);

  // Először beesünk a feedbe és nézelődünk — nem ajtóstul rontunk a házba.
  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await humanWait(page, 3000);

  if (/\/(login|checkpoint|uas)\//.test(page.url())) {
    throw new Error("A LinkedIn kijelentkeztetett — friss sütik kellenek a workflow credentialhez.");
  }

  await humanBrowseMoment(page);
  await humanCasualScroll(page, { steps: 4 });
  await humanThink(page, 3000);

  if (feedUrl !== "https://www.linkedin.com/feed/") {
    await page.goto(feedUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await humanWait(page, 3000);
    await humanCasualScroll(page, { steps: 2 });
  }

  // „Start a post" gomb megnyitása
  const startBtn = await firstVisible(page, [
    'button.share-box-feed-entry__trigger',
    'button:has-text("Start a post")',
    'button:has-text("Create a post")',
    'button:has-text("Beszélgetés indítása")',
    '[aria-label*="Start a post" i]',
    '[aria-label*="Create a post" i]',
  ], 15000);
  if (!startBtn) throw new Error("Nem található a „Start a post” gomb (lehet, hogy nem vagyunk bejelentkezve).");

  await humanClick(page, startBtn);
  await humanWait(page, 2500);

  const editor = await firstVisible(page, [
    'div.ql-editor[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '[data-placeholder*="What do you want to talk about" i]',
  ], 15000);
  if (!editor) throw new Error("Nem található a LinkedIn szövegszerkesztő mező.");

  await humanClick(page, editor);
  await humanThink(page, 1800);

  // Bekezdésenként gépelünk, közte gondolkodási szünettel.
  const paragraphs = body.split(/\n{2,}/);
  for (let i = 0; i < paragraphs.length; i++) {
    await humanType(page, paragraphs[i], { meanCharMs: 60 });
    if (i < paragraphs.length - 1) {
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await humanThink(page, 2000);
    }
  }

  await humanThink(page, 4000);

  if (!submit) {
    log("info", "Próbamenet — a poszt be van gépelve, de NEM küldtük el.");
    return { linkedin_post: { typed: true, submitted: false, chars: body.length } };
  }

  const postBtn = await firstVisible(page, [
    'button.share-actions__primary-action',
    'button:has-text("Post")',
    'button:has-text("Közzététel")',
    '[aria-label="Post"]',
  ], 10000);
  if (!postBtn) throw new Error("Nem található a LinkedIn „Post” gomb.");

  await humanClick(page, postBtn);
  await humanWait(page, 8000);

  // Poszt után még maradunk egy kicsit, mint egy valódi ember.
  await humanCasualScroll(page, { steps: 3 });
  await humanIdle(page);

  log("info", "LinkedIn poszt elküldve.");
  return {
    linkedin_post: {
      typed: true,
      submitted: true,
      chars: body.length,
      url: page.url(),
      company: target || null,
    },
  };
}

async function humanIdle(page) {
  try {
    await humanBrowseMoment(page);
  } catch {}
}
