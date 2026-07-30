// worker/executor/scripts/lang-audit.js
//
// Közös nyelvi ellenőrzés a Kylo teszt-futásokhoz.
//
// Szabály (a megrendelő kritériumai szerint):
//  - a kylo.study nyitóoldala ("/") MINDIG angol, ez sosem nyelvi hiba,
//  - minden más oldalnak (belépési párbeszéd, regisztrációs űrlap, konfirmációs
//    e-mail, csomagválasztó, számlázási űrlap, sikeres fizetés oldal, profil)
//    a proxy geolokációja szerinti nyelven kell megjelennie,
//  - a Stripe checkout kivétel: azt nem mi fordítjuk, nem ellenőrizzük.

import { visionExtract } from "./brain-tasks/brain-api.js";

export const LANG_MARKERS = {
  en: ["the", "and", "your", "with", "sign in", "password", "account", "free", "price", "start"],
  hu: ["és", "hogy", "jelszó", "bejelentkezés", "fiók", "ingyenes", "árak", "beállítások", "előfizetés"],
  de: ["und", "das", "mit", "passwort", "anmelden", "konto", "kostenlos", "preise", "einstellungen"],
  fr: ["et", "le", "vous", "mot de passe", "connexion", "compte", "gratuit", "prix", "paramètres"],
  es: ["y", "el", "contraseña", "iniciar sesión", "cuenta", "gratis", "precios", "ajustes"],
  it: ["e", "il", "password", "accedi", "account", "gratuito", "prezzi", "impostazioni"],
  pt: ["e", "o", "senha", "entrar", "conta", "grátis", "preços", "configurações"],
  nl: ["en", "het", "wachtwoord", "inloggen", "account", "gratis", "prijzen", "instellingen"],
  pl: ["i", "hasło", "zaloguj", "konto", "darmowy", "ceny", "ustawienia", "nie"],
  cs: ["a", "heslo", "přihlásit", "účet", "zdarma", "ceny", "nastavení"],
  ro: ["și", "parolă", "conectare", "cont", "gratuit", "prețuri", "setări"],
  tr: ["ve", "şifre", "giriş", "hesap", "ücretsiz", "fiyatlar", "ayarlar"],
  el: ["και", "κωδικός", "σύνδεση", "λογαριασμός", "δωρεάν", "τιμές", "ρυθμίσεις"],
  sv: ["och", "lösenord", "logga in", "konto", "gratis", "priser", "inställningar"],
  fi: ["ja", "salasana", "kirjaudu", "tili", "ilmainen", "hinnat", "asetukset"],
  no: ["og", "passord", "logg inn", "konto", "gratis", "priser", "innstillinger"],
  da: ["og", "adgangskode", "log ind", "konto", "gratis", "priser", "indstillinger"],
  ru: ["и", "пароль", "войти", "аккаунт", "бесплатно", "цены", "настройки"],
  ja: ["ログイン", "パスワード", "アカウント", "無料", "料金", "設定"],
  ko: ["로그인", "비밀번호", "계정", "무료", "요금", "설정"],
  zh: ["登录", "密码", "账户", "免费", "价格", "设置", "帳戶", "登入", "免費", "價格", "設定"],
  ar: ["كلمة المرور", "تسجيل الدخول", "حساب", "مجاني", "الأسعار", "الإعدادات"],
  hi: ["पासवर्ड", "लॉग इन", "खाता", "मुफ़्त", "कीमत", "सेटिंग"],
  uk: ["і", "пароль", "увійти", "обліковий", "безкоштовно", "ціни", "налаштування"],
  vi: ["và", "mật khẩu", "đăng nhập", "tài khoản", "miễn phí", "giá", "cài đặt"],
  th: ["รหัสผ่าน", "เข้าสู่ระบบ", "บัญชี", "ฟรี", "ราคา", "ตั้งค่า"],
  id: ["dan", "kata sandi", "masuk", "akun", "gratis", "harga", "pengaturan"],
};

export function isLandingUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "" || /^\/(index|home)\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function isStripeUrl(url) {
  return /(^|\/\/|\.)stripe\.com/i.test(String(url || ""));
}

