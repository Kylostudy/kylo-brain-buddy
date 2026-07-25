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

import { getGmailConfirmationLink } from "./brain-tasks/brain-api.js";

const CLICK_HINTS_SIGNUP = [
  "sign up", "signup", "sign-up", "regisztráció", "regisztrálok", "regisztrál",
  "create account", "get started", "kezdés", "próbáld ki", "próbald ki",
  "regisztráljon", "kezdjük", "start", "start now", "start free", "try free",
  "try it free", "join", "join now", "let's go", "lets go", "begin",
  // JP
  "登録", "新規登録", "会員登録", "無料登録", "サインアップ", "始める", "はじめる", "続ける",
  // ZH
  "注册", "註冊", "免费注册", "免費註冊", "开始", "開始", "立即开始", "立即開始",
  // ES / PT / IT / DE / FR / RU / TR / PL
  "registrarse", "registro", "crear cuenta", "empezar", "comenzar",
  "cadastrar", "cadastro", "criar conta", "começar",
  "registrati", "iscriviti", "inizia",
  "registrieren", "konto erstellen", "loslegen", "starten",
  "s'inscrire", "inscription", "créer un compte", "commencer",
  "регистрация", "зарегистрироваться", "начать",
  "kaydol", "üye ol", "başla",
  "zarejestruj", "rejestracja", "utwórz konto", "zacznij",
];

