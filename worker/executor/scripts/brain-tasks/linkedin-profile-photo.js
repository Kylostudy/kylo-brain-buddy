// worker/executor/scripts/brain-tasks/linkedin-profile-photo.js
//
// LINKEDIN PROFILKÉP CSERE — a Tartalom Stúdióban feltöltött képet a worker
// letölti (aláírt link), majd emberi tempóban feltölti a LinkedIn profilra.
//
// brain_task mezők:
//   media: { kind: "url"|"path", value, name?, mime? }   (kötelező)
//   submit (bool) — ha false, csak megnyitja a párbeszédablakot, nem ment
//   dry_run (bool)

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
  humanWait,
  reseedHuman,
} from "../humanize.js";

async function downloadToTemp(url, name, log) {
  const dir = await mkdtemp(join(tmpdir(), "kylo-li-photo-"));
  const fname = (name || url.split("/").pop()?.split("?")[0] || "profil.jpg").replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
  const fpath = join(dir, fname);
  log("info", `Profilkép letöltése: ${fname}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`A kép letöltése nem sikerült (HTTP ${res.status}).`);
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

export async function runLinkedInProfilePhoto(args) {
  const { page, brainTask, log } = args;
  reseedHuman();

  const media = brainTask.media;
  if (!media || !media.value) throw new Error("Nincs feltöltött kép a profilképhez.");
  const submit = brainTask.submit !== false && !brainTask.dry_run;

  const filePath =
    media.kind === "url" ? await downloadToTemp(media.value, media.name, log) : media.value;

  // Nem esünk ajtóstul a házba: előbb a feed, nézelődés.
  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await humanWait(page, 3000);
  if (/\/(login|checkpoint|uas)\//.test(page.url())) {
    throw new Error("A LinkedIn kijelentkeztetett — friss sütik kellenek.");
  }
  await humanBrowseMoment(page);
  await humanCasualScroll(page, { steps: 3 });
  await humanThink(page, 2500);

  await page.goto("https://www.linkedin.com/in/me/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await humanWait(page, 4000);
  await humanCasualScroll(page, { steps: 2 });

  // Profilkép megnyitása (szerkesztés / hozzáadás).
  const photoBtn = await firstVisible(
    page,
    [
      'button[aria-label*="profile photo" i]',
      'button[aria-label*="profilkép" i]',
      'button:has-text("Add photo")',
      "button.pv-top-card-profile-picture__container",
      ".pv-top-card__non-self-photo-wrapper button",
      'img.pv-top-card-profile-picture__image',
    ],
    15000,
  );
  if (!photoBtn) throw new Error("Nem található a profilkép gomb a LinkedIn profilon.");
  await humanClick(page, photoBtn);
  await humanWait(page, 3000);

  // A megnyíló ablakban „Add photo” / „Change photo”.
  const changeBtn = await firstVisible(
    page,
    [
      'button:has-text("Add photo")',
      'button:has-text("Change photo")',
      'button:has-text("Fénykép hozzáadása")',
      '[aria-label*="Edit photo" i]',
    ],
    6000,
  );
  if (changeBtn) {
    await humanClick(page, changeBtn);
    await humanWait(page, 2000);
  }

  // A rejtett fájlmezőbe közvetlenül tesszük be a képet (nincs OS-ablak).
  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 15000 });
  await input.setInputFiles(filePath);
  log("info", "Kép átadva a LinkedIn fájlmezőjének.");
  await humanWait(page, 6000);

  if (!submit) {
    log("info", "Próbamenet — a kép be van töltve, de NEM mentettük el.");
    return { linkedin_profile_photo: { uploaded: true, saved: false } };
  }

  // Vágás elfogadása → mentés.
  for (const labels of [
    ['button:has-text("Next")', 'button:has-text("Tovább")'],
    [
      'button:has-text("Save photo")',
      'button:has-text("Save")',
      'button:has-text("Apply")',
      'button:has-text("Mentés")',
    ],
  ]) {
    const btn = await firstVisible(page, labels, 8000);
    if (btn) {
      await humanThink(page, 2000);
      await humanClick(page, btn);
      await humanWait(page, 5000);
    }
  }

  await humanWait(page, 6000);
  await humanCasualScroll(page, { steps: 2 });
  await humanBrowseMoment(page);

  log("info", "LinkedIn profilkép feltöltve.");
  return {
    linkedin_profile_photo: { uploaded: true, saved: true, url: page.url() },
  };
}
