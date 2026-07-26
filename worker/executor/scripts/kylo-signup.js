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
import { humanClick, humanType } from "./humanize.js";

const CLICK_HINTS_SIGNUP = [
  "register/sign in", "register", "sign up", "signup", "sign-up", "regisztráció", "regisztrálok", "regisztrál",
  "create account", "get started", "kezdés", "próbáld ki", "próbald ki",
  "regisztráljon", "kezdjük", "start", "start now", "start free", "try free",
  "try it free", "let's go", "lets go", "begin",
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

const CLICK_HINTS_SIGNUP_MODE = [
  "sign up", "signup", "create account", "register", "registration",
  "don't have an account", "dont have an account", "no account",
  "regisztráció", "regisztrálok", "regisztrálj", "regisztrál", "fiók létrehozása",
  "nincs fiókod", "még nincs fiókod", "új fiók", "új felhasználó",
  "登録", "新規登録", "会員登録", "サインアップ",
  "注册", "註冊", "crear cuenta", "registrarse", "registrati",
  "konto erstellen", "registrieren", "créer un compte", "s'inscrire",
];

const CLICK_REJECTS_SIGNIN = [
  "sign in", "signin", "log in", "login", "belépés", "bejelentkezés",
  "jelentkezz be", "ログイン", "登录", "登入", "iniciar sesión",
  "accedi", "anmelden", "connexion",
];

const CLICK_REJECTS_SIGNUP = [
  "waitlist", "waiting list", "priority list", "join waitlist", "join the priority list",
  "várólista", "varolista", "lista de espera", "liste d'attente",
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

const AUTH_DIAG_MAX = 60;

function redact(text, email, password) {
  let out = String(text || "");
  if (email) out = out.split(email).join("[email]");
  if (password) out = out.split(password).join("[password]");
  out = out.replace(/[A-Za-z0-9._%+-]+\+[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  out = out.replace(/access_token["'=:\s]+[^"'&\s]+/gi, "access_token=[redacted]");
  out = out.replace(/refresh_token["'=:\s]+[^"'&\s]+/gi, "refresh_token=[redacted]");
  return out;
}

function compactUrl(rawUrl, email, password) {
  try {
    const u = new URL(rawUrl);
    const safeSearch = redact(u.search, email, password);
    return `${u.host}${u.pathname}${safeSearch ? safeSearch.slice(0, 140) : ""}`;
  } catch {
    return redact(rawUrl, email, password).slice(0, 220);
  }
}

function classifyAuthUrl(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("check-registration-email")) return "email-precheck";
  if (u.includes("/auth/v1/signup") || /\/signup(?:\?|$)/.test(u)) return "auth-signup";
  if (u.includes("/auth/v1/otp")) return "auth-otp";
  if (u.includes("recaptcha") || u.includes("hcaptcha") || u.includes("turnstile")) return "captcha";
  if (u.includes("register") || u.includes("registration")) return "registration";
  return null;
}

function installSignupDiagnostics(page, email, password, log) {
  const state = {
    installed_at: Date.now(),
    submit_at: null,
    network: [],
    request_failures: [],
    console: [],
    page_errors: [],
  };

  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const text = redact(msg.text(), email, password).slice(0, 500);
    state.console.push({ at: Date.now(), type, text });
    if (state.console.length > AUTH_DIAG_MAX) state.console.shift();
    if (type === "error") log("warn", `Kliens console hiba: ${text}`);
  });

  page.on("pageerror", (err) => {
    const text = redact(err?.message || String(err), email, password).slice(0, 500);
    state.page_errors.push({ at: Date.now(), text });
    if (state.page_errors.length > AUTH_DIAG_MAX) state.page_errors.shift();
    log("warn", `Kliens JS hiba: ${text}`);
  });

  page.on("requestfailed", (req) => {
    const kind = classifyAuthUrl(req.url());
    if (!kind) return;
    const failure = req.failure()?.errorText || "requestfailed";
    const entry = {
      at: Date.now(),
      kind,
      method: req.method(),
      url: compactUrl(req.url(), email, password),
      error: redact(failure, email, password),
    };
    state.request_failures.push(entry);
    if (state.request_failures.length > AUTH_DIAG_MAX) state.request_failures.shift();
    log("warn", `Auth network hiba: ${entry.method} ${entry.url} → ${entry.error}`);
  });

  page.on("response", async (res) => {
    const kind = classifyAuthUrl(res.url());
    if (!kind) return;
    const req = res.request();
    const entry = {
      at: Date.now(),
      kind,
      method: req.method(),
      status: res.status(),
      url: compactUrl(res.url(), email, password),
      preview: null,
    };
    if (kind !== "captcha" || res.status() >= 400) {
      try {
        const text = await res.text();
        entry.preview = redact(text, email, password).replace(/\s+/g, " ").slice(0, 260);
      } catch {}
    }
    state.network.push(entry);
    if (state.network.length > AUTH_DIAG_MAX) state.network.shift();
    const level = res.status() >= 400 ? "warn" : "info";
    const preview = entry.preview ? ` — ${entry.preview}` : "";
    log(level, `Auth network: ${entry.method} ${entry.url} → ${entry.status}${preview}`);
  });

  return state;
}

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
async function clickByText(page, hints, log, label, options = {}) {
  const lowerHints = hints.map((h) => h.toLowerCase());
  const lowerRejects = (options.rejects || []).map((h) => h.toLowerCase());
  const marker = `kylo-worker-target-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const found = await page.evaluate(({ lowerHints, lowerRejects, marker }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const nodes = Array.from(
      document.querySelectorAll(
        'a, button, [role="button"], input[type="submit"], input[type="button"]',
      ),
    );
    for (const hint of lowerHints) {
      for (const el of nodes) {
        const t = norm(el.innerText || el.value || "");
        if (!t) continue;
        if (lowerRejects.some((h) => t.includes(h))) continue;
        if (t.includes(hint)) {
          const r = el.getBoundingClientRect();
          if (r.width < 3 || r.height < 3) continue;
          el.scrollIntoView({ block: "center" });
          el.setAttribute("data-kylo-worker-target", marker);
          return { text: t.slice(0, 80), tag: el.tagName.toLowerCase(), hint };
        }
      }
    }
    for (const el of nodes) {
      const t = norm(el.innerText || el.value || "");
      if (!t) continue;
      if (lowerRejects.some((h) => t.includes(h))) continue;
      if (lowerHints.some((h) => t.includes(h))) {
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) continue;
        el.scrollIntoView({ block: "center" });
        el.setAttribute("data-kylo-worker-target", marker);
        return { text: t.slice(0, 80), tag: el.tagName.toLowerCase() };
      }
    }
    return null;
  }, { lowerHints, lowerRejects, marker });
  if (!found) {
    log("warn", `Nem találtam ${label} gombot / linket.`);
    return false;
  }
  const handle = await page.$(`[data-kylo-worker-target="${marker}"]`);
  if (handle) {
    await humanClick(page, handle, { noMisclick: true, timeout: 4000 });
  } else {
    await page.evaluate((marker) => document.querySelector(`[data-kylo-worker-target="${marker}"]`)?.click(), marker);
  }
  await page.evaluate((marker) => {
    document.querySelectorAll(`[data-kylo-worker-target="${marker}"]`).forEach((el) => el.removeAttribute("data-kylo-worker-target"));
  }, marker).catch(() => {});
  log("info", `${label} kattintva: „${found.text}" (${found.tag})`);
  await page.waitForTimeout(1500);
  return true;
}

async function inspectAuthForm(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
    };
    const textOf = (el) => norm(el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "");
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a'))
      .filter(visible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: textOf(el).slice(0, 80),
        type: el.getAttribute("type") || "",
        disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true",
      }))
      .filter((b) => b.text);
    const submitButtons = buttons.filter((b) => b.type === "submit" || /button|input/.test(b.tag));
    const allText = buttons.map((b) => b.text.toLowerCase()).join(" | ");
    const signupRe = /sign\s*up|signup|create account|register|registration|regisztr|fiók létrehoz|nincs fiókod|登録|注册|註冊|crear cuenta|registrarse|registrati|konto erstellen|registrieren|créer un compte|s'inscrire/i;
    const signinRe = /sign\s*in|signin|log\s*in|login|belép|bejelentkez|ログイン|登录|登入|iniciar sesión|accedi|anmelden|connexion/i;
    const emailFields = Array.from(document.querySelectorAll('input[type="email"], input[name*="mail" i], input[id*="mail" i], input[placeholder*="mail" i]')).filter(visible).length;
    const passwordFields = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible).length;
    const requiredUnchecked = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter((el) => visible(el) && !el.checked && (el.required || /terms|privacy|aszf|adatvéd|policy|feltétel/i.test(norm(el.closest("label")?.innerText || el.parentElement?.innerText || "")))).length;
    return {
      url: location.href,
      emailFields,
      passwordFields,
      requiredUnchecked,
      signupSubmit: submitButtons.some((b) => signupRe.test(b.text)),
      signinSubmit: submitButtons.some((b) => signinRe.test(b.text)),
      signupToggle: signupRe.test(allText),
      signinToggle: signinRe.test(allText),
      buttons: buttons.slice(0, 25),
    };
  });
}

