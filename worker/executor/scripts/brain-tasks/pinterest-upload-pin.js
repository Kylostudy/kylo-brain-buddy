// worker/executor/scripts/brain-tasks/pinterest-upload-pin.js
//
// Pinterest pin (videó vagy kép) feltöltés — EMBERI koreográfiával.
//
// A workflow SOSEM megy egyenesen az upload URL-re. Előtte "él" a fiókon:
//   1) belép a home feedbe, olvasgat, görget
//   2) benéz a Business Analytics-be (a top pinjeit megnézi)
//   3) megnyit 1-2 pint a feedből
//   4) CSAK EZUTÁN nyitja a pin creation tool-t
//   5) upload → cím/leírás/board/link kitöltés → publikálás
//   6) publikálás után is marad még: visszamegy a feedre és görget
//
// Így a Pinterest nem lát "belépett és 3 mp múlva feltöltött" botmintát,
// hanem egy valódi felhasználó munkamenetét.
//
// spec.brain_task mezők:
//   task_type: "upload_pin"
//   media: { kind: "url"|"path", value: "...", }
//   title:        string   (kötelező, max 100)
//   description:  string   (opcionális, max 500)
//   destination_link: string (opcionális, ide vezet ha valaki rákattint)
//   board_name:   string   (opcionális; ha nincs, az utolsó használt board)
//
// A creds.cookies kötelező (recorder session-ből mentett Pinterest sütik).

import { writeFile, mkdtemp } from "node:fs/promises";
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

const PLATFORM = "pinterest";

