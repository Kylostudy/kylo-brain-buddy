// worker/executor/scripts/kylo-signup.js
//
// Kylo.study "Sign Up" workflow futás — MVP.
//
// Feladat: a proxyn keresztül megnyitni a főoldalt a kapott nyelvi (?lang=)
// paraméterrel, majd best-effort módon végigmenni a regisztráció lépésein:
//   1) főoldal → cookie banner elfogadása
//   2) "Regisztráció" / "Sign up" gomb / link keresése és kattintás
//   3) email + jelszó űrlap kitöltése
//   4) skin választó megkeresése és az elvárt skinre állítás
//   5) próbálkozás a Stripe fizetési oldalig eljutni (checkout / előfizetés)
//
// Minden lépésnél screenshotot csinálunk (base64 JPEG a result-ba), így a UI-ban
// azonnal látszik, hogy meddig jutott. A selektorok szándékosan defenzívek —
// ha a Kylo UI változik, a script továbbmegy, amíg lehet, és a result-ban
// jelzi, melyik lépés nem talált célt.

const CLICK_HINTS_SIGNUP = [
  "sign up", "signup", "sign-up", "regisztráció", "regisztrálok", "regisztrál",
  "create account", "get started", "kezdés", "próbáld ki", "próbald ki",
  "regisztráljon", "kezdjük",
];

const CLICK_HINTS_SUBSCRIBE = [
  "előfizetés", "elofizetes", "előfizetek", "elofizetek", "vásárlás", "vasarlas",
  "subscribe", "checkout", "buy", "start plan", "get plan", "upgrade",
  "csomag választása", "csomag valasztasa", "select plan",
];

const COOKIE_BUTTONS = [
  'button:has-text("Elfogadom")',
  'button:has-text("Elfogadás")',
  'button:has-text("Rendben")',
  'button:has-text("OK")',
  'button:has-text("Accept")',
  'button:has-text("Accept all")',
  'button:has-text("I agree")',
];

function withLang(baseUrl, lang) {
  try {
    const u = new URL(baseUrl);
    u.searchParams.set("lang", lang || "en-GB");
    return u.toString();
  } catch {
    return baseUrl;
  }
}

async function shot(page, label) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
    return { label, at: new Date().toISOString(), b64: buf.toString("base64") };
  } catch (e) {
    return { label, at: new Date().toISOString(), error: e.message };
  }
}

async function acceptCookies(page, log) {
  for (const sel of COOKIE_BUTTONS) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({ timeout: 1500 });
        log("info", `Cookie banner elfogadva: ${sel}`);
        await page.waitForTimeout(600);
        return true;
      }
    } catch {}
  }
  return false;
}

// Keres egy kattintható elemet, aminek a szövege tartalmazza a hint-ek
// valamelyikét (case-insensitive). Először button/link/role=button elemeket
// nézünk, aztán bármit.
async function clickByText(page, hints, log, label) {
  const lowerHints = hints.map((h) => h.toLowerCase());
  const found = await page.evaluate((lowerHints) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const nodes = Array.from(
      document.querySelectorAll(
        'a, button, [role="button"], input[type="submit"], input[type="button"]',
      ),
    );
    for (const el of nodes) {
      const t = norm(el.innerText || el.value || "");
      if (!t) continue;
      if (lowerHints.some((h) => t.includes(h))) {
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) continue;
        el.scrollIntoView({ block: "center" });
        return { text: t.slice(0, 80), tag: el.tagName.toLowerCase() };
      }
    }
    return null;
  }, lowerHints);
  if (!found) {
    log("warn", `Nem találtam ${label} gombot / linket.`);
    return false;
  }
  // Kattintás DOM-on át, hogy elkerüljük a Playwright strictness-t.
  await page.evaluate((lowerHints) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const nodes = Array.from(
      document.querySelectorAll(
        'a, button, [role="button"], input[type="submit"], input[type="button"]',
      ),
    );
    for (const el of nodes) {
      const t = norm(el.innerText || el.value || "");
      if (t && lowerHints.some((h) => t.includes(h))) {
        el.click();
        return;
      }
    }
  }, lowerHints);
  log("info", `${label} kattintva: „${found.text}" (${found.tag})`);
  await page.waitForTimeout(1500);
  return true;
}