async function ensureSignupMode(page, log) {
  // A password mező néha csak késve renderelődik (client-side hydration),
  // vagy csak azután jelenik meg, hogy beírtuk az emailt és rákattintottunk
  // egy "Tovább / Continue" gombra (2-step form). Ezért többször pollozunk,
  // közben megpróbáljuk a signup togglet és a next-step gombot is.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    // Rövid poll: várunk max ~4s-ig, hátha a pw mező csak lassan renderelődik.
    let state = await inspectAuthForm(page);
    for (let i = 0; i < 8 && (state.emailFields === 0 || state.passwordFields === 0); i += 1) {
      await page.waitForTimeout(500);
      state = await inspectAuthForm(page);
    }
    const buttonSummary = state.buttons.map((b) => `${b.disabled ? "disabled " : ""}${b.text}`).slice(0, 10).join(" | ");
    log("info", `Auth űrlap állapot ${attempt}/6 — email=${state.emailFields}, pw=${state.passwordFields}, signupSubmit=${state.signupSubmit}, signinSubmit=${state.signinSubmit}, url=${state.url}, gombok: ${buttonSummary || "n/a"}`);

    if (state.emailFields > 0 && state.passwordFields > 0) {
      if (state.signupSubmit || !state.signinSubmit) return { ok: true, state };
      if (state.signupToggle) {
        await clickByText(page, CLICK_HINTS_SIGNUP_MODE, log, "Regisztráció mód", { rejects: CLICK_REJECTS_SIGNIN });
        await page.waitForTimeout(1200);
        continue;
      }
      return { ok: true, state };
    }

    // Nincs pw mező. Először próbáljunk signup togglet.
    if (state.signupToggle) {
      const clicked = await clickByText(page, CLICK_HINTS_SIGNUP_MODE, log, "Regisztráció mód", { rejects: CLICK_REJECTS_SIGNIN });
      if (clicked) { await page.waitForTimeout(1500); continue; }
    }

    // 2-step űrlap: van email mező, próbáljunk Tovább / Continue gombot nyomni.
    if (state.emailFields > 0) {
      const nextClicked = await clickByText(
        page,
        ["tovább", "continue", "next", "weiter", "suivant", "続ける", "下一步", "siguiente", "avanti", "kontynuuj"],
        log,
        "Tovább (2-step)",
        { rejects: [...CLICK_REJECTS_SIGNIN, "belép", "log in", "sign in"] },
      );
      if (nextClicked) { await page.waitForTimeout(1800); continue; }
    }

    return { ok: false, reason: "nincs email+jelszó űrlap", state };
  }
  const state = await inspectAuthForm(page);
  return { ok: !!(state.emailFields && state.passwordFields), reason: "nem sikerült stabil regisztráció módra váltani", state };
}

