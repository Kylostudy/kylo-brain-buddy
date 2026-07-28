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
import { auditLanguage, auditTextLanguage, isStripeUrl } from "./lang-audit.js";

// Számlázási űrlap kitöltéséhez használt tesztadatok.
const BILLING_TEST = {
  name: "Kylo Test",
  line1: "1 Test Street",
  houseNumber: "12",
  city: "Testville",
  postal: "10001",
  phone: "+15555550123",
  fallback: "Test",
};


const CLICK_HINTS_PAY = [
  "fizetés", "fizetek", "tovább a fizetéshez", "pay", "pay now", "continue to payment",
  "proceed to payment", "checkout", "continue", "tovább", "weiter", "zur kasse", "bezahlen",
  "payer", "continuer", "pagar", "continuar", "paga", "continua", "оплатить", "продолжить",
  "支払い", "お支払い", "続ける", "支付", "付款", "결제", "ödeme", "devam",
];


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
  // Ha közben navigál az oldal, a page.evaluate „Execution context was destroyed"
  // hibát dob — ez nem futáshiba, csak újra kell próbálni a betöltés után.
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  const findTarget = () => page.evaluate(({ lowerHints, lowerRejects, marker }) => {
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

  let found = await findTarget().catch(() => "retry");
  if (found === "retry") {
    // navigáció közben kaptuk el az oldalt — megvárjuk és újrapróbáljuk
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    found = await findTarget().catch(() => null);
  }
  if (!found) {
    log("warn", `Nem találtam ${label} gombot / linket.`);
    return false;
  }
  const handle = await page.$(`[data-kylo-worker-target="${marker}"]`).catch(() => null);
  try {
    if (handle) {
      await humanClick(page, handle, { noMisclick: true, timeout: 4000 });
    } else {
      await page.evaluate((marker) => document.querySelector(`[data-kylo-worker-target="${marker}"]`)?.click(), marker);
    }
  } catch (e) {
    if (!/context was destroyed|Target closed|navigation/i.test(e?.message || "")) throw e;
    log("info", `${label}: az oldal a kattintás közben navigált — folytatjuk.`);
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
    const submitButtons = buttons.filter((b) => b.type === "submit");
    const allText = buttons.map((b) => b.text.toLowerCase()).join(" | ");
    const signupRe = /sign\s*up|signup|create account|register|registration|regisztr|fiók létrehoz|nincs fiókod|登録|注册|註冊|crear cuenta|registrarse|registrati|konto erstellen|registrieren|créer un compte|s'inscrire/i;
    const signinRe = /sign\s*in|signin|log\s*in|login|belép|bejelentkez|ログイン|登录|登入|iniciar sesión|accedi|anmelden|connexion/i;
    const emailFields = Array.from(document.querySelectorAll('input[type="email"], input[name*="mail" i], input[id*="mail" i], input[placeholder*="mail" i]')).filter(visible).length;
    const passwordFields = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible).length;
    const signupExtraFields = Array.from(document.querySelectorAll('#username, #keresztnev, #vezeteknev, #iranyitoszam, #utcaNev, #hazszam, input[placeholder="YYYY"], input[placeholder="ÉÉÉÉ"]')).filter(visible).length;
    const requiredUnchecked = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter((el) => visible(el) && !el.checked && (el.required || /terms|privacy|aszf|adatvéd|policy|feltétel/i.test(norm(el.closest("label")?.innerText || el.parentElement?.innerText || "")))).length;
    const signupSubmit = submitButtons.some((b) => signupRe.test(b.text));
    const signinSubmit = submitButtons.some((b) => signinRe.test(b.text));
    return {
      url: location.href,
      emailFields,
      passwordFields,
      signupExtraFields,
      requiredUnchecked,
      signupSubmit,
      signinSubmit,
      currentSignup: signupExtraFields > 0 || passwordFields >= 2 || (signupSubmit && !signinSubmit),
      currentSignin: signinSubmit && signupExtraFields === 0 && passwordFields <= 1,
      signupToggle: signupRe.test(allText),
      signinToggle: signinRe.test(allText),
      buttons: buttons.slice(0, 25),
    };
  });
}

async function clickAuthSignupToggle(page, log) {
  const marker = `kylo-signup-toggle-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const found = await page.evaluate(({ marker }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const signupRe = /sign\s*up|signup|create account|register!?|registration|regisztr|fiók létrehoz|nincs fiókod|登録|注册|註冊|crear cuenta|registrarse|registrati|konto erstellen|registrieren|créer un compte|s'inscrire/i;
    const signinRe = /sign\s*in|signin|log\s*in|login|belép|bejelentkez|ログイン|登录|登入|iniciar sesión|accedi|anmelden|connexion/i;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
    };
    let best = null;
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], a'));
    for (const el of nodes) {
      if (!visible(el)) continue;
      const text = norm(el.innerText || el.value || el.getAttribute("aria-label") || "");
      if (!text || !signupRe.test(text) || signinRe.test(text)) continue;
      const r = el.getBoundingClientRect();
      const inHeader = !!el.closest("header, nav") || r.top < 70;
      const nearAuthForm = !!el.closest("form") || !!el.closest("[class*='max-w-md'], [class*='space-y-6']") || !!el.parentElement?.innerText?.match(/email|password|jelszó|account/i);
      let score = 0;
      if (/^register!?$/i.test(text) || /^sign\s*up!?$/i.test(text) || /^regisztr/i.test(text)) score += 40;
      if (nearAuthForm) score += 30;
      if (/don't have|dont have|nincs/i.test(el.parentElement?.innerText || "")) score += 20;
      if (inHeader) score -= 35;
      if (r.width < 180 && r.height < 60) score += 8;
      if (!best || score > best.score) best = { el, score, text, tag: el.tagName.toLowerCase() };
    }
    if (!best) return null;
    best.el.scrollIntoView({ block: "center" });
    best.el.setAttribute("data-kylo-signup-toggle", marker);
    return { text: best.text.slice(0, 80), tag: best.tag, score: best.score };
  }, { marker });
  if (!found) {
    log("warn", "Nem találtam valódi regisztrációs váltó gombot az auth űrlapon.");
    return false;
  }
  const handle = await page.$(`[data-kylo-signup-toggle="${marker}"]`);
  if (handle) await humanClick(page, handle, { noMisclick: true, timeout: 4000 });
  else await page.evaluate((marker) => document.querySelector(`[data-kylo-signup-toggle="${marker}"]`)?.click(), marker);
  await page.evaluate((marker) => {
    document.querySelectorAll(`[data-kylo-signup-toggle="${marker}"]`).forEach((el) => el.removeAttribute("data-kylo-signup-toggle"));
  }, marker).catch(() => {});
  log("info", `Regisztráció mód kattintva: „${found.text}" (${found.tag}, score=${found.score})`);
  await page.waitForTimeout(1600);
  return true;
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
    log("info", `Auth űrlap állapot ${attempt}/6 — email=${state.emailFields}, pw=${state.passwordFields}, extra=${state.signupExtraFields}, signup=${state.currentSignup}, signin=${state.currentSignin}, url=${state.url}, gombok: ${buttonSummary || "n/a"}`);

    if (state.emailFields > 0 && state.passwordFields > 0) {
      if (state.currentSignup) return { ok: true, state };
      if (state.signupToggle || state.currentSignin) {
        await clickAuthSignupToggle(page, log);
        await page.waitForTimeout(1200);
        continue;
      }
      return { ok: false, reason: "belépési űrlap látszik, de nincs regisztrációs váltó", state };
    }

    // Nincs pw mező. Először próbáljunk signup togglet.
    if (state.signupToggle) {
      const clicked = await clickAuthSignupToggle(page, log);
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
  return { ok: !!(state.emailFields && state.passwordFields && state.currentSignup), reason: "nem sikerült stabil regisztráció módra váltani", state };
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
    const roleIds = new Set(["nyelvtanar", "osztalyfonok", "szaktanar", "nyelvtanar20", "nyelvtanulo"]);
    const roleCheckboxes = Array.from(document.querySelectorAll('button[role="checkbox"], [role="checkbox"]'));
    const checkboxControls = roleCheckboxes.length > 0
      ? roleCheckboxes
      : Array.from(document.querySelectorAll('input[type="checkbox"]'));
    const seenLabels = new Set();
    checkboxControls.forEach((el, idx) => {
      const label = norm(el.closest("label")?.innerText || el.parentElement?.innerText || el.parentElement?.parentElement?.innerText || "");
      if (!visible(el)) return;
      if (roleIds.has(el.id || "") || /tanár|teacher|tanuló|student|osztályfőnök|szaktanár|nyelvtanár|nyelvtanulo|class teacher|join/i.test(label)) return;
      const isChecked = el.getAttribute("aria-checked") === "true" || !!el.checked;
      if (isChecked) return;
      const legalConsent = /terms|service|privacy|policy|withdrawal|right of withdrawal|feltétel|aszf|adatvéd|lemond|elállási|szolgáltatás/i.test(label);
      const optionalRole = /tanár|teacher|tanuló|student|osztályfőnök|szaktanár|nyelvtanár|class teacher|join/i.test(label);
      if (!el.required && (!legalConsent || optionalRole)) return;
      const labelKey = label.toLowerCase();
      if (seenLabels.has(labelKey)) return;
      seenLabels.add(labelKey);
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

async function closeJoinModalIfOpen(page, log) {
  const closed = await page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
    };
    const dialog = Array.from(document.querySelectorAll('[role="dialog"], [data-state="open"]'))
      .find((el) => visible(el) && /kihez csatlakozol|who are you joining|join/i.test(norm(el.innerText || el.textContent || "")));
    if (!dialog) return false;
    const closeBtn = Array.from(dialog.querySelectorAll('button, [role="button"]'))
      .find((el) => {
        const text = norm(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "");
        return visible(el) && (/close|bezár|×|x/i.test(text) || (el.getBoundingClientRect().width <= 36 && el.getBoundingClientRect().height <= 36));
      });
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    return false;
  }).catch(() => false);
  if (closed) {
    log("info", "Csatlakozási modal bezárva — nem választunk tanári/tanulói szerepet a Pro signup teszthez.");
    await page.waitForTimeout(500);
    return true;
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
  return false;
}

async function clearOptionalRoleCheckboxes(page, log) {
  // A Pro csomaghoz SEMMILYEN szerepkört nem választunk. Nem csak a régi
  // fix ID-kra megyünk rá, hanem minden olyan bepipált jelölőnégyzetre,
  // aminek a felirata szerepkörre utal (tanár / tanuló / csatlakozás).
  const roleIds = ["nyelvtanar", "osztalyfonok", "szaktanar", "nyelvtanar20", "nyelvtanulo"];
  for (let round = 0; round < 4; round += 1) {
    const checked = await page.evaluate((roleIds) => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
      };
      const ROLE_RE = /tanár|teacher|tutor|tanuló|student|learner|osztályfőnök|szaktanár|nyelvtanár|nyelvtanuló|class teacher|csatlakoz|join/i;
      const out = [];
      const candidates = Array.from(
        document.querySelectorAll('button[role="checkbox"], [role="checkbox"], input[type="checkbox"], [role="radio"], input[type="radio"]'),
      );
      let idx = 0;
      for (const el of candidates) {
        if (!visible(el)) continue;
        const isChecked = el.getAttribute("aria-checked") === "true" || !!el.checked;
        if (!isChecked) continue;
        const label = norm(
          el.closest("label")?.innerText ||
            el.getAttribute("aria-label") ||
            el.parentElement?.innerText ||
            el.parentElement?.parentElement?.innerText ||
            "",
        );
        const isRole = roleIds.includes(el.id || "") || ROLE_RE.test(label);
        if (!isRole) continue;
        idx += 1;
        const marker = `kylo-role-clear-${idx}-${Date.now()}`;
        el.setAttribute("data-kylo-role-clear", marker);
        out.push({ id: el.id || label.slice(0, 60) || `checkbox#${idx}`, marker });
      }
      return out;
    }, roleIds).catch(() => []);

    if (!checked.length) break;
    for (const item of checked) {
      const handle = await page.$(`[data-kylo-role-clear="${item.marker}"]`);
      if (!handle) continue;
      try {
        await humanClick(page, handle, { noMisclick: true, timeout: 3000 });
        log("info", `Szerepkör kikapcsolva (Pro csomaghoz nem kell): ${item.id}`);
        await page.waitForTimeout(500);
        await closeJoinModalIfOpen(page, log);
      } catch (e) {
        log("warn", `Szerepkör kikapcsolási hiba (${item.id}): ${e.message}`);
      }
    }
  }
  await closeJoinModalIfOpen(page, log);
}


