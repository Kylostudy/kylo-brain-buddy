// worker/executor/scripts/tiktok.js
// TikTok stratégia: bejelentkezés cookie-val (preferált) vagy user/pass-szal,
// majd egy videó feltöltése a megadott média-forrásból.
//
// Hívási konvenció: runTikTok({ page, context, spec, creds, log }).
//  - creds: { username, password, cookies, totpSecret } — bármelyik hiányozhat
//  - spec.media_source: { kind: 'url' | 'path', value: string, caption?: string }
//
// Ez a szkript a worker-konténerben fut, ahol a Playwright valódi Chromium-mal
// dolgozik. NE logold a jelszót vagy a TOTP-titkot.

import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

async function downloadToTemp(url, log) {
  const dir = await mkdtemp(join(tmpdir(), "kylo-media-"));
  const fname = url.split("/").pop()?.split("?")[0] || "media.bin";
  const fpath = join(dir, fname);
  log("info", `Médiafájl letöltése: ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Letöltés ${res.status}`);
  await pipeline(res.body, createWriteStream(fpath));
  return fpath;
}

async function loginWithCookies(context, cookiesRaw, log) {
  let parsed;
  try {
    parsed = typeof cookiesRaw === "string" ? JSON.parse(cookiesRaw) : cookiesRaw;
  } catch {
    throw new Error("A cookie nem érvényes JSON. EditThisCookie export kell.");
  }
  if (!Array.isArray(parsed)) throw new Error("A cookie tömb kell, hogy legyen.");
  // Playwright cookie shape mapping (EditThisCookie/Chrome formátumra felkészülünk)
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
  log("info", `Bejelentkezés cookie-val (${cookies.length} db) — TikTok.`);
}

async function loginWithPassword(page, username, password, log) {
  log("info", "Bejelentkezés felhasználónév + jelszóval — TikTok.");
  await page.goto("https://www.tiktok.com/login/phone-or-email/email", {
    waitUntil: "domcontentloaded",
  });
  // emberi várás
  await page.waitForTimeout(1200 + Math.random() * 800);
  await page.fill('input[name="username"]', username, { timeout: 15000 });
  await page.waitForTimeout(400 + Math.random() * 400);
  await page.fill('input[type="password"]', password, { timeout: 15000 });
  await page.waitForTimeout(600 + Math.random() * 600);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  // Captcha figyelmeztetés
  const captcha = await page.$('div[class*="captcha"], iframe[src*="captcha"]');
  if (captcha) {
    throw new Error(
      "TikTok captcha jelent meg — cookie-alapú bejelentkezést használj.",
    );
  }
}

async function uploadVideo(page, filePath, caption, log) {
  log("info", "Upload Studio megnyitása.");
  await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=upload", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);

  // A file input rejtett — direktbe töltjük a fájlt
  const input = await page.waitForSelector('input[type="file"]', {
    state: "attached",
    timeout: 30000,
  });
  await input.setInputFiles(filePath);
  log("info", "Fájl átadva a feltöltőnek, kódolásra várunk…");

  // Caption mező megjelenésére várunk
  if (caption) {
    const captionBox = await page.waitForSelector(
      'div[contenteditable="true"][data-text="true"], div[contenteditable="true"]',
      { timeout: 60_000 },
    );
    await captionBox.click();
    await page.keyboard.type(caption, { delay: 40 });
    log("info", "Caption beírva.");
  }

  // Várjuk az enabled Post gombot
  const postBtn = await page.waitForSelector(
    'button:has-text("Post"), button:has-text("Közzététel")',
    { timeout: 180_000 },
  );
  // 5 percig várunk, hogy enabled legyen
  for (let i = 0; i < 60; i++) {
    const disabled = await postBtn.isDisabled();
    if (!disabled) break;
    await page.waitForTimeout(5000);
  }
  await postBtn.click();
  log("info", "Post gomb megnyomva — várunk a megerősítésre.");

  await page
    .waitForSelector('text=/uploaded|posted|sikeresen/i', { timeout: 120_000 })
    .catch(() => {});
  log("info", "Feltöltés befejezve (vagy timeout — ellenőrizd a fiókban).");
}

export async function runTikTok({ page, context, spec, creds, log }) {
  if (!creds) throw new Error("Hiányzó hitelesítő adatok (creds).");

  const media = spec.media_source;
  if (!media || !media.value) {
    throw new Error("spec.media_source.value hiányzik (videó URL vagy útvonal).");
  }

  // 1) Login
  if (creds.cookies) {
    await loginWithCookies(context, creds.cookies, log);
    await page.goto("https://www.tiktok.com/", { waitUntil: "domcontentloaded" });
  } else if (creds.username && creds.password) {
    await loginWithPassword(page, creds.username, creds.password, log);
  } else {
    throw new Error("Sem cookie, sem user+pass nincs megadva.");
  }

  // 2) Login-ellenőrzés
  await page.waitForTimeout(2000);
  const loggedIn = await page.$(
    'a[href*="/profile"], [data-e2e="profile-icon"], [data-e2e="nav-profile"]',
  );
  if (!loggedIn) {
    log("warn", "Nem találtam profile-ikont — lehet, hogy a login nem sikerült.");
  } else {
    log("info", "Bejelentkezve. ✅");
  }

  // 3) Médiafájl előkészítése
  const filePath =
    media.kind === "url" ? await downloadToTemp(media.value, log) : media.value;

  // 4) Upload
  await uploadVideo(page, filePath, media.caption || spec.caption || "", log);

  return { uploaded: 1, platform: "TikTok" };
}
