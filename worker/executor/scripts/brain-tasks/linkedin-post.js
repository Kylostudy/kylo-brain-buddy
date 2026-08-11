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

import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanThink,
  humanType,
  humanWait,
  reseedHuman,
} from "../humanize.js";

async function downloadMediaToTemp(url, name, log) {
  const dir = await mkdtemp(join(tmpdir(), "kylo-li-media-"));
  const fname = (name || url.split("/").pop()?.split("?")[0] || "media.jpg").replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
  const fpath = join(dir, fname);
  log("info", `Melléklet letöltése: ${fname}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Letöltés HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(fpath));
  return fpath;
}


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

  // „Start a post" gomb — először a TANULT fogódzó, aztán a tartaléklista,
  // végül menet közbeni felderítés (Gemini Vision) önjavítással.
  const startBtn = await resolveTarget({
    page,
    log,
    platform: "linkedin",
    pageType: "feed_composer",
    field: "start_post_button",
    description: "A poszt írását indító gomb a hírfolyam tetején (Start a post)",
    workflowId: args.spec?.workflow_id || null,
    runId: args.spec?.run_id || null,
    timeoutMs: 20000,
    fallbacks: [
      'button.share-box-feed-entry__trigger',
      '.share-box-feed-entry__top-bar button',
      '.share-box-feed-entry button',
      'button:has-text("Start a post")',
      'button:has-text("Create a post")',
      'button:has-text("Beszélgetés indítása")',
      'button:has-text("Bericht starten")',
      'button:has-text("Start een bericht")',
      '[aria-label*="Start a post" i]',
      '[aria-label*="Create a post" i]',
      '[aria-label*="post" i][role="button"]',
      'button:has-text("What do you want to talk about")',
      'p:has-text("Start a post")',
      'span:has-text("Start a post")',
    ],
  });
  if (!startBtn) {
    // Végső mentsvár: közvetlenül a poszt-szerkesztő URL-je.
    log("warn", "Nem találtam a „Start a post” gombot — közvetlen szerkesztő URL-lel próbálom.");
    await page.goto("https://www.linkedin.com/feed/?shareActive=true", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await humanWait(page, 4000);
  } else {
    await humanClick(page, startBtn);
    await humanWait(page, 2500);
  }

  const editor = await resolveTarget({
    page,
    log,
    platform: "linkedin",
    pageType: "post_editor",
    field: "editor_box",
    description: "A poszt szövegének beírására szolgáló mező",
    workflowId: args.spec?.workflow_id || null,
    runId: args.spec?.run_id || null,
    timeoutMs: 20000,
    fallbacks: [
      'div.ql-editor[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      '[data-placeholder*="What do you want to talk about" i]',
    ],
  });

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

  // Ha van feltöltött melléklet (Tartalom Stúdió), hozzácsatoljuk.
  if (brainTask.media?.value) {
    try {
      const filePath =
        brainTask.media.kind === "url"
          ? await downloadMediaToTemp(brainTask.media.value, brainTask.media.name, log)
          : brainTask.media.value;
      const addMedia = await firstVisible(page, [
        'button[aria-label*="Add media" i]',
        'button[aria-label*="photo" i]',
        'button:has-text("Add a photo")',
      ], 6000);
      if (addMedia) {
        await humanClick(page, addMedia);
        await humanWait(page, 2000);
      }
      const input = page.locator('input[type="file"]').first();
      await input.waitFor({ state: "attached", timeout: 15000 });
      await input.setInputFiles(filePath);
      await humanWait(page, 6000);
      const done = await firstVisible(page, [
        'button:has-text("Done")',
        'button:has-text("Next")',
        'button:has-text("Kész")',
      ], 8000);
      if (done) {
        await humanClick(page, done);
        await humanWait(page, 3000);
      }
      log("info", "Melléklet hozzáadva a LinkedIn poszthoz.");
    } catch (e) {
      log("warn", `A melléklet feltöltése nem sikerült: ${e.message}`);
    }
  }

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