function langAuditFn(expectedLang) {
  const expected = String(expectedLang || "en-GB");
  const prefix = expected.toLowerCase().split("-")[0];
  const markers = LANG_MARKERS[prefix] || [];
  const english = LANG_MARKERS.en;
  return `(() => {
  const EXPECTED = ${JSON.stringify(expected)};
  const PREFIX = ${JSON.stringify(prefix)};
  const MARKERS = ${JSON.stringify(markers)};
  const ENGLISH = ${JSON.stringify(english)};
  const text = (document.body?.innerText || "").replace(/\\s+/g, " ").trim();
  const sample = text.slice(0, 20000);
  const lower = sample.toLowerCase();
  const count = (list) => list.filter((w) => lower.includes(w.toLowerCase())).length;
  return {
    url: location.href,
    expected_lang: EXPECTED,
    html_lang: document.documentElement.getAttribute("lang") || null,
    html_lang_ok: !!document.documentElement.getAttribute("lang")
      && document.documentElement.getAttribute("lang").toLowerCase().split("-")[0] === PREFIX,
    expected_hits: count(MARKERS),
    english_hits: count(ENGLISH),
    text_length: sample.length,
    sample: sample.slice(0, 400),
  };
})()`;
}

// Szöveg (pl. e-mail tárgy + kivonat) nyelvi értékelése — nincs hozzá DOM.
export function auditTextLanguage(label, text, expectedLang) {
  const expected = String(expectedLang || "en-GB");
  const prefix = expected.toLowerCase().split("-")[0];
  const markers = LANG_MARKERS[prefix] || [];
  const lower = String(text || "").toLowerCase();
  const count = (list) => list.filter((w) => lower.includes(w.toLowerCase())).length;
  const expectedHits = count(markers);
  const englishHits = count(LANG_MARKERS.en);
  if (lower.trim().length < 25) {
    return { label, expected_lang: expected, ok: null, reason: "kevés szöveg", sample: lower.slice(0, 200) };
  }
  let ok;
  let reason = null;
  if (prefix === "en") {
    ok = englishHits >= 2;
    if (!ok) reason = "nem angol tartalom";
  } else {
    ok = expectedHits >= 1 && !(englishHits >= 3 && expectedHits === 0);
    if (!ok) reason = englishHits >= 2 ? "angol fallback (nincs fordítás)" : "nem az elvárt nyelv";
  }
  return {
    label,
    expected_lang: expected,
    expected_hits: expectedHits,
    english_hits: englishHits,
    ok,
    reason,
    sample: String(text || "").slice(0, 300),
  };
}

// Oldal nyelvi ellenőrzése. A landing mindig angolként értékelődik,
// a Stripe oldalt pedig egyáltalán nem értékeljük (ok: null).
export async function auditLanguage(page, label, log, expectedLang) {
  let currentUrl = "";
  try { currentUrl = page.url(); } catch {}

  if (isStripeUrl(currentUrl)) {
    log?.("info", `Nyelvi ellenőrzés (${label}): Stripe oldal — kihagyva`);
    return { label, url: currentUrl, ok: null, reason: "Stripe oldal (nem a mi fordításunk)", skipped: true };
  }

  const landing = isLandingUrl(currentUrl);
  const expected = landing ? "en-GB" : String(expectedLang || "en-GB");
  const prefix = expected.toLowerCase().split("-")[0];

  try {
    const r = await page.evaluate(langAuditFn(expected));
    let ok;
    let reason = "";
    if (r.text_length < 40) {
      ok = null;
      reason = "kevés szöveg";
    } else if (prefix === "en") {
      ok = r.html_lang_ok || r.english_hits >= 2;
      if (!ok) reason = "nem angol tartalom";
    } else {
      const looksExpected = r.html_lang_ok || r.expected_hits >= 2;
      const looksEnglish = r.english_hits >= 3 && r.expected_hits === 0;
      ok = looksExpected && !(looksEnglish && !r.html_lang_ok);
      if (!ok) reason = looksEnglish ? "angol fallback (nincs fordítás)" : "nem az elvárt nyelv";
    }
    log?.(
      ok === false ? "warn" : "info",
      ok === false
        ? `Nyelvi ellenőrzés (${label}): HIBA — elvárt ${expected}, de ${reason} (html lang=${r.html_lang ?? "?"}, elvárt találat=${r.expected_hits}, angol találat=${r.english_hits}) · ${r.url}`
        : ok === null
          ? `Nyelvi ellenőrzés (${label}): kihagyva (${reason})`
          : `Nyelvi ellenőrzés (${label}): rendben, ${expected} nyelvű tartalom`,
    );
    return { label, ...r, ok, reason: reason || null, landing_page: landing };
  } catch (e) {
    return { label, ok: null, expected_lang: expected, error: e.message };
  }
}