// Beírja az emailt és jelszót az első általunk felismert űrlapba.
async function fillSignupForm(page, email, password, log) {
  const filled = await page.evaluate(({ email, password }) => {
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const emailFields = q('input[type="email"], input[name*="mail" i], input[id*="mail" i], input[placeholder*="mail" i]');
    const pwFields = q('input[type="password"]');
    let e = 0, p = 0;
    for (const el of emailFields.slice(0, 1)) {
      el.focus();
      el.value = email;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      e = 1;
    }
    for (const el of pwFields.slice(0, 2)) {
      el.focus();
      el.value = password;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      p++;
    }
    return { emailFields: emailFields.length, pwFields: pwFields.length, filledEmail: e, filledPw: p };
  }, { email, password });
  log("info", `Űrlap kitöltés — email mezők: ${filled.emailFields}, jelszó mezők: ${filled.pwFields}, kitöltve: email=${filled.filledEmail}, pw=${filled.filledPw}`);
  return filled.filledEmail > 0 && filled.filledPw > 0;
}

// Megpróbálja a submit / regisztráció megerősítő gombot megnyomni.
async function submitForm(page, log) {
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(
      'button[type="submit"], input[type="submit"], form button',
    ));
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      b.click();
      return true;
    }
    return false;
  });
  if (clicked) {
    log("info", "Regisztráció submit megnyomva.");
    await page.waitForTimeout(2500);
    return true;
  }
  log("warn", "Nem találtam submit gombot az űrlapban.");
  return false;
}

export async function runKyloSignup({ page, context, spec, log }) {
  const cfg = spec.kylo_signup || {};
  const baseUrl = cfg.base_url || "https://kylo.study";
  const lang = cfg.lang || "en-GB";
  const skin = cfg.skin || "puppy-cat";
  const email = cfg.email;
  const password = cfg.password;
  const currency = cfg.currency || "USD";

  if (!email || !password) {
    throw new Error("Hiányzó email / jelszó a signup spec-ből.");
  }

  const steps = [];
  const screenshots = [];
  const startUrl = withLang(baseUrl, lang);

  log("info", `Sign Up indul — ${startUrl} · skin=${skin} · alias=${email} · currency=${currency}`);

  // 1) főoldal
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  screenshots.push(await shot(page, "1-home"));
  steps.push({ step: "home", url: page.url() });

  await acceptCookies(page, log);

  // 2) sign-up gomb
  const signupClicked = await clickByText(page, CLICK_HINTS_SIGNUP, log, "Sign Up / Regisztráció");
  await page.waitForTimeout(1200);
  screenshots.push(await shot(page, "2-after-signup-click"));
  steps.push({ step: "signup-cta", clicked: signupClicked, url: page.url() });

  // 3) űrlap kitöltés
  const filled = await fillSignupForm(page, email, password, log);
  screenshots.push(await shot(page, "3-form-filled"));
  steps.push({ step: "form-fill", filled });

  if (filled) {
    await submitForm(page, log);
    await page.waitForTimeout(3000);
    screenshots.push(await shot(page, "4-after-submit"));
    steps.push({ step: "submit", url: page.url() });
  }

  // 4) skin — ide még nem építünk be UI-t, csak localStorage seed
  try {
    await page.evaluate((s) => {
      try {
        localStorage.setItem("selectedSkin", s === "alaszka" ? "alaszka" : "puppy_cat");
        document.documentElement.setAttribute("data-skin", s === "alaszka" ? "alaszka" : "puppy_cat");
      } catch {}
    }, skin);
    log("info", `Skin seed elmentve: ${skin}`);
  } catch {}

  // 5) próbáljunk eljutni a Stripe / előfizetés oldalig
  const subClicked = await clickByText(page, CLICK_HINTS_SUBSCRIBE, log, "Előfizetés / Checkout");
  await page.waitForTimeout(3500);
  screenshots.push(await shot(page, "5-after-subscribe-click"));
  const finalUrl = page.url();
  const reachedStripe = /checkout\.stripe\.com|stripe\.com/.test(finalUrl);
  steps.push({ step: "subscribe-cta", clicked: subClicked, url: finalUrl, reached_stripe: reachedStripe });

  log(reachedStripe ? "info" : "warn", `Végállomás: ${finalUrl} · Stripe elérve: ${reachedStripe ? "IGEN" : "NEM"}`);

  return {
    ok: true,
    email,
    skin,
    lang,
    currency,
    reached_stripe: reachedStripe,
    final_url: finalUrl,
    steps,
    screenshots,
  };
}