async function inspectSubmitReadiness(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
    };
    const roleIds = ["nyelvtanar", "osztalyfonok", "szaktanar", "nyelvtanar20", "nyelvtanulo"];
    const ROLE_RE = /tanár|teacher|tutor|tanuló|student|learner|osztályfőnök|szaktanár|nyelvtanár|nyelvtanuló|class teacher|csatlakoz|join/i;
    const labelOf = (el) =>
      norm(
        el.closest("label")?.innerText ||
          el.getAttribute("aria-label") ||
          el.parentElement?.innerText ||
          el.parentElement?.parentElement?.innerText ||
          "",
      );
    const isRoleControl = (el) => roleIds.includes(el.id || "") || ROLE_RE.test(labelOf(el));
    const roleChecked = Array.from(
      document.querySelectorAll('button[role="checkbox"], [role="checkbox"], input[type="checkbox"], [role="radio"], input[type="radio"]'),
    )
      .filter((el) => visible(el))
      .filter((el) => el.getAttribute("aria-checked") === "true" || !!el.checked)
      .filter(isRoleControl)
      .map((el) => el.id || labelOf(el).slice(0, 40))
      .slice(0, 10);
    const legalUnchecked = Array.from(document.querySelectorAll('button[role="checkbox"], [role="checkbox"], input[type="checkbox"]'))
      .filter((el) => visible(el))
      .filter((el) => !isRoleControl(el))

      .filter((el) => {
        const label = norm(el.closest("label")?.innerText || el.parentElement?.innerText || el.parentElement?.parentElement?.innerText || "");
        const legal = /terms|service|privacy|policy|withdrawal|right of withdrawal|feltétel|aszf|adatvéd|lemond|elállási|szolgáltatás/i.test(label);
        const checked = el.getAttribute("aria-checked") === "true" || !!el.checked;
        return legal && !checked;
      })
      .map((el) => norm(el.closest("label")?.innerText || el.parentElement?.innerText || "").slice(0, 90));
    const submitButtons = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"]'))
      .filter((el) => visible(el))
      .map((el) => ({
        text: norm(el.innerText || el.value || ""),
        disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true",
      }));
    const registerButton = submitButtons.find((b) => /register|sign up|regisztr/i.test(b.text)) || null;
    const openJoinModal = Array.from(document.querySelectorAll('[role="dialog"], [data-state="open"]'))
      .some((el) => visible(el) && /kihez csatlakozol|who are you joining|join/i.test(norm(el.innerText || el.textContent || "")));
    return { roleChecked, legalUnchecked, registerButton, openJoinModal };
  });
}