async function downloadToTemp(url, log) {
  const dir = await mkdtemp(join(tmpdir(), "kylo-pin-"));
  const fname = url.split("/").pop()?.split("?")[0] || "media.mp4";
  const fpath = join(dir, fname);
  log("info", `Médiafájl letöltése: ${url}`);
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
    throw new Error("A Pinterest cookie nem érvényes JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("A cookie tömb kell, hogy legyen.");
  const cookies = parsed.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || ".pinterest.com",
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
  log("info", `Pinterest sütik betöltve (${cookies.length} db).`);
}

async function ensureLoggedIn(page, log) {
  const url = page.url();
  if (/\/login|\/signup/.test(url)) {
    throw new Error(
      `Pinterest login oldalra dobott (${url}) — a mentett süti lejárt, újra kell rögzíteni a recorderrel.`,
    );
  }
  // Profil ikon / avatar keresése a fejlécben
  const avatar = await page
    .waitForSelector('div[data-test-id="header-profile"], a[href*="/settings/"], img[data-test-id="user-avatar"]', {
      timeout: 8000,
    })
    .catch(() => null);
  if (!avatar) {
    log("warn", "Nem találtam profil-avatart — lehet, hogy nincs bejelentkezve.");
  } else {
    log("info", "Bejelentkezve. ✅");
  }
}

// ---------- EMBERI KÖRÍTÉS ----------

async function browseFeed(page, log) {
  log("info", "Feed böngészés — home tab, tájékozódás");
  await page.goto("https://www.pinterest.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await humanThink(page, 1800);
  await humanCasualScroll(page, { rounds: 3 });
  await humanIdleDrift(page);
  await humanCasualScroll(page, { rounds: 2 });
  await humanBrowseMoment(page);
}

async function peekAnalytics(page, log) {
  log("info", "Analytics benézés — mint egy tulajdonos, aki figyeli a számait");
  try {
    await page.goto("https://www.pinterest.com/business/hub/analytics/", {
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

async function openRandomPin(page, log) {
  log("info", "Egy pint megnyit a feedből (olvasás közbeni természetes viselkedés)");
  try {
    await page.goto("https://www.pinterest.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanWait(page, 1500);
    await humanCasualScroll(page, { rounds: 2 });
    const pinLinks = await page.$$('a[href*="/pin/"]');
    if (pinLinks.length === 0) {
      log("info", "Nem találtam pin-linket a feedben — kihagyjuk");
      return;
    }
    const pick = pinLinks[Math.floor(Math.random() * Math.min(pinLinks.length, 10))];
    await humanClick(page, pick);
    await humanThink(page, 2500);
    await humanCasualScroll(page, { rounds: 2 });
    await humanIdleDrift(page);
    await humanWait(page, 1200);
    // vissza
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await humanWait(page, 1200);
  } catch (e) {
    log("warn", `Pin megnyitás kihagyva: ${e.message}`);
  }
}

// ---------- FELTÖLTÉS ----------

async function uploadPin(page, filePath, meta, log) {
  log("info", "Pin creation tool megnyitása");
  await page.goto("https://www.pinterest.com/pin-creation-tool/", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await humanThink(page, 2000);

  // File input — Pinterest hidden input, közvetlen setInputFiles
  const fileInput = await page
    .waitForSelector('input[type="file"]', { timeout: 20000 })
    .catch(() => null);
  if (!fileInput) throw new Error("Nem találtam a fájlfeltöltő inputot a pin creation tool-on.");
  log("info", `Médiafájl feltöltése: ${filePath}`);
  await fileInput.setInputFiles(filePath);

  // Feltöltés processing — Pinterest videónál percekig is eltarthat
  log("info", "Feldolgozásra várunk (max 4 perc)...");
  const titleInput = await page
    .waitForSelector(
      '[data-test-id="pin-draft-title"] textarea, textarea[placeholder*="title" i], textarea[placeholder*="cím" i], input[name="title"]',
      { timeout: 240000 },
    )
    .catch(() => null);
  if (!titleInput) {
    log("warn", "Nem találtam a cím mezőt — a feltöltés talán még folyamatban, vagy megváltozott a UI.");
  }
  await humanThink(page, 1500);

  // Cím
  if (titleInput && meta.title) {
    await humanClick(page, titleInput);
    await humanType(page, meta.title.slice(0, 100));
    await humanThink(page, 800);
  }

  // Leírás
  if (meta.description) {
    const descInput = await page
      .$(
        '[data-test-id="pin-draft-description"] [contenteditable="true"], [data-test-id="pin-draft-description"] textarea, textarea[placeholder*="description" i], textarea[placeholder*="leírás" i]',
      )
      .catch(() => null);
    if (descInput) {
      await humanClick(page, descInput);
      await humanType(page, meta.description.slice(0, 500));
      await humanThink(page, 700);
    } else {
      log("warn", "Leírás mezőt nem találtam, kihagyva");
    }
  }

  // Destination link
  if (meta.destination_link) {
    const linkInput = await page
      .$('[data-test-id="pin-draft-link"] input, input[placeholder*="link" i], input[name*="link" i]')
      .catch(() => null);
    if (linkInput) {
      await humanClick(page, linkInput);
      await humanType(page, meta.destination_link);
      await humanThink(page, 500);
    } else {
      log("warn", "Link mezőt nem találtam, kihagyva");
    }
  }

  // Board választás (opcionális) — ha nincs megadva, marad az utolsó
  if (meta.board_name) {
    try {
      const boardBtn = await page.$(
        '[data-test-id="board-dropdown-select-button"], button[data-test-id="pin-draft-board-picker"]',
      );
      if (boardBtn) {
        await humanClick(page, boardBtn);
        await humanWait(page, 800);
        const searchBox = await page
          .waitForSelector('input[placeholder*="board" i], input[data-test-id="board-picker-search-input"]', { timeout: 5000 })
          .catch(() => null);
        if (searchBox) {
          await humanClick(page, searchBox);
          await humanType(page, meta.board_name);
          await humanWait(page, 900);
        }
        // Első találatot választjuk
        const firstBoard = await page
          .waitForSelector(`[data-test-id="board-row"], div[role="button"]:has-text("${meta.board_name}")`, {
            timeout: 5000,
          })
          .catch(() => null);
        if (firstBoard) {
          await humanClick(page, firstBoard);
          await humanThink(page, 800);
        }
      }
    } catch (e) {
      log("warn", `Board választás kihagyva: ${e.message}`);
    }
  }

  // Publish gomb
  const publish = await page
    .waitForSelector(
      '[data-test-id="board-dropdown-save-button"], button[data-test-id="pin-draft-publish-button"], button:has-text("Publish"), button:has-text("Közzététel")',
      { timeout: 15000 },
    )
    .catch(() => null);
  if (!publish) throw new Error("Nem találtam a Publish gombot.");
  await humanThink(page, 1200);
  await humanClick(page, publish);
  log("info", "Publish gomb megnyomva — várjuk a megerősítést");

  // Megerősítés — pin URL vagy toast
  const confirmed = await Promise.race([
    page.waitForURL(/\/pin\//, { timeout: 60000 }).then(() => "url"),
    page
      .waitForSelector('div[role="alert"]:has-text("Published"), div:has-text("Your Pin was published")', {
        timeout: 60000,
      })
      .then(() => "toast"),
  ]).catch(() => null);

  if (confirmed) {
    log("info", `Publikálás sikeres (${confirmed}). URL: ${page.url()}`);
  } else {
    log("warn", "Publikálás megerősítést nem láttam — ellenőrizd manuálisan.");
  }

  return { pin_url: /\/pin\//.test(page.url()) ? page.url() : null };
}

// ---------- FŐ BELÉPÉSI PONT ----------

async function runPinterestUploadPin({ page, context, spec, creds, log }) {
  const bt = spec.brain_task || {};
  const media = bt.media || spec.media_source;
  if (!media || !media.value) {
    throw new Error("brain_task.media.value (videó/kép URL vagy útvonal) hiányzik.");
  }
  if (!bt.title) throw new Error("brain_task.title hiányzik (Pinterest pinhez kötelező).");
  if (!creds?.cookies)
    throw new Error("Pinterest cookie hiányzik — recorderrel kell egyszer bejelentkezni.");

  reseedHuman([spec.account_label || "n/a", spec.workflow_id || "", Date.now()]);

  // 1) Cookie betöltés + home feed
  await loadCookies(context, creds.cookies, log);
  await browseFeed(page, log);
  await ensureLoggedIn(page, log);

  // 2) Analytics benézés (~50% esély, hogy tovább is görgetjük)
  await peekAnalytics(page, log);

  // 3) Egy random pin megnyitása
  await openRandomPin(page, log);

  // 4) Médiafájl előkészítése
  const filePath =
    media.kind === "url" ? await downloadToTemp(media.value, log) : media.value;

  // 5) TÉNYLEGES upload
  const uploadResult = await uploadPin(
    page,
    filePath,
    {
      title: bt.title,
      description: bt.description,
      destination_link: bt.destination_link,
      board_name: bt.board_name,
    },
    log,
  );

  // 6) Utólagos böngészés — nem tűnik el azonnal
  log("info", "Utólagos böngészés — visszamegy a feedre és görget még");
  try {
    await page.goto("https://www.pinterest.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanWait(page, 1500);
    await humanCasualScroll(page, { rounds: 3 });
    await humanIdleDrift(page);
    await humanBrowseMoment(page);
  } catch (e) {
    log("warn", `Utólagos böngészés kihagyva: ${e.message}`);
  }

  // Friss sütik visszaadása — a Brain menti (keep-alive effektus)
  const cookies = await context.cookies();

  return {
    platform: PLATFORM,
    uploaded: 1,
    pin_url: uploadResult.pin_url,
    cookies_export: JSON.stringify(cookies),
    cookies_collected: cookies.length,
  };
}

export { runPinterestUploadPin };