async function tickRequiredCheckboxes(page, log) {
  const markers = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
    };
    const out = [];
    Array.from(document.querySelectorAll('input[type="checkbox"]')).forEach((el, idx) => {
      const label = norm(el.closest("label")?.innerText || el.parentElement?.innerText || "");
      if (!visible(el) || el.checked) return;
      // A Kylo űrlap sok címke-nélküli checkboxot használ (feltételek).
      // Régen csak a required / terms-jellegűeket pipáltuk, de emiatt kimaradtak.
      // Most minden látható, még nem pipált checkbox-ot bepipálunk.
      const marker = `kylo-checkbox-${Date.now()}-${idx}`;
      el.setAttribute("data-kylo-worker-checkbox", marker);
      out.push({ marker, label: label.slice(0, 80) });
    });
    return out;
  });
  for (const item of markers.slice(0, 10)) {
    const handle = await page.$(`[data-kylo-worker-checkbox="${item.marker}"]`);
    if (!handle) continue;
    try {
      await humanClick(page, handle, { noMisclick: true, timeout: 3000 });
      log("info", `Checkbox bepipálva: ${item.label || item.marker}`);
    } catch (e) {
      log("warn", `Checkbox kattintás hiba: ${e.message}`);
    }
  }
}

// Beírja az emailt és jelszót az első általunk felismert űrlapba.
async function fillSignupForm(page, email, password, log) {
  const emailField = await page.$('input[type="email"], input[name*="mail" i], input[id*="mail" i], input[placeholder*="mail" i]');
  const pwFields = await page.$$('input[type="password"]');
  let filledEmail = 0;
  let filledPw = 0;
  if (emailField) {
    await emailField.click({ timeout: 3000 }).catch(() => {});
    await emailField.fill("", { timeout: 3000 }).catch(() => {});
    await humanType(page, email, { typoRate: 0, meanCharMs: 55 });
    filledEmail = 1;
  }
  for (const el of pwFields.slice(0, 2)) {
    await el.click({ timeout: 3000 }).catch(() => {});
    await el.fill("", { timeout: 3000 }).catch(() => {});
    await humanType(page, password, { typoRate: 0, meanCharMs: 45 });
    filledPw++;
  }

  // Kylo teljes regisztrációs űrlap: username + név + cím + születési dátum.
  // Ezek a mezők csak a „Regisztrálj!" toggle után jelennek meg.
  const localPart = String(email || "").split("@")[0] || "user";
  const cleanLocal = localPart.replace(/[^A-Za-z0-9]/g, "").slice(0, 18) || "user";
  const usernameGuess = `${cleanLocal}${Math.floor(1000 + Math.random() * 9000)}`.slice(0, 24);
  const defaults = {
    username: usernameGuess,
    keresztnev: "Anna",
    vezeteknev: "Kovács",
    iranyitoszam: "1051",
    cim: "Budapest",
    utcaNev: "Petőfi utca",
    hazszam: "12",
    year: "1992",
    month: "06",
    day: "15",
  };
  const extraFilled = {};
  const fillById = async (id, value) => {
    const el = await page.$(`#${id}`);
    if (!el) return false;
    try {
      await el.click({ timeout: 2000 }).catch(() => {});
      await el.fill(String(value), { timeout: 3000 });
      extraFilled[id] = value;
      return true;
    } catch (e) {
      log("warn", `Nem sikerült kitölteni #${id}: ${e.message}`);
      return false;
    }
  };
  for (const [id, val] of Object.entries(defaults)) {
    if (["year", "month", "day"].includes(id)) continue;
    await fillById(id, val);
  }
  // Születési dátum: placeholder alapján (ÉÉÉÉ / HH / NN)
  const dateSpecs = [
    { placeholder: "ÉÉÉÉ", value: defaults.year },
    { placeholder: "HH", value: defaults.month },
    { placeholder: "NN", value: defaults.day },
  ];
  for (const spec of dateSpecs) {
    const el = await page.$(`input[placeholder="${spec.placeholder}"]`);
    if (!el) continue;
    try {
      await el.click({ timeout: 2000 }).catch(() => {});
      await el.fill(spec.value, { timeout: 3000 });
      extraFilled[`date_${spec.placeholder}`] = spec.value;
    } catch (e) {
      log("warn", `Dátum mező (${spec.placeholder}) kitöltési hiba: ${e.message}`);
    }
  }

  const filled = {
    emailFields: emailField ? 1 : 0,
    pwFields: pwFields.length,
    filledEmail,
    filledPw,
    extra: extraFilled,
  };
  log(
    "info",
    `Űrlap kitöltés — email=${filled.filledEmail}, pw=${filled.filledPw}/${filled.pwFields}, extra=${Object.keys(extraFilled).join(",") || "n/a"}`,
  );
  return filled.filledEmail > 0 && filled.filledPw > 0;
}