async function selectComboboxOption(page, log, config) {
  const marker = `kylo-combo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const found = await page.evaluate(({ marker, buttonTexts, labelTexts }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const lower = (s) => norm(s).toLowerCase();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
    };
    const buttons = Array.from(document.querySelectorAll('button[role="combobox"], [role="combobox"]')).filter(visible);
    let best = null;
    for (const el of buttons) {
      const ownText = lower(el.innerText || el.getAttribute("aria-label") || "");
      const parentText = lower(el.closest(".space-y-2")?.innerText || el.parentElement?.innerText || "");
      let score = 0;
      if (buttonTexts.some((t) => ownText.includes(t))) score += 20;
      if (labelTexts.some((t) => parentText.includes(t))) score += 30;
      if (score <= 0) continue;
      if (!best || score > best.score) best = { el, score, text: norm(el.innerText || el.getAttribute("aria-label") || "") };
    }
    if (!best) return null;
    best.el.scrollIntoView({ block: "center" });
    best.el.setAttribute("data-kylo-combo", marker);
    return { text: best.text, score: best.score };
  }, {
    marker,
    buttonTexts: config.buttonTexts.map((s) => s.toLowerCase()),
    labelTexts: config.labelTexts.map((s) => s.toLowerCase()),
  });
  if (!found) return false;
  const handle = await page.$(`[data-kylo-combo="${marker}"]`);
  if (handle) await humanClick(page, handle, { noMisclick: true, timeout: 3000 });
  await page.waitForTimeout(800);
  const optionMarker = `${marker}-option`;
  const option = await page.evaluate(({ optionMarker, optionTexts }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
    };
    const nodes = Array.from(document.querySelectorAll('[role="option"], [cmdk-item], [role="menuitem"]'));
    for (const wanted of optionTexts) {
      for (const el of nodes) {
        if (!visible(el)) continue;
        const text = norm(el.innerText || el.getAttribute("aria-label") || "");
        if (!text) continue;
        if (text.toLowerCase() === wanted || text.toLowerCase().includes(wanted)) {
          el.setAttribute("data-kylo-combo-option", optionMarker);
          return { text: text.slice(0, 80) };
        }
      }
    }
    return null;
  }, { optionMarker, optionTexts: config.optionTexts.map((s) => s.toLowerCase()) });
  if (!option) {
    log("warn", `${config.label}: lenyíló megnyílt, de opciót nem találtam.`);
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  const optionHandle = await page.$(`[data-kylo-combo-option="${optionMarker}"]`);
  if (optionHandle) await humanClick(page, optionHandle, { noMisclick: true, timeout: 3000 });
  else await page.evaluate((optionMarker) => document.querySelector(`[data-kylo-combo-option="${optionMarker}"]`)?.click(), optionMarker);
  log("info", `${config.label} kiválasztva: ${option.text}`);
  await page.waitForTimeout(700);
  return true;
}

// A felvett (rögzített) regisztrációs folyamatból kiolvassa, hogy MELYIK mezőket
// kell kitölteni és milyen sorrendben. A gépelt karaktereket összefűzi mezőnként.
// A személyes adatok (email, jelszó, felhasználónév) mindig frissre cserélődnek.
export function planFromRecording(recordedActions) {
  const list = Array.isArray(recordedActions) ? recordedActions : [];
  const order = [];
  const values = new Map();
  for (const a of list) {
    if (!a || a.type !== "type" || !a.selector) continue;
    const sel = String(a.selector);
    if (!/^#[A-Za-z0-9_-]+$/.test(sel)) continue; // csak stabil id-alapú mezők
    if (!values.has(sel)) {
      values.set(sel, "");
      order.push(sel);
    }
    values.set(sel, values.get(sel) + String(a.value ?? ""));
  }
  return order.map((selector) => ({
    id: selector.slice(1),
    selector,
    value: values.get(selector),
  }));
}

function roleOfField(id) {
  const k = id.toLowerCase();
  if (k.includes("mail")) return "email";
  if (k.includes("pass") || k.includes("jelszo")) return "password";
  if (k.includes("user") || k.includes("felhasznal")) return "username";
  return "other";
}

// Beírja az emailt és jelszót az első általunk felismert űrlapba.
async function fillSignupForm(page, email, password, log, recordedPlan = []) {
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
  // A felvett űrlap a mérvadó: onnan vesszük a mezőket és a sorrendet, az email /
  // jelszó / felhasználónév viszont mindig friss (alias), hogy ÚJ fiók jöjjön létre.
  const planned = [];
  for (const field of recordedPlan) {
    if (["email", "password"].includes(roleOfField(field.id))) continue;
    const value =
      roleOfField(field.id) === "username" ? usernameGuess : field.value || defaults[field.id] || "";
    if (!value) continue;
    planned.push({ id: field.id, value });
  }
  for (const [id, val] of Object.entries(defaults)) {
    if (["year", "month", "day"].includes(id)) continue;
    if (planned.some((p) => p.id === id)) continue;
    planned.push({ id, value: val });
  }
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
  if (recordedPlan.length > 0) {
    log(
      "info",
      `Felvett űrlap követése — mezők: ${recordedPlan.map((f) => f.id).join(", ")}`,
    );
  }
  for (const { id, value } of planned) {
    await fillById(id, value);
  }
  // Születési dátum: placeholder alapján (ÉÉÉÉ / HH / NN)
  const dateSpecs = [
    { placeholder: "ÉÉÉÉ", value: defaults.year },
    { placeholder: "YYYY", value: defaults.year },
    { placeholder: "HH", value: defaults.month },
    { placeholder: "MM", value: defaults.month },
    { placeholder: "NN", value: defaults.day },
    { placeholder: "DD", value: defaults.day },
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

  const addressTypeSelected = await selectComboboxOption(page, log, {
    label: "Cím típusa",
    labelTexts: ["address", "cím"],
    buttonTexts: ["type", "típus", "type..."],
    optionTexts: ["utca", "street", "road"],
  });
  if (addressTypeSelected) extraFilled.addressType = "utca";

  const genderSelected = await selectComboboxOption(page, log, {
    label: "Nem",
    labelTexts: ["gender", "nem"],
    buttonTexts: ["select", "válassz", "select..."],
    optionTexts: ["female", "nő", "male", "férfi"],
  });
  if (genderSelected) extraFilled.gender = "female";

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
  await clearOptionalRoleCheckboxes(page, log);
  await tickRequiredCheckboxes(page, log);
  await closeJoinModalIfOpen(page, log);
  await page.waitForTimeout(800);
  const readiness = await inspectSubmitReadiness(page).catch(() => null);
  if (readiness) {
    log(
      "info",
      `Submit állapot — register=${readiness.registerButton ? (readiness.registerButton.disabled ? "tiltva" : "aktív") : "nincs"}, opcionális szerep=${readiness.roleChecked.join(",") || "nincs"}, jogi checkbox hiány=${readiness.legalUnchecked.length}, modal=${readiness.openJoinModal ? "nyitva" : "nincs"}`,
    );
    if (readiness.openJoinModal || readiness.roleChecked.length || readiness.legalUnchecked.length || readiness.registerButton?.disabled) {
      return {
        clicked: false,
        reason: `submit nem kész: register=${readiness.registerButton?.disabled ? "tiltva" : "ok"}, szerep=${readiness.roleChecked.join(",") || "nincs"}, jogi_hiány=${readiness.legalUnchecked.length}, modal=${readiness.openJoinModal}`,
      };
    }
  }
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
    if (!best || best.score < 10) return null;
    best.el.setAttribute("data-kylo-worker-submit", marker);
    return { text: best.text, score: best.score };
  }, marker);
  if (found) {
    const handle = await page.$(`[data-kylo-worker-submit="${marker}"]`);
    if (handle) await humanClick(page, handle, { noMisclick: true, timeout: 4000 });
    else await page.evaluate((marker) => document.querySelector(`[data-kylo-worker-submit="${marker}"]`)?.click(), marker);
    log("info", `Regisztráció submit megnyomva: „${found.text || "submit"}".`);
    // Diagnosztika: mi takarja a gombot, és mely kötelező mezők üresek/érvénytelenek?
    const blockers = await collectSubmitBlockers(page, marker).catch(() => null);
    if (blockers) {
      log(
        "info",
        `Submit diagnosztika — gomb a ponton: ${blockers.elementAtPoint || "?"}, űrlap érvényes: ${blockers.formValid === null ? "n/a" : blockers.formValid ? "igen" : "nem"}, hiányzó/érvénytelen mezők: ${blockers.invalidFields.join(", ") || "nincs"}`,
      );
    }
    await page.waitForTimeout(2500);
    return { clicked: true, buttonText: found.text || null };
  }

  log("warn", "Nem találtam regisztrációs submit gombot az űrlapban (belépés gombot nem nyomok meg). ");
  return { clicked: false, reason: "no-signup-submit" };
}

