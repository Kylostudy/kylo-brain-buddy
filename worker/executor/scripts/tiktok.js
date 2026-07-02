// worker/executor/scripts/tiktok.js
// TikTok stratégia: bejelentkezés cookie-val (preferált) vagy user/pass-szal,
// majd egy videó feltöltése a megadott média-forrásból.
//
// Ez a fájl a humanize.js modult használja MINDEN interakcióhoz, hogy
// Meta/TikTok bot-detektorok ne vadásszanak le. Nincs fix sleep, nincs
// egyenes kurzormozgás, nincs tökéletes gépelés.

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
  reseedHuman,
} from "./humanize.js";

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
  log("info", "Bejelentkezés felhasználónév + jelszóval — TikTok (emberi mód).");
  await page.goto("https://www.tiktok.com/login/phone-or-email/email", {
    waitUntil: "domcontentloaded",
  });
  // Rövid tájékozódás mielőtt bármihez nyúlna
  await humanBrowseMoment(page);

  const userInput = await page.waitForSelector('input[name="username"]', { timeout: 15000 });
  await humanClick(page, userInput);
  await humanType(page, username);
  await humanThink(page, 700);

  const passInput = await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  await humanClick(page, passInput);
  await humanType(page, password);
  await humanThink(page, 900);

  const submit = await page.waitForSelector('button[type="submit"]', { timeout: 15000 });
  await humanClick(page, submit);

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  const captcha = await page.$('div[class*="captcha"], iframe[src*="captcha"]');
  if (captcha) {
    throw new Error(
      "TikTok captcha jelent meg — cookie-alapú bejelentkezést használj.",
    );
  }
}

async function uploadVideo(page, filePath, caption, log) {
  log("info", "Upload Studio megnyitása (emberi böngészés).");
  await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=upload", {
    waitUntil: "domcontentloaded",
  });
  // Az ember először körbenéz az oldalon
  await humanBrowseMoment(page);

  // A file input rejtett — a fájlt közvetlenül a input-nak adjuk át
  // (a UI-n keresztüli drag&drop szimuláció Playwright-tal nem stabil és
  // maga a natív fájl-dialógus nem is emberi elem). A gyanúsítható rész
  // nem a setInputFiles, hanem a köré épített viselkedés — ott vagyunk emberiek.
  const input = await page.waitForSelector('input[type="file"]', {
    state: "attached",
    timeout: 30000,
  });
  await humanThink(page, 800);
  await input.setInputFiles(filePath);
  log("info", "Fájl átadva a feltöltőnek, kódolásra várunk…");

  // Amíg fut a feltöltés, "az ember" néz-nézeget
  await humanCasualScroll(page, { rounds: 2 });
  await humanThink(page, 1500);

  if (caption) {
    const captionBox = await page.waitForSelector(
      'div[contenteditable="true"][data-text="true"], div[contenteditable="true"]',
      { timeout: 60_000 },
    );
    await humanClick(page, captionBox);
    await humanThink(page, 500);
    await humanType(page, caption, { meanCharMs: 110 });
    log("info", "Caption beírva.");
    await humanThink(page, 900);
  }

  // Várunk az enabled Post gombra
  const postBtn = await page.waitForSelector(
    'button:has-text("Post"), button:has-text("Közzététel")',
    { timeout: 180_000 },
  );
  // Legfeljebb 5 percig várunk emberi módon, hogy engedélyezett legyen
  for (let i = 0; i < 60; i++) {
    const disabled = await postBtn.isDisabled();
    if (!disabled) break;
    // Közben az ember tesz-vesz
    if (i % 6 === 0) await humanCasualScroll(page, { rounds: 1 });
    await humanWait(page, 4500);
  }

  // Utolsó "átgondolom, tényleg posztolom?" pillanat
  await humanThink(page, 1400);
  await humanClick(page, postBtn, { noMisclick: true });
  log("info", "Post gomb megnyomva — várunk a megerősítésre.");

  await page
    .waitForSelector('text=/uploaded|posted|sikeresen/i', { timeout: 120_000 })
    .catch(() => {});
  log("info", "Feltöltés befejezve (vagy timeout — ellenőrizd a fiókban).");
}

export async function runTikTok({ page, context, spec, creds, log }) {
  if (!creds) throw new Error("Hiányzó hitelesítő adatok (creds).");

  // Run-specifikus seed — új véletlen minta minden futásnál
  reseedHuman([spec.account_label || "n/a", spec.workflow_id || "", Date.now()]);

  const media = spec.media_source;
  if (!media || !media.value) {
    throw new Error("spec.media_source.value hiányzik (videó URL vagy útvonal).");
  }

  // 1) Login
  if (creds.cookies) {
    await loginWithCookies(context, creds.cookies, log);
    await page.goto("https://www.tiktok.com/", { waitUntil: "domcontentloaded" });
    // Ne rohanjunk azonnal az upload URL-re — előbb "szörfölünk"
    await humanBrowseMoment(page);
  } else if (creds.username && creds.password) {
    await loginWithPassword(page, creds.username, creds.password, log);
  } else {
    throw new Error("Sem cookie, sem user+pass nincs megadva.");
  }

  // 2) Login-ellenőrzés
  await humanThink(page, 1500);
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