// Megpróbálja a submit / regisztráció megerősítő gombot megnyomni.
async function submitForm(page, log) {
  await tickRequiredCheckboxes(page, log);
  const marker = `kylo-submit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const found = await page.evaluate((marker) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const signupRe = /sign\s*up|signup|create account|register|registration|regisztr|fiók létrehoz|登録|注册|註冊|crear cuenta|registrarse|registrati|konto erstellen|registrieren|créer un compte|s'inscrire/i;
    const signinRe = /sign\s*in|signin|log\s*in|login|belép|bejelentkez|ログイン|登录|登入|iniciar sesión|accedi|anmelden|connexion/i;
    const btns = Array.from(document.querySelectorAll(
      'button[type="submit"], input[type="submit"], form button',
    ));
    let best = null;
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (b.disabled || b.getAttribute("aria-disabled") === "true") continue;
      const text = norm(b.innerText || b.value || b.getAttribute("aria-label") || "");
      let score = b.type === "submit" ? 2 : 0;
      if (signupRe.test(text)) score += 10;
      if (signinRe.test(text)) score -= 20;
      if (!best || score > best.score) best = { el: b, score, text };
    }
    if (!best || best.score < 0) return null;
    best.el.setAttribute("data-kylo-worker-submit", marker);
    return { text: best.text, score: best.score };
  }, marker);
  if (found) {
    const handle = await page.$(`[data-kylo-worker-submit="${marker}"]`);
    if (handle) await humanClick(page, handle, { noMisclick: true, timeout: 4000 });
    else await page.evaluate((marker) => document.querySelector(`[data-kylo-worker-submit="${marker}"]`)?.click(), marker);
    log("info", `Regisztráció submit megnyomva: „${found.text || "submit"}".`);
    await page.waitForTimeout(2500);
    return { clicked: true, buttonText: found.text || null };
  }
  log("warn", "Nem találtam regisztrációs submit gombot az űrlapban (belépés gombot nem nyomok meg). ");
  return { clicked: false, reason: "no-signup-submit" };
}

