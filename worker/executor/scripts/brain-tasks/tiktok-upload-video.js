// worker/executor/scripts/brain-tasks/tiktok-upload-video.js
//
// TikTok videó feltöltés — EMBERI koreográfiával (Pinterest/LinkedIn mintára).
//
// A workflow SOSEM megy egyenesen az upload URL-re. Előtte "él" a fiókon:
//   1) belép a For You feedbe, néz 1-2 videót, görget
//   2) benéz a Creator Center / Analytics-be
//   3) megnyitja a saját profilját, ránéz a korábbi videóira
//   4) CSAK EZUTÁN nyitja az Upload Studio-t
//   5) fájl upload → caption kitöltés → Post
//   6) publikálás után is marad még: For You feed görgetés
//
// Így a TikTok nem lát "belépett → 3 mp múlva feltöltött" botmintát,
// hanem valódi felhasználó munkamenetét.
//
// spec.brain_task mezők:
//   task_type: "upload_video"
//   platform:  "tiktok"
//   media: { kind: "url"|"path", value: "..." }   (kötelező)
//   caption: string                                (opcionális, ajánlott)
//
// A creds.cookies kötelező (recorder session-ből mentett TikTok sütik —
// ugyanaz a Dolphin profil, mint a Pinterest).

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  humanClick,
  humanType,
  humanWait,
  humanThink,
  humanBrowseMoment,
  humanCasualScroll,
  humanIdleDrift,
  reseedHuman,
} from "../humanize.js";

const PLATFORM = "tiktok";

