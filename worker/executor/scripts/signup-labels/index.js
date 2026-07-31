// worker/executor/scripts/signup-labels/index.js
//
// A Kylo.study SAJÁT fordításaiból kinyert feliratszótár.
// Forrás: Kylo.study projekt `src/i18n/locales/<lang>.json` (register / login /
// checkout / emailConfirmation / nav blokkok). Nem AI-fordítás, hanem pontosan
// az a szöveg, amit a termék ténylegesen kiír — így a robot ugyanazt keresi,
// amit a felhasználó lát.
//
// Használat:
//   import { hintsFor } from "./signup-labels/index.js";
//   const L = hintsFor("de");           // vagy "de-AT", "pt-BR", "en-GB"
//   L.signupCta   -> ["registrieren", "konto erstellen", ...]
//   L.fields.email -> "e-mail-adresse"

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));

/** Amelyik nyelvekre van kinyert szótárfájl. */
export const AVAILABLE_LANGS = [
  "en", "hu", "de", "fr", "es", "it", "pt", "pl", "nl", "sv", "da", "fi",
  "ar", "hi", "zh", "ja", "ko", "ru", "ro", "sl", "hr", "cs", "sk", "tr",
  "el", "sr",
];

const cache = new Map();

function baseCode(lang) {
  return String(lang || "en").toLowerCase().split(/[-_]/)[0];
}

/** Nyers szótár betöltése (hiány esetén angol). */
export function loadLabels(lang) {
  const code = AVAILABLE_LANGS.includes(baseCode(lang)) ? baseCode(lang) : "en";
  if (cache.has(code)) return cache.get(code);
  let data = null;
  try {
    const file = join(DIR, `${code}.json`);
    if (existsSync(file)) data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    data = null;
  }
  if (!data && code !== "en") {
    const fallback = loadLabels("en");
    cache.set(code, fallback);
    return fallback;
  }
  const safe = data || { lang: code, register: {}, login: {}, nav: {}, checkout: {}, emailConfirmation: {} };
  cache.set(code, safe);
  return safe;
}

function clean(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const v = String(raw || "").trim().toLowerCase();
    // A túl hosszú (mondat jellegű) feliratokat nem használjuk gombkeresésre.
    if (!v || v.length > 60) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Egy nyelv összes keresési fogódzója.
 * Mindig az angol változatot is hozzáfűzzük tartalékként, mert a Kylo
 * néha nem fordít le minden kulcsot (fallbackLng: "en").
 */
export function hintsFor(lang) {
  const L = loadLabels(lang);
  const E = loadLabels("en");
  const r = L.register || {};
  const lg = L.login || {};
  const nv = L.nav || {};
  const co = L.checkout || {};
  const er = E.register || {};
  const eg = E.login || {};
  const en = E.nav || {};
  const ec = E.checkout || {};

  return {
    lang: baseCode(lang),
    // Landing → regisztráció / belépés CTA
    signupCta: clean([
      nv.register, r.title, r.submitButton, lg.registerLink,
      en.register, er.title, er.submitButton, eg.registerLink,
    ]),
    // Belépés ↔ regisztráció módváltó a auth oldalon
    signupMode: clean([
      r.submitButton, r.title, lg.noAccount, lg.registerLink,
      er.submitButton, er.title, eg.noAccount, eg.registerLink,
    ]),
    // Amit KERÜLNI kell, amikor regisztrációt keresünk
    signinReject: clean([
      lg.title, lg.submitButton, lg.loginLink, lg.hasAccount,
      eg.title, eg.submitButton, eg.loginLink, eg.hasAccount,
    ]),
    // Számlázási oldal „tovább a fizetéshez" gomb
    pay: clean([
      co.continuePay, co.continueSocial, co.processing,
      ec.continuePay, ec.continueSocial,
    ]),
    // Jogi checkboxok címkéi (ezeket kell bepipálni)
    legal: clean([
      r.acceptTerms, r.termsLink, r.acceptPrivacy, r.privacyLink,
      er.acceptTerms, er.termsLink, er.acceptPrivacy, er.privacyLink,
    ]),
    // Mezőcímkék — a mezőpárosításhoz (label / placeholder / aria-label)
    fields: {
      email: clean([r.email, er.email]),
      password: clean([r.password, er.password]),
      passwordConfirm: clean([r.passwordConfirm, er.passwordConfirm]),
      firstName: clean([r.firstName, er.firstName]),
      lastName: clean([r.lastName, er.lastName]),
      country: clean([r.country, co.country, er.country, ec.country]),
      postalCode: clean([r.postalCode, co.postalCode, er.postalCode, ec.postalCode]),
      city: clean([r.address, co.city, er.address, ec.city]),
      street: clean([r.streetName, co.street, er.streetName, ec.street]),
      houseNumber: clean([r.houseNumber, co.houseNumber, er.houseNumber, ec.houseNumber]),
      birthDate: clean([r.birthDate, er.birthDate]),
      billingName: clean([co.billingName, co.fullName, ec.billingName, ec.fullName]),
    },
    // Konfirmációs oldal / e-mail elvárt szövege (nyelvi audithoz)
    emailConfirmation: clean([
      L.emailConfirmation?.title, L.emailConfirmation?.description,
    ]),
    raw: L,
  };
}

/** Minden nyelv adott mezőcímkéje egy tömbben — nyelvfüggetlen tartalékkereséshez. */
export function allHints(pick) {
  const out = [];
  for (const code of AVAILABLE_LANGS) {
    try {
      const h = hintsFor(code);
      const v = pick(h);
      if (Array.isArray(v)) out.push(...v);
    } catch { /* hiányzó szótár — kihagyjuk */ }
  }
  return clean(out);
}