const CLICK_HINTS_SUBSCRIBE = [
  "előfizetés", "elofizetes", "előfizetek", "elofizetek", "vásárlás", "vasarlas",
  "subscribe", "checkout", "buy", "start plan", "get plan", "upgrade",
  "csomag választása", "csomag valasztasa", "select plan", "choose plan",
  "続ける", "購入", "サブスクライブ", "订阅", "訂閱", "购买", "購買",
  "suscribirse", "suscripción", "assinar", "abbonati", "abonnieren",
  "s'abonner", "подписаться", "abone ol", "subskrybuj",
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

async function openGmailConfirmationLink(page, email, log) {
  try {
    log("info", "Gmail visszaigazoló e-mail keresése…");
    let lastError = null;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      try {
        const res = await getGmailConfirmationLink({
          runId: process.env.RUN_ID || undefined,
          workflowId: process.env.WORKFLOW_ID || undefined,
          recipient: email,
        });
        if (res?.link) {
          log("info", `Megerősítő link megvan (${res.subject || "nincs tárgy"}) — megnyitás`);
          await page.goto(res.link, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(2500);
          return { ok: true, subject: res.subject || null, from: res.from || null, url: page.url() };
        }
      } catch (e) {
        lastError = e.message;
      }
      await page.waitForTimeout(5000);
    }
    return { ok: false, error: lastError || "nem érkezett friss megerősítő e-mail" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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

  // 2a) A Kylo főoldalán a signup CTA-hoz először a logóra kell 7-szer kattintani
  //     (rejtett easter egg — enélkül a Sign Up / Regisztráció gomb meg sem jelenik).
  const logoClicks = await page.evaluate(async () => {
    const candidates = [
      ...document.querySelectorAll('a[href="/"] img, header img, [class*="logo" i] img, img[alt*="kylo" i]'),
      ...document.querySelectorAll('a[href="/"], header a, [class*="logo" i]'),
    ];
    let target = null;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) { target = el; break; }
    }
    if (!target) return 0;
    target.scrollIntoView({ block: "center" });
    let n = 0;
    for (let i = 0; i < 7; i++) {
      try { target.click(); n++; } catch {}
      await new Promise((r) => setTimeout(r, 180 + Math.random() * 120));
    }
    return n;
  });
  log("info", `Kylo logo 7× kattintás — sikeres: ${logoClicks}`);
  await page.waitForTimeout(1200);
  screenshots.push(await shot(page, "1b-after-logo-7x"));
  steps.push({ step: "logo-7x", clicks: logoClicks });

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

    const confirmation = await openGmailConfirmationLink(page, email, log);
    screenshots.push(await shot(page, "4b-after-email-confirm"));
    steps.push({ step: "email-confirm", ...confirmation });
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
  await page.waitForTimeout(4500);
  screenshots.push(await shot(page, "5-after-subscribe-click"));
  let currentUrl = page.url();
  const reachedStripe = /checkout\.stripe\.com|stripe\.com/.test(currentUrl);
  steps.push({ step: "subscribe-cta", clicked: subClicked, url: currentUrl, reached_stripe: reachedStripe });
  log(reachedStripe ? "info" : "warn", `Stripe elérve: ${reachedStripe ? "IGEN" : "NEM"} — ${currentUrl}`);

  // 6) Stripe Checkout kitöltése tesztkártyával (4242 4242 4242 4242)
  let stripeFilled = false;
  let stripeSubmitted = false;
  if (reachedStripe) {
    try {
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // Email (ha nincs előre kitöltve)
      try {
        const emailInput = await page.$('input#email, input[name="email"]');
        if (emailInput) {
          const val = await emailInput.inputValue().catch(() => "");
          if (!val) {
            await emailInput.fill(email, { timeout: 3000 });
            log("info", "Stripe: email kitöltve");
          }
        }
      } catch {}

      // Kártyaszám — Stripe iframe-eket használ
      const frames = page.frames();
      const fillInFrames = async (selector, value) => {
        for (const fr of frames) {
          try {
            const el = await fr.$(selector);
            if (el) {
              await el.click({ timeout: 2000 }).catch(() => {});
              await el.fill("", { timeout: 2000 }).catch(() => {});
              await el.type(value, { delay: 40 });
              return true;
            }
          } catch {}
        }
        return false;
      };

      const cardOk = await fillInFrames('input[name="cardnumber"], input[autocomplete="cc-number"]', "4242 4242 4242 4242");
      const expOk = await fillInFrames('input[name="exp-date"], input[autocomplete="cc-exp"]', "12 / 34");
      const cvcOk = await fillInFrames('input[name="cvc"], input[autocomplete="cc-csc"]', "123");
      log("info", `Stripe kártya kitöltés — card=${cardOk} exp=${expOk} cvc=${cvcOk}`);

      // Cardholder név (ha van)
      try {
        const name = await page.$('input[name="billingName"], input#billingName, input[autocomplete="cc-name"]');
        if (name) { await name.fill("Kylo Test", { timeout: 2000 }); }
      } catch {}

      // Ország / irányítószám — ha megjelenik
      try {
        const zip = await page.$('input[name="billingPostalCode"], input#billingPostalCode, input[autocomplete="postal-code"]');
        if (zip) { await zip.fill("10001", { timeout: 2000 }); }
      } catch {}

      stripeFilled = cardOk && expOk && cvcOk;
      screenshots.push(await shot(page, "6-stripe-filled"));

      if (stripeFilled) {
        const submitted = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button[type="submit"], button.SubmitButton, button'));
          for (const b of btns) {
            const t = (b.innerText || "").toLowerCase();
            const r = b.getBoundingClientRect();
            if (r.width < 5 || r.height < 5) continue;
            if (b.type === "submit" || /pay|fizet|subscribe|előfizet|start|begin/.test(t)) {
              b.click();
              return true;
            }
          }
          return false;
        });
        stripeSubmitted = submitted;
        log("info", `Stripe submit: ${submitted}`);
      }

      steps.push({ step: "stripe-fill", cardOk, expOk, cvcOk, submitted: stripeSubmitted });
    } catch (e) {
      log("warn", `Stripe kitöltés hiba: ${e.message}`);
      steps.push({ step: "stripe-fill", error: e.message });
    }
  }

  // 7) Vissza a Kylo profil oldalra — success feltétel
  let reachedProfile = false;
  let profileUrl = null;
  const profileRe = /kylo\.study.*\/(profile|profil|account|dashboard|home|app|my|settings)/i;
  try {
    const deadline = Date.now() + 90_000; // max 90s a Stripe → callback → profile útra
    while (Date.now() < deadline) {
      currentUrl = page.url();
      if (/kylo\.study/i.test(currentUrl) && !/stripe/i.test(currentUrl)) {
        await page.waitForTimeout(3000);
        currentUrl = page.url();
        if (profileRe.test(currentUrl)) {
          reachedProfile = true;
          profileUrl = currentUrl;
          break;
        }
        const hasProfileMarker = await page.evaluate(() => {
          const text = (document.body?.innerText || "").toLowerCase();
          return /kijelentkez|logout|sign out|profil|profile|beállítás|settings|dashboard|üdv|welcome back/.test(text);
        }).catch(() => false);
        if (hasProfileMarker) {
          reachedProfile = true;
          profileUrl = currentUrl;
          break;
        }
      }
      await page.waitForTimeout(1500);
    }
  } catch (e) {
    log("warn", `Profil várakozás hiba: ${e.message}`);
  }

  screenshots.push(await shot(page, "7-final-profile"));
  const finalUrl = page.url();
  steps.push({ step: "profile-check", reached_profile: reachedProfile, profile_url: profileUrl, final_url: finalUrl });
  log(reachedProfile ? "info" : "warn", `Profil oldal elérve: ${reachedProfile ? "IGEN" : "NEM"} — ${finalUrl}`);

  const madeProgress = signupClicked || filled || reachedStripe;
  if (!madeProgress) {
    throw new Error(
      `Kylo signup megakadt a főoldalon (logo 7× kattintás=${logoClicks}, ` +
      `signup gomb nem található, űrlap nincs). final_url=${finalUrl}`,
    );
  }

  if (!reachedProfile) {
    throw new Error(
      `Kylo signup nem érte el a profil oldalt. reached_stripe=${reachedStripe}, ` +
      `stripe_filled=${stripeFilled}, stripe_submitted=${stripeSubmitted}, final_url=${finalUrl}`,
    );
  }

  return {
    ok: reachedProfile,
    email,
    skin,
    lang,
    currency,
    reached_stripe: reachedStripe,
    stripe_filled: stripeFilled,
    stripe_submitted: stripeSubmitted,
    reached_profile: reachedProfile,
    profile_url: profileUrl,
    final_url: finalUrl,
    steps,
    screenshots,
  };
}
