// worker/executor/scripts/brain-tasks/reddit-register.js
//
// Reddit fiók REGISZTRÁCIÓ az adott ország proxyján, a korábban gyűjtött
// süticsomaggal (így nem "vadonatúj böngészőből" érkezünk).
//
// A spec.reddit_signup blokkból dolgozik:
//   { email, username, password }
// Ha nincs megadva, generál egy hihető felhasználónevet és erős jelszót.
//
// A Reddit gyakran captcha-t vagy e-mail megerősítést kér. A szkript
// NEM próbálja megkerülni: ha falba ütközik, tisztán jelenti, mi történt,
// és képernyőképet ad, hogy emberi kézzel be lehessen fejezni.

import {
  humanClick,
  humanThink,
  humanType,
  humanWait,
  humanCasualScroll,
  reseedHuman,
} from "../humanize.js";

const REGISTER_URL = "https://www.reddit.com/register/";

const ADJ = ["quiet", "sunny", "clever", "north", "urban", "brave", "amber", "silver", "rapid", "gentle"];
const NOUN = ["otter", "harbor", "willow", "canyon", "pixel", "ember", "meadow", "falcon", "lantern", "compass"];

function suggestUsername() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}_${n}_${100 + Math.floor(Math.random() * 900)}`;
}

function suggestPassword() {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!?$%";
  let out = "";
  for (let i = 0; i < 18; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
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

async function detectBlockers(page) {
  const out = [];
  try {
    if (await page.locator('iframe[src*="recaptcha"], iframe[title*="captcha" i]').count()) {
      out.push("captcha");
    }
    const errText = await page
      .locator('[role="alert"], .error, [class*="error" i]')
      .allTextContents()
      .catch(() => []);
    for (const t of errText) {
      const s = (t || "").trim();
      if (s && s.length < 200) out.push(s);
    }
  } catch {}
  return out;
}

export async function runRedditRegister({ page, spec, log }) {
  reseedHuman([spec?.workflow_id || "", "reddit-register", Date.now()]);

  const cfg = spec?.reddit_signup || {};
  const email = cfg.email || null;
  const username = cfg.username || suggestUsername();
  const password = cfg.password || suggestPassword();

  log("info", `Reddit regisztráció indul — felhasználónév: ${username}${email ? `, e-mail: ${email}` : " (e-mail nélkül)"}`);

  await page.goto(REGISTER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await humanWait(page, 2500);
  await acceptCookieBanner(page);
  await humanCasualScroll(page, { rounds: 1 }).catch(() => {});

  // 1. lépés — e-mail
  if (email) {
    try {
      const emailInput = page.locator('input[name="email"], input#register-email').first();
      await emailInput.waitFor({ state: "visible", timeout: 20000 });
      await humanClick(page, emailInput, { noMisclick: true });
      await humanType(page, email, { meanCharMs: 120 });
      await humanThink(page, 1500);
      const next = page.getByRole("button", { name: /continue|next/i }).first();
      if (await next.count().catch(() => 0)) {
        await humanClick(page, next, { timeout: 8000 });
        await humanWait(page, 3500);
      }
    } catch (e) {
      log("warn", `E-mail lépés hiba: ${e.message}`);
    }
  }

  // 2. lépés — felhasználónév + jelszó
  try {
    const userInput = page
      .locator('input[name="username"], input#register-username')
      .first();
    await userInput.waitFor({ state: "visible", timeout: 20000 });
    await humanClick(page, userInput, { noMisclick: true });
    await humanType(page, username, { meanCharMs: 140 });
    await humanThink(page, 1800);

    const passInput = page
      .locator('input[name="password"], input#register-password')
      .first();
    await humanClick(page, passInput, { noMisclick: true });
    await humanType(page, password, { meanCharMs: 110 });
    await humanThink(page, 2000);
  } catch (e) {
    const blockers = await detectBlockers(page);
    throw new Error(
      `A regisztrációs űrlap nem tölthető ki: ${e.message}${blockers.length ? ` — akadályok: ${blockers.join("; ")}` : ""}`,
    );
  }

  const preBlockers = await detectBlockers(page);
  if (preBlockers.includes("captcha")) {
    log("warn", "Captcha jelent meg az űrlapon — a beküldést megpróbáljuk, de valószínűleg emberi kéz kell.");
  }

  // 3. lépés — beküldés
  try {
    const submit = page
      .getByRole("button", { name: /sign up|continue|create account/i })
      .first();
    await humanClick(page, submit, { timeout: 10000 });
  } catch (e) {
    log("warn", `Beküldés gomb hiba: ${e.message}`);
  }
  await humanWait(page, 6000);
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await humanWait(page, 4000);

  const finalUrl = page.url();
  const blockers = await detectBlockers(page);
  const success = !/\/register/i.test(finalUrl) && blockers.length === 0;

  log(
    success ? "info" : "warn",
    success
      ? `Regisztráció valószínűleg sikeres — új URL: ${finalUrl}`
      : `A regisztráció nem fejeződött be. URL: ${finalUrl}${blockers.length ? ` — akadályok: ${blockers.join("; ")}` : ""}`,
  );

  return {
    reddit_register: {
      username,
      // A jelszót visszaadjuk, hogy a Brain titkosítva el tudja menteni.
      password,
      email,
      success,
      final_url: finalUrl,
      blockers,
    },
  };
}