async function collectPageDiagnostics(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
    };
    const messages = [];
    const selectors = [
      '[role="alert"]', '[aria-live]', '[aria-invalid="true"]',
      '[class*="error" i]', '[class*="invalid" i]', '[class*="danger" i]',
      '.text-red-500', '.text-red-600', '.text-destructive', '.text-danger',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        if (!visible(el)) return;
        const text = norm(el.innerText || el.textContent || el.getAttribute("aria-label") || "");
        if (text && text.length >= 2 && !messages.includes(text)) messages.push(text.slice(0, 220));
      });
    }
    const bodyText = norm(document.body?.innerText || "").slice(0, 6000);
    const confirmationRe = /check your (email|inbox)|verify your email|confirmation email|sent (you )?(an )?email|email has been sent|nézd meg az email|ellenőrző email|megerősítő email|確認メール|验证码|verifica tu correo|confirme seu email|vérifiez votre e-mail/i;
    return {
      url: location.href,
      title: document.title,
      messages: messages.slice(0, 12),
      hasConfirmationText: confirmationRe.test(bodyText),
      hasCaptcha: !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], [class*="captcha" i]'),
      bodySample: bodyText.slice(0, 500),
    };
  });
}

async function waitForRegistrationEvidence(page, diag, email, password, log) {
  const startedAt = diag.submit_at || Date.now();
  let lastPageDiag = null;
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(i === 0 ? 800 : 1200);
    lastPageDiag = await collectPageDiagnostics(page);
    const network = diag.network.filter((e) => e.at >= startedAt - 500);
    const failures = diag.request_failures.filter((e) => e.at >= startedAt - 500);
    const signupOk = network.find((e) => (e.kind === "auth-signup" || e.kind === "auth-otp") && e.status >= 200 && e.status < 400);
    const signupFailed = network.find((e) => (e.kind === "auth-signup" || e.kind === "auth-otp") && e.status >= 400);
    const precheckOk = network.find((e) => e.kind === "email-precheck" && e.status >= 200 && e.status < 400);
    const precheckFailed = network.find((e) => e.kind === "email-precheck" && e.status >= 400);
    const authFailure = failures.find((e) => e.kind === "email-precheck" || e.kind === "auth-signup" || e.kind === "auth-otp");

    if (signupOk || lastPageDiag.hasConfirmationText) {
      log("info", `Regisztráció elindulása igazolva — ${signupOk ? `${signupOk.kind} HTTP ${signupOk.status}` : "oldalon megerősítő szöveg látszik"}.`);
      return { ok: true, reason: signupOk ? signupOk.kind : "confirmation-text", page: lastPageDiag, network };
    }
    if (signupFailed || precheckFailed || authFailure) {
      const bad = signupFailed || precheckFailed || authFailure;
      return { ok: false, reason: `${bad.kind || "auth"} hiba`, bad, page: lastPageDiag, network, failures };
    }
    if (lastPageDiag.hasCaptcha) {
      return { ok: false, reason: "captcha látszik / silent captcha blokk", page: lastPageDiag, network, failures };
    }
    if (i >= 3 && lastPageDiag.messages.length > 0 && !precheckOk) {
      return { ok: false, reason: `frontend validáció: ${lastPageDiag.messages.join(" | ")}`, page: lastPageDiag, network, failures };
    }
  }
  const network = diag.network.filter((e) => e.at >= startedAt - 500);
  const failures = diag.request_failures.filter((e) => e.at >= startedAt - 500);
  const precheckOk = network.find((e) => e.kind === "email-precheck" && e.status >= 200 && e.status < 400);
  const reason = precheckOk
    ? "email előellenőrzés lefutott, de auth signup hívás nem indult"
    : "nem látszik sem auth signup, sem megerősítő e-mail állapot";
  return { ok: false, reason, page: lastPageDiag, network, failures };
}