async function collectSubmitBlockers(page, marker) {
  return page.evaluate((marker) => {
    const btn = document.querySelector(`[data-kylo-worker-submit="${marker}"]`);
    if (!btn) return { elementAtPoint: "gomb eltűnt", formValid: null, invalidFields: [] };
    const r = btn.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const desc = (el) =>
      el ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 2).join(".") : ""}` : "nincs";
    const form = btn.closest("form");
    const invalidFields = [];
    const scope = form || document;
    scope.querySelectorAll("input, select, textarea").forEach((el) => {
      if (el.type === "hidden" || el.disabled) return;
      const bad = (el.required && !el.value && el.type !== "checkbox") || (el.willValidate && !el.checkValidity());
      if (!bad) return;
      const label = el.name || el.id || el.placeholder || el.getAttribute("aria-label") || el.type;
      invalidFields.push(String(label).slice(0, 40));
    });
    return {
      elementAtPoint: at === btn || btn.contains(at) ? "maga a gomb" : desc(at),
      formValid: form ? form.checkValidity() : null,
      invalidFields: invalidFields.slice(0, 12),
    };
  }, marker);
}

async function forceResubmit(page, log, label) {
  // FONTOS: csak EGYETLEN beküldés történhet. A #119-es futásnál a
  // btn.click() + form.requestSubmit() páros két auth/v1/signup hívást
  // indított 11 ms-on belül, és a második 500-as "Database error saving
  // new user" hibát adott (a fiók már létrejött az elsőtől).
  const done = await page
    .evaluate(() => {
      const btn = document.querySelector("[data-kylo-worker-submit]");
      if (!btn) return "gomb nem található";
      const form = btn.closest("form");
      if (form && typeof form.requestSubmit === "function") {
        try {
          form.requestSubmit(btn);
          return "form.requestSubmit()";
        } catch (_) {}
      }
      try {
        btn.click();
        return "gomb.click()";
      } catch (_) {}
      return "nem sikerült";
    })
    .catch(() => "hiba");
  log("info", `Submit újrapróba (${label}) — ${done}`);
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
    const submitBtn = Array.from(document.querySelectorAll('button, [type="submit"]')).find(
      (b) => visible(b) && /regist|sign ?up|regisztr|créer|registrieren|iscri|cadastr|登録/i.test(norm(b.innerText || b.value || "")),
    );
    return {
      url: location.href,
      title: document.title,
      messages: messages.slice(0, 12),
      hasConfirmationText: confirmationRe.test(bodyText),
      hasCaptcha: !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], [class*="captcha" i]'),
      submitState: submitBtn
        ? { text: norm(submitBtn.innerText || submitBtn.value || "").slice(0, 80), disabled: !!submitBtn.disabled }
        : null,
      bodySample: bodyText.slice(0, 500),
    };

  });
}

async function waitForRegistrationEvidence(page, diag, email, password, log) {
  const startedAt = diag.submit_at || Date.now();
  let lastPageDiag = null;
  // A Kylo oldalon a reCAPTCHA Enterprise néha csak ~30s timeout után engedi
  // tovább a regisztrációt. A #14-es futásnál a worker ~18s után feladta,
  // miközben a kézi reprodukcióban a gomb "Registering..." állapotban maradt,
  // majd később indult csak el az auth signup hívás. Ezért itt nem rövid,
  // hanem legfeljebb 55s-es bizonyíték-várakozás kell.
  const deadline = startedAt + 55_000;
  let lastProgressLogAt = 0;
  const retriesDone = new Set();
  for (let i = 0; Date.now() < deadline; i += 1) {
    await page.waitForTimeout(i === 0 ? 1200 : 2000);
    lastPageDiag = await collectPageDiagnostics(page);
    const network = diag.network.filter((e) => e.at >= startedAt - 500);
    const failures = diag.request_failures.filter((e) => e.at >= startedAt - 500);
    const signupOk = network.find((e) => (e.kind === "auth-signup" || e.kind === "auth-otp") && e.status >= 200 && e.status < 400);
    const signupFailed = network.find((e) => (e.kind === "auth-signup" || e.kind === "auth-otp") && e.status >= 400);
    const precheckOk = network.find((e) => e.kind === "email-precheck" && e.status >= 200 && e.status < 400);
    const precheckFailed = network.find((e) => e.kind === "email-precheck" && e.status >= 400);
    const authFailure = failures.find((e) => e.kind === "email-precheck" || e.kind === "auth-signup" || e.kind === "auth-otp");

    // Ha a kattintás után semmilyen hálózati jel nincs, a gomb sem vált állapotot,
    // akkor a kattintás valószínűleg "elnyelődött" — próbáljuk közvetlenül újra.
    const elapsed = Date.now() - startedAt;
    for (const at of [9000, 24000]) {
      if (elapsed > at && !retriesDone.has(at) && !network.length && !lastPageDiag.hasConfirmationText) {
        retriesDone.add(at);
        await forceResubmit(page, log, `${Math.round(at / 1000)}s`);
      }
    }


    if (Date.now() - lastProgressLogAt > 10_000) {
      lastProgressLogAt = Date.now();
      const seen = network.length
        ? network.map((e) => `${e.kind}:${e.status}`).join(", ")
        : "nincs még auth hálózati jel";
      const btn = lastPageDiag.submitState
        ? `gomb="${lastPageDiag.submitState.text}"${lastPageDiag.submitState.disabled ? " (letiltva)" : ""}`
        : "gomb=nem látszik";
      const msgs = lastPageDiag.messages.length ? ` üzenetek: ${lastPageDiag.messages.join(" | ").slice(0, 300)}` : "";
      log("info", `Regisztráció bizonyíték várakozás — ${Math.round((Date.now() - startedAt) / 1000)}s, ${seen}, ${btn}, captcha=${lastPageDiag.hasCaptcha ? "igen" : "nem"}, url=${lastPageDiag.url}${msgs}`);

    }

    if (signupOk || lastPageDiag.hasConfirmationText) {
      log("info", `Regisztráció elindulása igazolva — ${signupOk ? `${signupOk.kind} HTTP ${signupOk.status}` : "oldalon megerősítő szöveg látszik"}.`);
      return { ok: true, reason: signupOk ? signupOk.kind : "confirmation-text", page: lastPageDiag, network };
    }
    if (signupFailed || precheckFailed || authFailure) {
      const bad = signupFailed || precheckFailed || authFailure;
      return { ok: false, reason: `${bad.kind || "auth"} hiba`, bad, page: lastPageDiag, network, failures };
    }
    if (lastPageDiag.hasCaptcha && Date.now() > startedAt + 45_000 && !precheckOk) {
      return { ok: false, reason: "captcha látszik / silent captcha blokk", page: lastPageDiag, network, failures };
    }
    if (Date.now() > startedAt + 20_000 && lastPageDiag.messages.length > 0 && !precheckOk) {
      return { ok: false, reason: `frontend validáció: ${lastPageDiag.messages.join(" | ")}`, page: lastPageDiag, network, failures };
    }
  }
  const network = diag.network.filter((e) => e.at >= startedAt - 500);
  const failures = diag.request_failures.filter((e) => e.at >= startedAt - 500);
  const precheckOk = network.find((e) => e.kind === "email-precheck" && e.status >= 200 && e.status < 400);
  const btnInfo = lastPageDiag?.submitState
    ? ` Submit gomb: „${lastPageDiag.submitState.text}"${lastPageDiag.submitState.disabled ? " (letiltva)" : ""}.`
    : "";
  const reason = (precheckOk
    ? "email előellenőrzés lefutott, de auth signup hívás nem indult"
    : "nem látszik sem auth signup, sem megerősítő e-mail állapot")
    + btnInfo
    + (lastPageDiag?.hasCaptcha ? " Captcha jelen van az oldalon." : "");
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
          return { ok: true, subject: res.subject || null, from: res.from || null, snippet: res.snippet || null, url: page.url() };
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

// A megerősítő link után a felhasználó általában NINCS beléptetve — enélkül
// viszont nem jelenik meg a csomagválasztó, így a Stripe sem érhető el.
async function signInAfterConfirmation(page, email, password, log) {
  try {
    // A megerősítő link gyakran MÁR beléptet és egyből a csomagválasztóra
    // dob (/elofizetesek?role=pro&first=true). Ilyenkor tilos újra belépni:
    // a #119-es futásnál ez dobta vissza a /regisztracio oldalra
    // "Your email address is not yet confirmed" üzenettel.
    const alreadyIn = await page.evaluate(() => {
      const t = (document.body?.innerText || "").toLowerCase();
      const path = location.pathname.toLowerCase();
      if (/\/profil|\/dashboard|\/fiok/.test(path)) return "profil oldal";
      if (/log ?out|sign ?out|kijelentkez/.test(t)) return "kijelentkezés link látszik";
      if (/\/elofizetes|\/subscription|\/plans/.test(path) && !/sign in|bejelentkez/.test(t)) return "csomagválasztó oldal";
      return null;
    });
    if (alreadyIn) {
      log("info", `Belépés kihagyva: már be vagyunk lépve (${alreadyIn}) — ${page.url()}`);
      return { ok: true, reason: `már belépve (${alreadyIn})`, url: page.url() };
    }

    await page.goto("https://kylo.study/regisztracio", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const state = await inspectAuthForm(page);
      if (state.currentSignup) {
        // Regisztráció módban vagyunk — váltsunk vissza belépésre.
        await clickByText(page, ["sign in", "log in", "login", "belép", "bejelentkez"], log, "Belépés váltó", {});
        await page.waitForTimeout(1500);
      }
      const emailInput = await page.$('input[type="email"], input[name*="mail" i], input[id*="mail" i]');
      const pwInput = await page.$('input[type="password"]');
      if (!emailInput || !pwInput) {
        log("warn", `Belépés ${attempt}/3 — nincs email/jelszó mező (email=${state.emailFields}, pw=${state.passwordFields})`);
        await page.waitForTimeout(2000);
        continue;
      }
      await emailInput.fill(email, { timeout: 5000 }).catch(() => {});
      await pwInput.fill(password, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      const clicked = await clickByText(page, ["sign in", "log in", "login", "belép", "bejelentkez"], log, "Belépés", {});
      await page.waitForTimeout(6000);
      const url = page.url();
      const loggedIn = await page.evaluate(() => {
        const t = (document.body?.innerText || "").toLowerCase();
        return /\/profil|\/dashboard|\/fiok/i.test(location.pathname) || /log ?out|sign ?out|kijelentkez/.test(t);
      });
      log("info", `Belépés ${attempt}/3 — kattintás=${clicked}, url=${url}, belépve=${loggedIn}`);
      if (loggedIn) return { ok: true, url, attempts: attempt };
      await page.waitForTimeout(2500);
    }
    return { ok: false, reason: "a belépés nem lépett tovább", url: page.url() };

  } catch (e) {
    return { ok: false, reason: e.message };
  }
}


// Számlázási adatok űrlapjának kitöltése (a Stripe előtti lépés).
// Nem csak name/id/placeholder alapján keresünk, hanem a látható CÍMKE szövegét is
// nézzük — a /fizetes oldalon a mezőknek gyakran csak label-je van (pl. "House number").
async function fillBillingForm(page, email, log) {
  const result = await page.evaluate(
    ({ billing, email }) => {
      const targets = [
        { keys: ["housenumber", "house number", "hazszam", "házszám", "house_no", "houseno"], value: billing.houseNumber },
        { keys: ["zip", "postal", "postcode", "post code", "iranyitoszam", "irányítószám"], value: billing.postal },
        { keys: ["city", "town", "varos", "város"], value: billing.city },
        { keys: ["address", "line1", "street", "utca", "cim", "cím"], value: billing.line1 },
        { keys: ["email", "e-mail"], value: email },
        { keys: ["phone", "tel"], value: billing.phone },
        { keys: ["name", "nev", "név", "fullname", "cardholder", "billingname"], value: billing.name },
      ];

      const labelTextFor = (n) => {
        let t = "";
        if (n.id) {
          const l = document.querySelector(`label[for="${CSS.escape(n.id)}"]`);
          if (l) t += " " + l.innerText;
        }
        const wrap = n.closest("label");
        if (wrap) t += " " + wrap.innerText;
        const field = n.closest("div");
        if (field) {
          const l2 = field.querySelector("label");
          if (l2) t += " " + l2.innerText;
        }
        return t;
      };

      const setValue = (n, v) => {
        const proto = n instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
        setter.call(n, v);
        n.dispatchEvent(new Event("input", { bubbles: true }));
        n.dispatchEvent(new Event("change", { bubbles: true }));
        n.dispatchEvent(new Event("blur", { bubbles: true }));
      };

      const filled = [];
      const skipped = [];
      const nodes = Array.from(
        document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]), textarea'),
      );
      for (const n of nodes) {
        if (!(n.offsetWidth || n.offsetHeight)) continue;
        if (n.disabled || n.readOnly) continue;
        if (n.value && n.value.trim()) continue;
        const key = `${n.name || ""} ${n.id || ""} ${n.getAttribute("placeholder") || ""} ${n.getAttribute("autocomplete") || ""} ${n.getAttribute("aria-label") || ""} ${labelTextFor(n)}`.toLowerCase();
        const match = targets.find((t) => t.keys.some((k) => key.includes(k)));
        if (match) {
          setValue(n, match.value);
          filled.push(key.trim().slice(0, 60));
        } else {
          // Ismeretlen, de kötelező mező: inkább kitöltjük, mint hogy elakadjunk.
          const required = n.required || /\*/.test(labelTextFor(n));
          if (required) {
            setValue(n, billing.fallback);
            filled.push("(fallback) " + key.trim().slice(0, 60));
          } else {
            skipped.push(key.trim().slice(0, 60));
          }
        }
      }

      // Kötelező jelölőnégyzetek (ÁSZF stb.)
      for (const b of Array.from(document.querySelectorAll('input[type="checkbox"]'))) {
        const ctx = `${b.name || ""} ${b.id || ""} ${labelTextFor(b)}`.toLowerCase();
        if ((b.required || /terms|aszf|ászf|accept|elfogad|agree|privacy|adatkezel/.test(ctx)) && !b.checked) {
          b.click();
        }
      }

      // Natív <select> mezők (pl. közterület jellege: utca / tér / körút ...)
      const selects = [];
      for (const s of Array.from(document.querySelectorAll("select"))) {
        if (!(s.offsetWidth || s.offsetHeight) || s.disabled) continue;
        const cur = String(s.value || "").trim();
        const curText = (s.selectedOptions?.[0]?.innerText || "").trim().toLowerCase();
        const placeholderish = !cur || /válass|valass|select|choose|^-+$/.test(curText);
        if (!placeholderish) continue;
        const opts = Array.from(s.options).filter(
          (o) => String(o.value || "").trim() && !/válass|valass|select|choose/.test((o.innerText || "").toLowerCase()),
        );
        if (!opts.length) continue;
        const ctx = `${s.name || ""} ${s.id || ""} ${labelTextFor(s)}`.toLowerCase();
        const isStreetType = /jelleg|közterület|kozterulet|street ?type|utca ?típus|utca ?tipus|address ?type|cím ?típus/.test(ctx);
        const pick =
          (isStreetType &&
            opts.find((o) => /^(utca|street)$/i.test((o.innerText || "").trim()))) ||
          (isStreetType && opts.find((o) => /utca|street/i.test(o.innerText || ""))) ||
          opts[0];
        s.value = pick.value;
        s.dispatchEvent(new Event("input", { bubbles: true }));
        s.dispatchEvent(new Event("change", { bubbles: true }));
        s.dispatchEvent(new Event("blur", { bubbles: true }));
        selects.push(`${ctx.trim().slice(0, 40)} = ${(pick.innerText || pick.value).trim().slice(0, 20)}`);
      }

      return { filled, skipped, selects };
    },
    { billing: BILLING_TEST, email },
  ).catch((e) => {
    log("warn", `Számlázási űrlap kitöltés hiba: ${e.message}`);
    return { filled: [], skipped: [], selects: [] };
  });

  if (result.selects?.length) {
    log("info", `Számlázási legördülők (natív): ${result.selects.join(" | ")}`);
  }

  // Shadcn/Radix stílusú (nem natív) legördülők: közterület jellege + ország
  const streetTypePicked = await selectComboboxOption(page, log, {
    label: "Közterület jellege",
    labelTexts: ["jelleg", "közterület", "kozterulet", "street type", "utca típusa", "utca tipusa", "address type", "cím típusa"],
    buttonTexts: ["válassz", "select", "típus", "type", "jelleg", "utca"],
    optionTexts: ["utca", "street", "road"],
  }).catch(() => false);
  if (streetTypePicked) log("info", "Számlázás: közterület jellege = utca kiválasztva.");

  // Bármely további üresen maradt Radix legördülő ("Válassz..." feliratú) — az első opciót választjuk,
  // mert ezek gyakran némán blokkolják a továbblépést hibaüzenet nélkül.
  for (let i = 0; i < 3; i++) {
    const picked = await pickFirstEmptyCombobox(page, log);
    if (!picked) break;
  }

  log("info", `Számlázási űrlap: ${result.filled.length} mező kitöltve — ${result.filled.join(" | ") || "nincs"}`);
  return result.filled.length > 0 || streetTypePicked || (result.selects?.length || 0) > 0;
}