async function downloadToTemp(url, log) {
  const dir = await mkdtemp(join(tmpdir(), "kylo-tiktok-"));
  const fname = url.split("/").pop()?.split("?")[0] || "video.mp4";
  const fpath = join(dir, fname);
  log("info", `Videó letöltése: ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Letöltés HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(fpath));
  return fpath;
}

async function loadCookies(context, cookiesRaw, log) {
  let parsed;
  try {
    parsed = typeof cookiesRaw === "string" ? JSON.parse(cookiesRaw) : cookiesRaw;
  } catch {
    throw new Error("A TikTok cookie nem érvényes JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("A cookie tömb kell, hogy legyen.");
  const cookies = parsed.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || ".tiktok.com",
    path: c.path || "/",
    expires: typeof c.expirationDate === "number" ? c.expirationDate : c.expires ?? -1,
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
    sameSite:
      c.sameSite === "no_restriction" || c.sameSite === "None"
        ? "None"
        : c.sameSite === "lax" || c.sameSite === "Lax"
        ? "Lax"
        : "Strict",
  }));
  await context.addCookies(cookies);
  log("info", `TikTok sütik betöltve (${cookies.length} db).`);
}

async function ensureLoggedIn(page, log) {
  const url = page.url();
  if (/\/login|\/signup/.test(url)) {
    throw new Error(
      `TikTok login oldalra dobott (${url}) — a mentett süti lejárt, újra kell rögzíteni a recorderrel.`,
    );
  }
  const profile = await page
    .waitForSelector(
      '[data-e2e="profile-icon"], [data-e2e="nav-profile"], a[href*="/profile"], div[data-e2e="recommend-list-item-container"]',
      { timeout: 10000 },
    )
    .catch(() => null);
  if (!profile) {
    log("warn", "Nem találtam profil-ikont — lehet, hogy nincs bejelentkezve.");
  } else {
    log("info", "Bejelentkezve. ✅");
  }
}

// ---------- EMBERI KÖRÍTÉS ----------

async function browseForYou(page, log) {
  log("info", "For You feed böngészés — tájékozódás");
  await page.goto("https://www.tiktok.com/foryou", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await humanThink(page, 2000);
  await humanCasualScroll(page, { rounds: 3 });
  await humanIdleDrift(page);
  await humanCasualScroll(page, { rounds: 2 });
  await humanBrowseMoment(page);
}

async function peekCreatorCenter(page, log) {
  log("info", "Creator Center / Analytics benézés");
  try {
    await page.goto("https://www.tiktok.com/tiktokstudio/analytics", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await humanThink(page, 2200);
    await humanCasualScroll(page, { rounds: 2 });
    await humanIdleDrift(page);
    await humanWait(page, 1500);
  } catch (e) {
    log("warn", `Analytics benézés kihagyva: ${e.message}`);
  }
}

async function peekOwnProfile(page, log) {
  log("info", "Saját profil megnyitása — ránéz a korábbi videóira");
  try {
    const profileLink = await page.$('[data-e2e="nav-profile"], a[href*="/@"]');
    if (profileLink) {
      await humanClick(page, profileLink);
    } else {
      await page.goto("https://www.tiktok.com/profile", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    }
    await humanWait(page, 1800);
    await humanCasualScroll(page, { rounds: 2 });
    await humanIdleDrift(page);
    await humanWait(page, 1200);
  } catch (e) {
    log("warn", `Profil benézés kihagyva: ${e.message}`);
  }
}

// ---------- FELTÖLTÉS ----------

async function uploadVideo(page, filePath, caption, log) {
  log("info", "Upload Studio megnyitása");
  await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=upload", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await humanBrowseMoment(page);

  const input = await page.waitForSelector('input[type="file"]', {
    state: "attached",
    timeout: 30000,
  });
  await humanThink(page, 900);
  log("info", `Videó fájl átadása a feltöltőnek: ${filePath}`);
  await input.setInputFiles(filePath);

  // Míg fel/kódol, "az ember" tesz-vesz
  await humanCasualScroll(page, { rounds: 2 });
  await humanThink(page, 1500);

  if (caption) {
    const captionBox = await page
      .waitForSelector(
        'div[contenteditable="true"][data-text="true"], div[contenteditable="true"]',
        { timeout: 120_000 },
      )
      .catch(() => null);
    if (captionBox) {
      await humanClick(page, captionBox);
      await humanThink(page, 500);
      await humanType(page, caption, { meanCharMs: 110 });
      log("info", "Caption beírva.");
      await humanThink(page, 900);
    } else {
      log("warn", "Caption mezőt nem találtam, kihagyva.");
    }
  }

  // Post gomb — engedélyezettségre várunk
  const postBtn = await page.waitForSelector(
    'button[data-e2e="post_video_button"], button:has-text("Post"), button:has-text("Közzététel")',
    { timeout: 180_000 },
  );
  for (let i = 0; i < 60; i++) {
    const disabled = await postBtn.isDisabled().catch(() => false);
    if (!disabled) break;
    if (i % 6 === 0) await humanCasualScroll(page, { rounds: 1 });
    await humanWait(page, 4500);
  }

  await humanThink(page, 1400);
  await humanClick(page, postBtn, { noMisclick: true });
  log("info", "Post gomb megnyomva — várunk a megerősítésre.");

  const confirmed = await Promise.race([
    page
      .waitForSelector(
        'div:has-text("Your video is being uploaded"), div:has-text("uploaded"), div:has-text("posted"), div:has-text("sikeresen")',
        { timeout: 120_000 },
      )
      .then(() => "toast"),
    page.waitForURL(/tiktokstudio\/content|\/upload\?/, { timeout: 120_000 }).then(() => "url"),
  ]).catch(() => null);

  if (confirmed) {
    log("info", `Feltöltés megerősítve (${confirmed}).`);
  } else {
    log("warn", "Megerősítést nem láttam — ellenőrizd a fiókban.");
  }

  return { confirmed: !!confirmed };
}

// ---------- FŐ BELÉPÉSI PONT ----------

async function runTikTokUploadVideo({ page, context, spec, creds, log }) {
  const bt = spec.brain_task || {};
  const media = bt.media || spec.media_source;
  if (!media || !media.value) {
    throw new Error("brain_task.media.value (videó URL vagy útvonal) hiányzik.");
  }
  if (!creds?.cookies)
    throw new Error("TikTok cookie hiányzik — recorderrel kell egyszer bejelentkezni.");

  reseedHuman([spec.account_label || "n/a", spec.workflow_id || "", Date.now()]);

  // 1) Cookie + For You feed
  await loadCookies(context, creds.cookies, log);
  await browseForYou(page, log);
  await ensureLoggedIn(page, log);

  // 2) Analytics / Creator Center benézés
  await peekCreatorCenter(page, log);

  // 3) Saját profil
  await peekOwnProfile(page, log);

  // 4) Videó fájl
  const filePath =
    media.kind === "url" ? await downloadToTemp(media.value, log) : media.value;

  // 5) TÉNYLEGES upload
  const uploadResult = await uploadVideo(
    page,
    filePath,
    bt.caption || spec.caption || "",
    log,
  );

  // 6) Utólagos böngészés — nem tűnik el azonnal
  log("info", "Utólagos böngészés — For You feed görgetés");
  try {
    await page.goto("https://www.tiktok.com/foryou", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await humanWait(page, 1500);
    await humanCasualScroll(page, { rounds: 3 });
    await humanIdleDrift(page);
    await humanBrowseMoment(page);
  } catch (e) {
    log("warn", `Utólagos böngészés kihagyva: ${e.message}`);
  }

  // Friss sütik visszaadása — keep-alive
  const cookies = await context.cookies();

  return {
    platform: PLATFORM,
    uploaded: uploadResult.confirmed ? 1 : 0,
    confirmed: uploadResult.confirmed,
    cookies_export: JSON.stringify(cookies),
    cookies_collected: cookies.length,
  };
}

export { runTikTokUploadVideo };