async function openGmailConfirmationLink(page, email, log) {
  const MAX_ATTEMPTS = 12;
  const WAIT_MS = 5000;
  try {
    log("info", `Gmail visszaigazoló e-mail keresése — címzett=${email}, próbálkozások=${MAX_ATTEMPTS}, várakozás=${WAIT_MS}ms`);
    let lastError = null;
    let lastMeta = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await getGmailConfirmationLink({
          runId: process.env.RUN_ID || undefined,
          workflowId: process.env.WORKFLOW_ID || undefined,
          recipient: email,
        });
        if (res?.link) {
          log("info", `Gmail ${attempt}/${MAX_ATTEMPTS} — TALÁLAT: feladó=${res.from || "?"}, tárgy="${res.subject || "?"}", link=${res.link.slice(0, 80)}…`);
          await page.goto(res.link, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(2500);
          return { ok: true, subject: res.subject || null, from: res.from || null, url: page.url() };
        }
        // Nincs találat — logoljuk mit látott a Gmail (ha a szerver visszaadja)
        const meta = res?.debug || res?.meta || {};
        lastMeta = meta;
        const summary = [
          `q="${meta.query || "?"}"`,
          `összes=${meta.total ?? "?"}`,
          meta.latestSubject ? `legutóbbi="${meta.latestSubject}"` : null,
          meta.latestFrom ? `feladó=${meta.latestFrom}` : null,
          meta.latestAgeSec != null ? `kora=${meta.latestAgeSec}s` : null,
          meta.reason ? `ok=${meta.reason}` : null,
        ].filter(Boolean).join(", ");
        log("info", `Gmail ${attempt}/${MAX_ATTEMPTS} — nincs friss link (${summary || "üres válasz"})`);
      } catch (e) {
        lastError = e.message;
        log("warn", `Gmail ${attempt}/${MAX_ATTEMPTS} — hiba: ${e.message}`);
      }
      await page.waitForTimeout(WAIT_MS);
    }
    return { ok: false, error: lastError || "nem érkezett friss megerősítő e-mail", lastMeta };
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
  const diag = installSignupDiagnostics(page, email, password, log);

  log("info", `Sign Up indul — ${startUrl} · skin=${skin} · alias=${email} · currency=${currency}`);

  // Teszt-bypass fejléc: ha a Kylo backend engedélyezi a bot-védelem (reCAPTCHA)
  // kikapcsolását erre a tokenre, akkor átmegyünk a Recaptcha/humanity check-en.
  // A token BRAIN_KYLO_TEST_BYPASS_TOKEN env változóból jön; ha nincs, csendben
  // kihagyjuk (a régi viselkedés érvényes marad).
  const bypassToken = process.env.BRAIN_KYLO_TEST_BYPASS_TOKEN;
  if (bypassToken) {
    try {
      await context.setExtraHTTPHeaders({
        "X-Kylo-Test-Bypass": bypassToken,
        "X-Kylo-Test-Email": email,
      });
      log("info", "Kylo teszt-bypass fejléc aktív (X-Kylo-Test-Bypass).");
    } catch (e) {
      log("warn", `Nem sikerült beállítani a bypass fejlécet: ${e.message}`);
    }
  } else {
    log("warn", "Nincs BRAIN_KYLO_TEST_BYPASS_TOKEN — a Kylo captcha aktív marad.");
  }

  // 1) főoldal
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

  await page.waitForTimeout(1500);
  screenshots.push(await shot(page, "1-home"));
  steps.push({ step: "home", url: page.url() });

  await acceptCookies(page, log);

  // 2a) A Kylo főoldalán a signup CTA-hoz először a logóra kell 7-szer kattintani
  //     (rejtett easter egg — enélkül a Sign Up / Regisztráció gomb meg sem jelenik).
  //     FONTOS: a Kylo detektor valódi pointer eseményeket számol, ezért
  //     page.mouse.click()-et használunk (CDP-n át valós mouseup/mousedown),
  //     nem szintetikus element.click()-et.
  const logoRect = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('a[href="/"] img, header img, [class*="logo" i] img, img[alt*="kylo" i]'),
      ...document.querySelectorAll('a[href="/"], header a, [class*="logo" i]'),
    ];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width > 8 && r.height > 8 && r.top >= 0 && r.left >= 0) {
        el.scrollIntoView({ block: "center" });
        const r2 = el.getBoundingClientRect();
        return { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 };
      }
    }
    return null;
  });
  let logoClicks = 0;
  if (logoRect) {
    await page.waitForTimeout(300);
    for (let i = 0; i < 7; i++) {
      try {
        await page.mouse.click(logoRect.x, logoRect.y, { delay: 40 + Math.floor(Math.random() * 40) });
        logoClicks++;
      } catch (e) {
        log("warn", `Logo click ${i + 1} hiba: ${e.message}`);
      }
      await page.waitForTimeout(180 + Math.floor(Math.random() * 140));
    }
  } else {
    log("warn", "Kylo logó nem található a főoldalon — 7× kattintás kihagyva");
  }
  log("info", `Kylo logo 7× valós egérklikk — sikeres: ${logoClicks} (pozíció: ${logoRect ? `${Math.round(logoRect.x)},${Math.round(logoRect.y)}` : "n/a"})`);
  await page.waitForTimeout(1800);
  screenshots.push(await shot(page, "1b-after-logo-7x"));

  // Felderítés: mi látszik a főoldalon a logó 7× után? (segít a hint-eket bővíteni)
  const visibleCtas = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const out = [];
    const nodes = document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]');
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const t = norm(el.innerText || el.value || el.getAttribute("aria-label") || "");
      if (!t || t.length > 60) continue;
      out.push({ tag: el.tagName.toLowerCase(), text: t, href: el.getAttribute("href") || null });
      if (out.length >= 40) break;
    }
    return out;
  }).catch(() => []);
  log("info", `Látható CTA-k (${visibleCtas.length}): ${visibleCtas.map((c) => `[${c.tag}]${c.text}`).slice(0, 25).join(" | ")}`);
  steps.push({ step: "logo-7x", clicks: logoClicks, visible_ctas: visibleCtas });

  // 2) sign-up gomb — előbb próbáljuk a link href-jét kiolvasni és
  //    közvetlenül odanavigálni (pl. /regisztracio, /register, /signup).
  //    A sticky header sokszor lefogja a kattintást, ezért a href-alapú
  //    navigáció megbízhatóbb, mint a kattintás.
  const beforeSignupUrl = page.url();
  let signupNavigated = false;
  try {
    const href = await page.evaluate((hints) => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const links = Array.from(document.querySelectorAll("a[href]"));
      for (const h of hints) {
        for (const a of links) {
          const t = norm(a.innerText || a.getAttribute("aria-label") || "");
          if (t && t.includes(h) && a.href) return a.href;
        }
      }
      return null;
    }, CLICK_HINTS_SIGNUP.map((h) => h.toLowerCase()));
    if (href && !/waitlist|priority|dismiss/i.test(href)) {
      log("info", `Sign Up link href: ${href} — közvetlen navigáció`);
      await page.goto(href, { waitUntil: "domcontentloaded", timeout: 20000 }).catch((e) => log("warn", `goto hiba: ${e.message}`));
      await page.waitForTimeout(1500);
      signupNavigated = page.url() !== beforeSignupUrl;
    }
  } catch (e) {
    log("warn", `Sign Up href kiolvasás hiba: ${e.message}`);
  }
  let signupClicked = signupNavigated;
  if (!signupNavigated) {
    signupClicked = await clickByText(page, CLICK_HINTS_SIGNUP, log, "Sign Up / Regisztráció", { rejects: CLICK_REJECTS_SIGNUP });
    await page.waitForTimeout(1200);
  }
  screenshots.push(await shot(page, "2-after-signup-click"));
  steps.push({ step: "signup-cta", clicked: signupClicked, navigated: signupNavigated, url: page.url() });

  const signupMode = await ensureSignupMode(page, log);
  screenshots.push(await shot(page, "2b-signup-mode-check"));
  steps.push({ step: "signup-mode", ...signupMode });
  if (!signupMode.ok) {
    throw new Error(`Nem jutottunk regisztrációs űrlapig: ${signupMode.reason || "ismeretlen ok"}. url=${page.url()}`);
  }

  // 3) űrlap kitöltés
  const filled = await fillSignupForm(page, email, password, log);
  screenshots.push(await shot(page, "3-form-filled"));
  steps.push({ step: "form-fill", filled });

  if (filled) {
    const beforeSubmitUrl = page.url();
    diag.submit_at = Date.now();
    const submit = await submitForm(page, log);
    await page.waitForTimeout(3000);
    screenshots.push(await shot(page, "4-after-submit"));
    const evidence = submit.clicked
      ? await waitForRegistrationEvidence(page, diag, email, password, log)
      : { ok: false, reason: submit.reason || "submit nem kattant", page: await collectPageDiagnostics(page), network: [] };
    screenshots.push(await shot(page, "4a-registration-evidence"));
    steps.push({
      step: "submit",
      clicked: submit.clicked,
      buttonText: submit.buttonText || null,
      before_url: beforeSubmitUrl,
      after_url: page.url(),
      registration_evidence: evidence,
    });

    if (!evidence.ok) {
      const pageMessages = evidence.page?.messages?.length ? ` Üzenet: ${evidence.page.messages.join(" | ")}` : "";
      const networkSummary = evidence.network?.length
        ? ` Network: ${evidence.network.map((n) => `${n.kind}:${n.status}`).join(", ")}`
        : " Network: nincs releváns auth hívás.";
      const failureSummary = evidence.failures?.length
        ? ` Failures: ${evidence.failures.map((n) => `${n.kind}:${n.error}`).join(", ")}`
        : "";
      throw new Error(
        `A regisztráció nem indult el, ezért nem várok Gmail e-mailre. Ok: ${evidence.reason}.${pageMessages}${networkSummary}${failureSummary} url=${page.url()}`,
      );
    }

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
  const profileRe = /kylo\.study.*\/(profile|profil|account|dashboard|app|my|settings)/i;
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
          const path = `${location.pathname || ""}${location.hash || ""}`.toLowerCase();
          if (path === "/" || path.includes("waitlist")) return false;
          const text = (document.body?.innerText || "").toLowerCase();
          return /kijelentkez|logout|sign out|beállítás|settings|dashboard|üdv újra|welcome back|billing|subscription/.test(text);
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