// Megkeres egy még ki nem választott (placeholder feliratú) Radix legördülőt és választ benne.
async function pickFirstEmptyCombobox(page, log) {
  const marker = `kylo-empty-combo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const found = await page
    .evaluate((marker) => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return r.width > 3 && r.height > 3 && st.visibility !== "hidden" && st.display !== "none";
      };
      const els = Array.from(document.querySelectorAll('[role="combobox"]')).filter(visible);
      for (const el of els) {
        if (el.getAttribute("data-kylo-combo-done")) continue;
        const txt = (el.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!txt || /válass|valass|select|choose|^-+$/.test(txt)) {
          el.scrollIntoView({ block: "center" });
          el.setAttribute("data-kylo-combo-done", "1");
          el.setAttribute("data-kylo-empty-combo", marker);
          const ctx = (el.closest(".space-y-2")?.innerText || el.parentElement?.innerText || "").replace(/\s+/g, " ").trim();
          return { ctx: ctx.slice(0, 60) };
        }
      }
      return null;
    }, marker)
    .catch(() => null);
  if (!found) return false;
  const handle = await page.$(`[data-kylo-empty-combo="${marker}"]`);
  if (!handle) return false;
  await humanClick(page, handle, { noMisclick: true, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  const ok = await page
    .evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 3 && r.height > 3;
      };
      const opts = Array.from(document.querySelectorAll('[role="option"], [cmdk-item], [role="menuitem"]')).filter(visible);
      if (!opts.length) return null;
      const preferred = opts.find((o) => /^(utca|street)$/i.test((o.innerText || "").trim())) || opts[0];
      const text = (preferred.innerText || "").trim().slice(0, 40);
      preferred.click();
      return text;
    })
    .catch(() => null);
  if (!ok) {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  log("info", `Legördülő kitöltve (${found.ctx || "?"}): ${ok}`);
  await page.waitForTimeout(400);
  return true;
}


// Mi maradt üresen / mi tiltja a "Tovább a fizetéshez" gombot?
async function collectBillingBlockers(page) {
  return page
    .evaluate(() => {
      const label = (n) => {
        const l = n.id ? document.querySelector(`label[for="${CSS.escape(n.id)}"]`) : null;
        return (l?.innerText || n.closest("div")?.querySelector("label")?.innerText || n.name || n.id || "?").trim().slice(0, 40);
      };
      const empty = Array.from(document.querySelectorAll("input, textarea, select"))
        .filter((n) => (n.offsetWidth || n.offsetHeight) && n.type !== "checkbox" && !String(n.value || "").trim())
        .map(label);
      const unselected = Array.from(document.querySelectorAll('[role="combobox"]'))
        .filter((n) => n.offsetWidth || n.offsetHeight)
        .filter((n) => {
          const t = (n.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
          return !t || /válass|valass|select|choose|^-+$/.test(t);
        })
        .map((n) => (n.closest(".space-y-2")?.innerText || n.innerText || "?").replace(/\s+/g, " ").trim().slice(0, 40));
      empty.push(...unselected.map((u) => `[legördülő nincs kiválasztva] ${u}`));

      // A csillag (*) csak a „kötelező mező" jelölés — az nem hibaüzenet.
      // Ezért csak az érdemi, legalább 3 karakteres, betűt tartalmazó szövegeket tartjuk meg.
      const meaningful = (t) => t && t.replace(/\s+/g, " ").trim().length >= 3 && /[\p{L}]/u.test(t);
      const errors = Array.from(
        document.querySelectorAll('[role="alert"], .text-destructive, .text-red-500, .text-red-600, .error, [data-error], [id$="-error"], [id$="-message"]'),
      )
        .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim())
        .filter(meaningful)
        .slice(0, 10);

      // Amelyik mezőt a form érvénytelennek jelöli — névvel és a beírt értékkel együtt,
      // hogy látszódjon, mi nem tetszik neki (pl. rossz formátumú irányítószám).
      const invalid = Array.from(document.querySelectorAll("input, textarea, select"))
        .filter((n) => (n.offsetWidth || n.offsetHeight))
        .filter((n) => n.getAttribute("aria-invalid") === "true" || (n.willValidate && !n.checkValidity()))
        .map((n) => `${label(n)} = "${String(n.value || "").slice(0, 30)}" (${n.validationMessage || "aria-invalid"})`)
        .slice(0, 10);
      errors.push(...invalid);

      // Teljes mezőkép a riporthoz: mi van most ténylegesen beírva.
      const field_values = Array.from(document.querySelectorAll("input, textarea, select"))
        .filter((n) => (n.offsetWidth || n.offsetHeight) && n.type !== "checkbox" && n.type !== "radio")
        .map((n) => `${label(n)}="${String(n.value || "").slice(0, 30)}"`)
        .slice(0, 25);

      const buttons = Array.from(document.querySelectorAll("button")).map((b) => ({
        text: (b.innerText || "").trim().slice(0, 40),
        disabled: b.disabled,
      }));
      return { url: location.href, empty_fields: empty, errors, field_values, buttons };
    })
    .catch(() => null);
}




export async function runKyloSignup({ page, context, spec, log }) {
  const cfg = spec.kylo_signup || {};
  const baseUrl = cfg.base_url || "https://kylo.study";
  const lang = cfg.lang || "en-GB";
  const skin = cfg.skin || "puppy-cat";
  const email = cfg.email;
  const password = cfg.password;
  const currency = cfg.currency || "USD";
  // A mentett workflow felvétele: ebből tudjuk, milyen mezők vannak a regisztrációs
  // űrlapon és milyen sorrendben — nem találgatunk.
  const recordedPlan = planFromRecording(spec.recorded_actions);
  log(
    "info",
    recordedPlan.length > 0
      ? `Mentett regisztrációs felvétel betöltve — ${recordedPlan.length} mező: ${recordedPlan.map((f) => f.id).join(", ")}`
      : "Nincs mentett felvétel a workflow-ban — beépített űrlaptérkép szerint megyünk.",
  );

  if (!email || !password) {
    throw new Error("Hiányzó email / jelszó a signup spec-ből.");
  }

  const steps = [];
  const screenshots = [];
  const langChecks = [];
  let registrationOk = false;
  let emailConfirmed = false;
  let emailLangOk = null;

  // Korai megszakításnál is átadjuk az addig készült screenshotokat és
  // nyelvi ellenőrzéseket, hogy a riportban látszódjon, meddig jutottunk.
  const failEarly = (message) => {
    const err = new Error(message);
    err.partialResult = {
      ok: false,
      email,
      skin,
      lang,
      currency,
      expected_lang: lang,
      kylo_flow_checked: true,
      flow_ok: false,
      language_checks: langChecks,
      language_ok: langChecks.every((c) => c.ok !== false),
      steps,
      screenshots,
    };
    throw err;
  };



  const startUrl = withLang(baseUrl, lang);
  const diag = installSignupDiagnostics(page, email, password, log);

  log("info", `Sign Up indul — ${startUrl} · skin=${skin} · alias=${email} · currency=${currency}`);

  // Teszt-bypass fejléc: csak a Kylo saját domainjére tesszük rá.
  // Fontos: a context.setExtraHTTPHeaders MINDEN kérésre rátenné, így a külső
  // recaptcha/ipapi script-ek CORS preflightja elhasalna. A #12-es futás pontosan
  // emiatt nem jutott auth/signup network hívásig.
  const bypassToken = process.env.BRAIN_KYLO_TEST_BYPASS_TOKEN || cfg.bypass_token;
  if (bypassToken) {
    try {
      const kyloOrigin = new URL(baseUrl).origin;
      await page.route("**/*", async (route) => {
        const request = route.request();
        let sameKyloOrigin = false;
        try {
          sameKyloOrigin = new URL(request.url()).origin === kyloOrigin;
        } catch {}
        if (!sameKyloOrigin) {
          await route.continue();
          return;
        }
        await route.continue({
          headers: {
            ...request.headers(),
            "x-kylo-test-bypass": bypassToken,
            "x-kylo-test-email": email,
          },
        });
      });
      log("info", `Kylo teszt-bypass fejléc aktív, csak saját domainre: ${kyloOrigin}`);
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
  // A nyitóoldal szándékosan MINDIG angol — ezt is ellenőrizzük.
  langChecks.push(await auditLanguage(page, "nyitóoldal (angol)", log, "en-GB"));


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
  // A logó mögötti belépési párbeszédnek már a cél nyelven kell megjelennie.
  langChecks.push(await auditLanguage(page, "belépési párbeszéd", log, lang));

  const signupMode = await ensureSignupMode(page, log);
  screenshots.push(await shot(page, "2b-signup-mode-check"));
  steps.push({ step: "signup-mode", ...signupMode });
  if (!signupMode.ok) {
    failEarly(`Nem jutottunk regisztrációs űrlapig: ${signupMode.reason || "ismeretlen ok"}. url=${page.url()}`);
  }
  // A regisztrációs űrlapnak is a cél nyelven kell megjelennie.
  langChecks.push(await auditLanguage(page, "regisztrációs űrlap", log, lang));

  // 3) űrlap kitöltés
  const filled = await fillSignupForm(page, email, password, log, recordedPlan);
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
      failEarly(
        `A regisztráció nem indult el, ezért nem várok Gmail e-mailre. Ok: ${evidence.reason}.${pageMessages}${networkSummary}${failureSummary} url=${page.url()}`,
      );

    }
    registrationOk = true;

    const confirmation = await openGmailConfirmationLink(page, email, log);
    screenshots.push(await shot(page, "4b-after-email-confirm"));
    emailConfirmed = confirmation.ok === true;
    // A konfirmációs e-mail (tárgy + kivonat) nyelvi ellenőrzése.
    // A levelek tele vannak láthatatlan „preheader" karakterekkel (zero-width,
    // BOM stb.) — ezeket ki kell szűrni, különben a szöveg hosszúnak tűnik,
    // miközben valódi szó alig van benne, és téves nyelvi bukást okoz.
    const emailTextRaw = `${confirmation.subject || ""} ${confirmation.snippet || ""}`.trim();
    const emailText = emailTextRaw
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (emailConfirmed && emailText) {
      const emailCheck = auditTextLanguage("konfirmációs e-mail", emailText, lang);
      // A tranzakciós e-mail nyelvét a fiók profil-nyelve dönti el (nálunk en-GB),
      // nem a felület nyelve — ezért az angol levél nem bukás, csak megjegyzés.
      // Rövid tárgy+kivonat esetén kevés a nyelvi jel — ilyenkor sem bukás.
      if (emailCheck.ok === false && ((emailCheck.english_hits ?? 0) >= 1 || emailText.length < 160)) {
        emailCheck.ok = null;
        emailCheck.reason = "angol / túl rövid levélszöveg (a fiók profil-nyelve en-GB) — nem bukás";
      }

      langChecks.push(emailCheck);
      emailLangOk = emailCheck.ok;
      log(
        emailCheck.ok === false ? "warn" : "info",
        `Konfirmációs e-mail nyelve: ${emailCheck.ok === false ? `HIBA (${emailCheck.reason})` : emailCheck.ok === null ? `nem értékelhető (${emailCheck.reason || "kevés jel"})` : "rendben"}`,
      );
    }

    // A megerősítő link megnyitása utáni oldal is a cél nyelven kell legyen.
    if (emailConfirmed) langChecks.push(await auditLanguage(page, "e-mail megerősítés utáni oldal", log, lang));
    steps.push({ step: "email-confirm", ...confirmation, language_ok: emailLangOk });

    // 3b) Belépés a frissen megerősített fiókkal — enélkül nincs csomagválasztó.
    if (emailConfirmed) {
      const signedIn = await signInAfterConfirmation(page, email, password, log);
      screenshots.push(await shot(page, "4c-after-signin"));
      steps.push({ step: "sign-in", ...signedIn });
      if (!signedIn.ok) {
        log("warn", `Belépés nem sikerült a megerősítés után: ${signedIn.reason || "ismeretlen ok"}`);
      }
    }
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

  // 5) Csomagválasztó → számlázási adatok → Stripe.
  //    Minden köztes oldalnak a proxy szerinti nyelven kell megjelennie.
  await page.waitForTimeout(1500);
  // Ha valamiért nem a csomagválasztón állunk (pl. visszadobott a /regisztracio),
  // navigáljunk oda közvetlenül, különben a Stripe lépés biztosan elbukik.
  try {
    if (!/\/elofizetes|\/subscription|\/plans/i.test(page.url()) && !isStripeUrl(page.url())) {
      log("info", `Nem a csomagválasztón állunk (${page.url()}) — átnavigálok az előfizetési oldalra.`);
      await page.goto("https://kylo.study/elofizetesek?role=pro&first=true", { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    log("warn", `Csomagválasztó navigáció hiba: ${e.message}`);
  }
  screenshots.push(await shot(page, "5-plan-page"));
  langChecks.push(await auditLanguage(page, "csomagválasztó", log, lang));


  const subClicked = await clickByText(page, CLICK_HINTS_SUBSCRIBE, log, "Előfizetés / Csomag");
  await page.waitForTimeout(4500);
  screenshots.push(await shot(page, "5b-after-plan-click"));
  let currentUrl = page.url();
  let reachedStripe = isStripeUrl(currentUrl);
  steps.push({ step: "subscribe-cta", clicked: subClicked, url: currentUrl, reached_stripe: reachedStripe });

  // Ha még nem vagyunk a Stripe-on, akkor a számlázási űrlap következik.
  if (!reachedStripe) {
    langChecks.push(await auditLanguage(page, "számlázási űrlap", log, lang));
    let billingFilled = await fillBillingForm(page, email, log);
    screenshots.push(await shot(page, "5c-billing-filled"));
    let payClicked = await clickByText(page, CLICK_HINTS_PAY, log, "Fizetés / Tovább");
    // A gomb után az oldal navigálhat (Stripe) — előbb hagyjuk leülni,
    // csak utána nyúlunk megint a DOM-hoz, különben „megszűnt a kontextus" hibát kapunk.
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // Ha nem indult el a fizetés, megnézzük mi tiltja (üres kötelező mező,
    // hibaüzenet, letiltott gomb), pótoljuk és újra próbáljuk egyszer.
    let blockers = null;
    if (!isStripeUrl(page.url())) {
      blockers = await collectBillingBlockers(page);
      if (blockers) {
        log(
          "warn",
          `Számlázás elakadt — üres mezők: ${blockers.empty_fields.join(", ") || "nincs"} · hibák: ${blockers.errors.join(" / ") || "nincs"}`,
        );
        if (blockers.field_values?.length) {
          log("info", `Számlázási mezők jelenlegi tartalma: ${blockers.field_values.join(" | ")}`);
        }
      }
      if (!isStripeUrl(page.url())) {
        billingFilled = (await fillBillingForm(page, email, log)) || billingFilled;
        await page.waitForTimeout(1200);
        payClicked = (await clickByText(page, CLICK_HINTS_PAY, log, "Fizetés / Tovább (2. próba)")) || payClicked;
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      }
    }

    steps.push({
      step: "billing",
      filled: billingFilled,
      pay_clicked: payClicked,
      url: page.url(),
      blockers,
    });

    const stripeDeadline = Date.now() + 60_000;
    while (Date.now() < stripeDeadline) {
      currentUrl = page.url();
      if (isStripeUrl(currentUrl)) break;
      await page.waitForTimeout(1500);
    }
    currentUrl = page.url();
    reachedStripe = isStripeUrl(currentUrl);
    if (!reachedStripe) {
      const finalBlockers = await collectBillingBlockers(page);
      if (finalBlockers) {
        steps.push({ step: "billing-blocked", ...finalBlockers });
        log(
          "warn",
          `Stripe nem nyílt meg — üres mezők: ${finalBlockers.empty_fields.join(", ") || "nincs"} · hibák: ${finalBlockers.errors.join(" / ") || "nincs"}`,
        );
      }
    }
    screenshots.push(await shot(page, "5d-after-pay-click"));
  }

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

      // Kártyamezők — a hosted Stripe Checkout ma már a fő dokumentumban
      // tartja a mezőket (#cardNumber / #cardExpiry / #cardCvc), a régi
      // Elements viszont iframe-eket használ (name="cardnumber"). Mindkettőt
      // kezeljük, és a frame-listát MINDIG frissen kérjük le, mert a
      // korábbi kód a betöltés előtt fagyasztotta be — így sosem talált mezőt.
      const CARD_SELECTORS = [
        "#cardNumber",
        'input[name="cardNumber"]',
        'input[name="cardnumber"]',
        'input[autocomplete="cc-number"]',
        'input[data-elements-stable-field-name="cardNumber"]',
        'input[placeholder*="1234"]',
      ].join(", ");
      const EXP_SELECTORS = [
        "#cardExpiry",
        'input[name="cardExpiry"]',
        'input[name="exp-date"]',
        'input[autocomplete="cc-exp"]',
        'input[data-elements-stable-field-name="cardExpiry"]',
      ].join(", ");
      const CVC_SELECTORS = [
        "#cardCvc",
        'input[name="cardCvc"]',
        'input[name="cvc"]',
        'input[autocomplete="cc-csc"]',
        'input[data-elements-stable-field-name="cardCvc"]',
      ].join(", ");

      const fillAnywhere = async (selector, value, label) => {
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline) {
          // fő dokumentum + minden (frissen lekért) iframe
          const scopes = [page, ...page.frames()];
          for (const sc of scopes) {
            try {
              const el = await sc.$(selector);
              if (!el) continue;
              const visible = await el.isVisible().catch(() => false);
              if (!visible) continue;
              await el.click({ timeout: 3000 }).catch(() => {});
              await el.fill("", { timeout: 3000 }).catch(() => {});
              await el.type(value, { delay: 60 });
              const got = await el.inputValue().catch(() => "");
              if (got && got.replace(/\s/g, "").length >= 3) {
                log("info", `Stripe: ${label} kitöltve`);
                return true;
              }
            } catch {}
          }
          await page.waitForTimeout(1000);
        }
        log("warn", `Stripe: ${label} mező NEM található (25 mp után sem)`);
        return false;
      };

      const cardOk = await fillAnywhere(CARD_SELECTORS, "4242424242424242", "kártyaszám");
      const expOk = await fillAnywhere(EXP_SELECTORS, "1234", "lejárat");
      const cvcOk = await fillAnywhere(CVC_SELECTORS, "123", "CVC");
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
      if (!stripeFilled) {
        // Diagnosztika: mit lát egyáltalán az oldalon / a frame-ekben?
        try {
          const seen = [];
          for (const sc of [page, ...page.frames()]) {
            const inputs = await sc.$$eval("input", (els) =>
              els.map((e) => ({
                id: e.id || null,
                name: e.getAttribute("name"),
                ac: e.getAttribute("autocomplete"),
                ph: e.getAttribute("placeholder"),
              })),
            ).catch(() => []);
            if (inputs.length) seen.push(...inputs);
          }
          steps.push({ step: "stripe-fields-seen", inputs: seen.slice(0, 40) });
          log("warn", `Stripe: talált mezők = ${JSON.stringify(seen).slice(0, 800)}`);
        } catch {}
      }

      screenshots.push(await shot(page, "6-stripe-filled"));

      if (stripeFilled) {
        // A Stripe oldal a betöltés után gyakran "lejjebb ugrik" (layout shift),
        // ezért görgetünk, megvárjuk hogy megálljon, és csak utána kattintunk.
        const PAY_RE = /pay|fizet|subscribe|előfizet|start|begin|jetzt|bezahl|paga|pagar|payer/i;
        const markPayButton = async (scope) =>
          scope
            .evaluate((src) => {
              const re = new RegExp(src, "i");
              const btns = Array.from(
                document.querySelectorAll('button[type="submit"], button.SubmitButton, button, [role="button"]'),
              );
              for (const b of btns) {
                const t = (b.innerText || b.textContent || "").trim();
                const r = b.getBoundingClientRect();
                if (r.width < 5 || r.height < 5) continue;
                if (b.disabled) continue;
                if (b.type === "submit" || re.test(t)) {
                  b.setAttribute("data-kylo-pay", "1");
                  b.scrollIntoView({ block: "center", behavior: "instant" });
                  return t.slice(0, 60) || "submit";
                }
              }
              return null;
            }, PAY_RE.source)
            .catch(() => null);

        let submitted = false;
        for (let attempt = 1; attempt <= 3 && !submitted; attempt++) {
          // Görgessünk az oldal aljára, hogy a lecsúszott gomb is látszódjon.
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
          await page.waitForTimeout(1200);

          const scopes = [page, ...page.frames()];
          for (const sc of scopes) {
            const label = await markPayButton(sc);
            if (!label) continue;
            const loc = sc.locator('[data-kylo-pay="1"]').first();
            try {
              await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
              await page.waitForTimeout(500); // hagyjuk leülni a layout ugrást
              await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
              await loc.click({ timeout: 5000 });
              submitted = true;
              log("info", `Stripe fizetés gomb megnyomva (görgetés után): „${label}" — ${attempt}. próba.`);
            } catch (e) {
              // Tartalék: közvetlen DOM kattintás, ha a valódi egérkattintás nem megy.
              const forced = await sc
                .evaluate(() => {
                  const b = document.querySelector('[data-kylo-pay="1"]');
                  if (!b) return false;
                  b.click();
                  return true;
                })
                .catch(() => false);
              if (forced) {
                submitted = true;
                log("info", `Stripe fizetés gomb megnyomva (tartalék kattintás) — ${attempt}. próba.`);
              } else {
                log("warn", `Stripe fizetés gomb kattintás hiba (${attempt}.): ${e.message}`);
              }
            }
            if (submitted) break;
          }
          if (!submitted) await page.waitForTimeout(1500);
        }
        stripeSubmitted = submitted;
        log("info", `Stripe submit: ${submitted}`);
        screenshots.push(await shot(page, "6a-stripe-pay-click"));
      }


      steps.push({ step: "stripe-fill", cardOk, expOk, cvcOk, submitted: stripeSubmitted });
    } catch (e) {
      log("warn", `Stripe kitöltés hiba: ${e.message}`);
      steps.push({ step: "stripe-fill", error: e.message });
    }
  }

  // 6b) Stripe callback → "sikeres fizetés" oldal a Kylón, a cél nyelven.
  if (stripeSubmitted) {
    try {
      const cbDeadline = Date.now() + 90_000;
      while (Date.now() < cbDeadline) {
        const u = page.url();
        if (/kylo\.study/i.test(u) && !isStripeUrl(u)) break;
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(1500);
      screenshots.push(await shot(page, "6b-payment-success"));
      const back = /kylo\.study/i.test(page.url()) && !isStripeUrl(page.url());
      if (back) {
        langChecks.push(await auditLanguage(page, "sikeres fizetés oldal", log, lang));
      } else {
        log("warn", "A Stripe callback nem tért vissza a Kylo oldalra 90 másodpercen belül.");
      }
      steps.push({ step: "payment-callback", returned: back, url: page.url() });
    } catch (e) {
      log("warn", `Fizetési callback várakozás hiba: ${e.message}`);
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

  // A callback után 3 másodperc várakozás, majd a profil oldal nyelvi ellenőrzése.
  await page.waitForTimeout(3000);
  screenshots.push(await shot(page, "7-final-profile"));
  if (reachedProfile) langChecks.push(await auditLanguage(page, "profil oldal", log, lang));
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

  // ── Sikerességi kritériumok kiértékelése ────────────────────────────────
  const failedLangChecks = langChecks.filter((c) => c.ok === false);
  const languageOk = failedLangChecks.length === 0;

  const criteria = {
    landing_english: langChecks.find((c) => c.label === "nyitóoldal (angol)")?.ok !== false,
    auth_dialog_language: langChecks.find((c) => c.label === "belépési párbeszéd")?.ok !== false,
    signup_form_language: langChecks.find((c) => c.label === "regisztrációs űrlap")?.ok !== false,
    registration_submitted: registrationOk,
    confirmation_email_received: emailConfirmed,
    confirmation_email_language: emailLangOk !== false,
    plan_page_language: langChecks.find((c) => c.label === "csomagválasztó")?.ok !== false,
    billing_form_language: langChecks.find((c) => c.label === "számlázási űrlap")?.ok !== false,
    reached_stripe: reachedStripe,
    stripe_paid: stripeSubmitted,
    payment_success_page_language: langChecks.find((c) => c.label === "sikeres fizetés oldal")?.ok !== false,
    reached_profile: reachedProfile,
    profile_page_language: langChecks.find((c) => c.label === "profil oldal")?.ok !== false,
  };

  const CRITERIA_LABELS = {
    landing_english: "A nyitóoldal angol",
    auth_dialog_language: "Belépési párbeszéd a cél nyelven",
    signup_form_language: "Regisztrációs űrlap a cél nyelven",
    registration_submitted: "Regisztráció elküldve",
    confirmation_email_received: "Konfirmációs e-mail megérkezett",
    confirmation_email_language: "Konfirmációs e-mail a cél nyelven",
    plan_page_language: "Csomagválasztó a cél nyelven",
    billing_form_language: "Számlázási űrlap a cél nyelven",
    reached_stripe: "Stripe fizetés elérve",
    stripe_paid: "Stripe fizetés elküldve",
    payment_success_page_language: "Sikeres fizetés oldal a cél nyelven",
    reached_profile: "Profil oldal elérve a callback után",
    profile_page_language: "Profil oldal a cél nyelven",
  };

  const criteriaFailed = Object.entries(criteria)
    .filter(([, v]) => v !== true)
    .map(([k]) => CRITERIA_LABELS[k] || k);

  const flowOk = criteriaFailed.length === 0;

  log(
    flowOk ? "info" : "warn",
    flowOk
      ? "Minden sikerességi kritérium teljesült — a Kylo Sign Up teszt SIKERES."
      : `Nem teljesült kritériumok (${criteriaFailed.length}): ${criteriaFailed.join(", ")}`,
  );

  const result = {
    ok: flowOk,
    email,
    skin,
    lang,
    currency,
    expected_lang: lang,
    reached_stripe: reachedStripe,
    stripe_filled: stripeFilled,
    stripe_submitted: stripeSubmitted,
    reached_profile: reachedProfile,
    profile_url: profileUrl,
    final_url: finalUrl,
    kylo_flow_checked: true,
    flow_ok: flowOk,
    criteria,
    criteria_failed: criteriaFailed,
    language_checks: langChecks,
    language_ok: languageOk,
    steps,
    screenshots,
  };

  if (!flowOk) {
    const err = new Error(`Kylo signup nem teljesítette a kritériumokat: ${criteriaFailed.join(", ")}. final_url=${finalUrl}`);
    err.partialResult = result;
    throw err;
  }

  return result;
}

