// worker/executor/scripts/brain-tasks/record-replay.js
//
// Felvétel-lejátszó executor. A `spec.recorded_actions` tömböt játssza le
// emberi módon, végül visszaadja a friss cookie-kat a `cookies_export`
// mezőben — a Brain `worker/complete` végpont innen menti titkosítva a
// `workflow_credentials.cookie_ciphertext`-be.
//
// Automatikus behelyettesítés a `type` lépéseknél (felvétel-idejű plain
// jelszó/2FA elkerülésére):
//   - a rögzítés karakterenkénti `type` eventeket ment; ezeket "gépelési
//     szakaszokra" bontjuk (két nem-type esemény közti szakasz)
//   - ha a szakasz összefűzött szövege
//        · 6 karakter csupa szám  → friss TOTP-t generálunk (creds.totpSecret)
//        · érvényes e-mail       → creds.username-t használjuk (ha van)
//        · vegyes eset+szám/szimb és >=8 hosszú → creds.password-öt használjuk
//     különben a felvett szöveget írjuk vissza.
//
// A `click`/`scroll`/`key`/`navigate` lépéseknél nem substitúlunk, csak
// humanizáljuk a mozgást és a szüneteket.

import { humanWait, humanThink, humanType } from "../humanize.js";
import { generateTotp } from "../totp.js";
import { getGmailConfirmationLink } from "./brain-api.js";

function rand() { return Math.random(); }
function randRange(a, b) { return a + rand() * (b - a); }
function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }

const KYLO_LOGO_UNLOCK_FN = `async (requestedClicks) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width >= 8 && r.height >= 8 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0.01;
  };
  const all = [];
  for (const selector of ['header button', 'header a', 'button[aria-label*="Kylo" i]', 'a[aria-label*="Kylo" i]', '[data-testid*="logo" i]', 'img[alt*="Kylo" i]']) {
    try { all.push(...document.querySelectorAll(selector)); } catch {}
  }
  let el = Array.from(new Set(all)).find((node) => {
    const text = String(node.innerText || node.textContent || node.getAttribute?.('aria-label') || node.getAttribute?.('alt') || '').trim();
    return visible(node) && (/kylo/i.test(text) || node.querySelector?.('img') || /logo/i.test(String(node.className || '')));
  });
  if (el && el.tagName === 'IMG') el = el.closest('button, a, [role="button"]') || el;
  if (!el) return { ok: false, reason: 'Kylo logó/button nem található', url: location.href };
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + Math.min(Math.max(r.width / 2, 8), Math.max(8, r.width - 8)));
  const y = Math.round(r.top + Math.min(Math.max(r.height / 2, 8), Math.max(8, r.height - 8)));
  const clicks = Math.max(1, Math.min(12, Number(requestedClicks) || 7));
  let sent = 0;
  for (let i = 0; i < clicks; i += 1) {
    const direct = document.elementFromPoint(x, y);
    const target = direct?.closest?.('button, a, [role="button"]') || el;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window }));
    sent += 1;
    await sleep(210 + Math.round(Math.random() * 110));
  }
  await sleep(850);
  return { ok: true, clicks: sent, url: location.href };
}`;

function looksLikeEmail(s) {
  return /^[^\s@]{1,64}@[^\s@]{1,64}\.[^\s@]{2,}$/.test(s);
}
function looksLikeTotp(s) {
  return /^\d{6}$/.test(s);
}
function looksLikePassword(s) {
  if (s.length < 8) return false;
  const hasUpper = /[A-Z]/.test(s);
  const hasLower = /[a-z]/.test(s);
  const hasDigit = /\d/.test(s);
  const hasSym = /[^A-Za-z0-9]/.test(s);
  // Bitwardenből általában erős jelszó jön: legalább 3 kategória, vagy tiszta
  // paste (nem karakterenként gépelt) és >=12 hosszú.
  const cats = [hasUpper, hasLower, hasDigit, hasSym].filter(Boolean).length;
  return cats >= 3 || s.length >= 12;
}

// Konszolidáljuk a karakterenkénti `type` eseményeket "szakaszokká".
// Egy szakasz addig tart, amíg csak `type` események jönnek egymás után.
// Bármi más (click/key/navigate/scroll/wait) lezárja a szakaszt.
function groupTypeSessions(actions) {
  const groups = []; // { start, end, text }
  let cur = null;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === "type") {
      const v = a.value ?? a.text ?? "";
      if (!cur) cur = { start: i, end: i, text: v };
      else { cur.end = i; cur.text += v; }
    } else if (cur) {
      groups.push(cur);
      cur = null;
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

function planSubstitutions(actions, creds, totpSecret, spec) {
  const groups = groupTypeSessions(actions);
  const kyloSignup = spec?.kylo_signup || {};
  const signupEmail = typeof kyloSignup.email === "string" ? kyloSignup.email : null;
  const signupPassword = typeof kyloSignup.password === "string" ? kyloSignup.password : null;
  // Map: indexOfFirstTypeInGroup -> { role, valueOverride, groupEnd, groupText }
  const plan = new Map();
  const rolesUsed = new Set();
  for (const g of groups) {
    let role = "as_recorded";
    let override = null;
    if (looksLikeTotp(g.text) && totpSecret) {
      role = "totp";
      override = generateTotp(totpSecret);
    } else if (looksLikeEmail(g.text) && (signupEmail || creds?.username)) {
      role = signupEmail ? "signup_email" : "username";
      override = signupEmail || creds.username;
    } else if (looksLikePassword(g.text) && (signupPassword || creds?.password)) {
      role = "password";
      override = signupPassword || creds.password;
    }
    plan.set(g.start, { role, override, groupEnd: g.end, groupText: g.text });
    rolesUsed.add(role);
  }
  return { plan, rolesUsed: [...rolesUsed] };
}

async function humanMoveTo(page, x, y) {
  // Egyszerűsített kurzor mozgás — több lépés + jitter, gyorsulás/lassulás.
  const steps = randInt(14, 28);
  const startX = randRange(200, 900);
  const startY = randRange(150, 500);
  for (let i = 1; i <= steps; i++) {
    const raw = i / steps;
    const t = 0.5 - 0.5 * Math.cos(Math.PI * raw); // ease-in-out
    const px = startX + (x - startX) * t + (rand() - 0.5) * 1.5;
    const py = startY + (y - startY) * t + (rand() - 0.5) * 1.5;
    await page.mouse.move(px, py);
    await page.waitForTimeout(randInt(6, 22));
  }
  // Alkalmi overshoot
  if (rand() < 0.3) {
    await page.mouse.move(x + randRange(-8, 8), y + randRange(-6, 6));
    await page.waitForTimeout(randInt(40, 120));
  }
  await page.mouse.move(x, y);
  await page.waitForTimeout(randInt(60, 180));
}

async function humanClickAt(page, x, y) {
  await humanMoveTo(page, x, y);
  await page.mouse.down();
  await page.waitForTimeout(randInt(35, 110));
  await page.mouse.up();
}

// Screenshot (base64 JPEG) — a UI a result.screenshots tömböt jeleníti meg.
async function shot(page, label) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 38, fullPage: false });
    return { label, at: new Date().toISOString(), b64: buf.toString("base64") };
  } catch (e) {
    return { label, at: new Date().toISOString(), error: e.message };
  }
}

// Nyelvi ellenőrzés: angol futásnál minden látható szöveg angol kell legyen.
// Magyar (és egyéb nem-angol) maradványokat keresünk a látható szövegben.
const LANG_AUDIT_FN = `(() => {
  const text = (document.body?.innerText || "").replace(/\\s+/g, " ").trim();
  const sample = text.slice(0, 20000);
  const HU_WORDS = ["előfizet","fizetés","bejelentkez","regisztrá","jelszó","felhasznál","kezdés","árak","kosár","kilépés","beállítás","tovább","mégse","kötelező","hibás","sikeres","köszön","adatok","szolgáltat","havi","éves","ingyenes","próba","nyelv","profil om"];
  const lower = sample.toLowerCase();
  const hits = HU_WORDS.filter((w) => lower.includes(w));
  const diacritics = (sample.match(/[őűáéíóúöüÁÉÍÓÚÖÜŐŰ]/g) || []).length;
  const htmlLang = document.documentElement.getAttribute("lang") || null;
  return {
    url: location.href,
    html_lang: htmlLang,
    hungarian_words: hits.slice(0, 12),
    diacritic_count: diacritics,
    text_length: sample.length,
    sample: sample.slice(0, 400),
  };
})()`;

async function auditLanguage(page, label, log) {
  try {
    const r = await page.evaluate(LANG_AUDIT_FN);
    const suspicious = r.hungarian_words.length > 0 || r.diacritic_count > 3;
    const entry = { label, ...r, ok: !suspicious };
    log(
      suspicious ? "warn" : "info",
      suspicious
        ? `Nyelvi ellenőrzés (${label}): NEM angol tartalom — találatok: ${r.hungarian_words.join(", ") || "ékezetek"} (${r.diacritic_count} ékezetes karakter) · ${r.url}`
        : `Nyelvi ellenőrzés (${label}): rendben, angol tartalom (html lang=${r.html_lang ?? "?"})`,
    );
    return entry;
  } catch (e) {
    return { label, ok: null, error: e.message };
  }
}


async function runRecordReplay({ page, context, spec, creds, log }) {
  const actions = Array.isArray(spec.recorded_actions) ? spec.recorded_actions : [];
  if (actions.length === 0) {
    throw new Error("A workflow spec-jében nincs recorded_actions — vegyél fel egy login flow-t először.");
  }

  const totpSecret = creds?.totpSecret || null;
  const { plan, rolesUsed } = planSubstitutions(actions, creds || {}, totpSecret, spec);

  const cfg = spec?.kylo_signup || {};
  const bypassToken = process.env.BRAIN_KYLO_TEST_BYPASS_TOKEN || cfg.bypass_token;
  const baseUrl = cfg.base_url || actions.find((a) => a.type === "navigate" && a.url)?.url || "https://kylo.study";
  if (bypassToken) {
    try {
      const kyloOrigin = new URL(baseUrl).origin;
      const signupEmail = typeof cfg.email === "string" ? cfg.email : "";
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
            ...(signupEmail ? { "x-kylo-test-email": signupEmail } : {}),
          },
        });
      });
      log("info", `Replay: Kylo teszt-bypass fejléc aktív, csak saját domainre: ${kyloOrigin}`);
    } catch (e) {
      log("warn", `Replay: bypass fejléc beállítási hiba: ${e.message}`);
    }
  }

  log(
    "info",
    `Replay indul: ${actions.length} lépés, gépelési szakaszok szerepei: ${rolesUsed.join(", ") || "nincs"}`,
  );

  // Első action legyen navigate, különben lehetetlen tudni honnan kezdjük.
  const first = actions[0];
  if (first.type !== "navigate") {
    log("warn", "Az első lépés nem navigate — vaktában kezdünk az about:blank oldalon");
  }

  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  log("info", `Viewport: ${viewport.width}x${viewport.height}`);

  const screenshots = [];
  const languageChecks = [];
  const maxStoredScreenshots = 4;
  const capture = async (label) => {
    const shouldStoreScreenshot = label === "final-state" || screenshots.length < maxStoredScreenshots - 1;
    if (shouldStoreScreenshot) {
      screenshots.push(await shot(page, label));
    }
    languageChecks.push(await auditLanguage(page, label, log));
  };

  let skipUntil = -1;

  for (let i = 0; i < actions.length; i++) {
    if (i <= skipUntil) continue;
    const a = actions[i];
    // Az emberi lépések közötti szünet: Poisson-eloszlásból, nem az eredeti t.
    await humanWait(page, randInt(220, 900));

    try {
      if (a.type === "navigate") {
        if (/access_token=|refresh_token=|type=signup|\/auth\/v1\/verify|\/elofizetesek\?|\/fizetes\?|checkout\.stripe\.com|session_id=cs_/i.test(String(a.url || ""))) {
          log("info", `[${i + 1}/${actions.length}] navigate kihagyva — felvétel régi auth/checkout URL-je (a friss oldalt a kattintás nyitja meg)`);
          await humanThink(page, 1200);
          continue;
        }
        log("info", `[${i + 1}/${actions.length}] navigate → ${a.url}`);
        await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await humanThink(page, 900);
        await capture(`nav-${i + 1}`);
      } else if (a.type === "click") {
        if (typeof a.x === "number" && typeof a.y === "number") {
          const cx = a.x >= 0 && a.x <= 1 ? a.x * viewport.width : a.x;
          const cy = a.y >= 0 && a.y <= 1 ? a.y * viewport.height : a.y;
          log("info", `[${i + 1}/${actions.length}] click @ (${Math.round(cx)}, ${Math.round(cy)})${a.text ? ` — "${a.text.slice(0, 30)}"` : ""}`);
          await humanClickAt(page, cx, cy);
        } else if (a.selector) {
          log("info", `[${i + 1}/${actions.length}] click selector "${a.selector}"`);
          const el = await page.waitForSelector(a.selector, { state: "visible", timeout: 15000 }).catch(() => null);
          if (el) { const box = await el.boundingBox(); if (box) await humanClickAt(page, box.x + box.width / 2, box.y + box.height / 2); }
        }
      } else if (a.type === "kylo_unlock") {
        const clicks = Math.max(1, Math.min(12, Number(a.clicks) || 7));
        log("info", `[${i + 1}/${actions.length}] Kylo logó-kapu: pontosan ${clicks} kattintás`);
        const result = await page.evaluate(`(${KYLO_LOGO_UNLOCK_FN})(${clicks})`);
        if (!result?.ok) throw new Error(result?.reason || "Kylo logó-kapu nem kattintható");
        await humanThink(page, 900);
        await capture(`after-logo-unlock-${i + 1}`);
      } else if (a.type === "gmail_confirm_link") {
        log("info", `[${i + 1}/${actions.length}] Gmail megerősítő link keresése`);
        const res = await getGmailConfirmationLink({
          runId: process.env.RUN_ID || undefined,
          workflowId: process.env.WORKFLOW_ID || undefined,
          recipient: spec?.kylo_signup?.email || undefined,
        });
        if (!res?.link) throw new Error("Nem találtam friss Gmail megerősítő linket");
        await page.goto(res.link, { waitUntil: "domcontentloaded", timeout: 45000 });
        await humanThink(page, 1500);
        await capture(`after-email-confirm-${i + 1}`);

      } else if (a.type === "type") {
        const entry = plan.get(i);
        if (entry) {
          const { role, override, groupEnd, groupText } = entry;
          const effective = override ?? groupText;
          log(
            "info",
            `[${i + 1}/${actions.length}] type szakasz (${role}, ${groupText.length} kar. felvett → ${effective.length} kar. tényleges)`,
          );
          await humanType(page, effective, { meanCharMs: role === "password" ? 105 : 85 });
          skipUntil = groupEnd; // a szakasz többi karakterét már beírtuk
        } else {
          // Nem lehet ott (a group biztos a szakasz elején van), de fallback:
          const v = a.value ?? a.text ?? "";
          if (v) await humanType(page, v);
        }
      } else if (a.type === "key") {
        log("info", `[${i + 1}/${actions.length}] key ${a.key}`);
        await page.keyboard.press(a.key);
      } else if (a.type === "scroll") {
        log("info", `[${i + 1}/${actions.length}] scroll (${a.x}, ${a.y})`);
        await page.mouse.wheel(a.x || 0, a.y || 0);
      } else if (a.type === "wait") {
        // Ignoráljuk az eredeti hosszú wait-eket — a Poisson szünet elég.
        await humanWait(page, Math.min(a.ms || 400, 1200));
      }
    } catch (e) {
      log("warn", `Lépés hiba (${a.type}, i=${i}): ${e.message} — folytatás`);
    }
  }

  // Záró bizonyíték: végállapot képe + nyelvi ellenőrzés.
  await humanWait(page, 1500);
  await capture("final-state");

  const cookies = await context.cookies();
  const domains = new Set(cookies.map((c) => c.domain));

  // Detektáljuk hogy bent vagyunk-e (li_at LinkedIn-hez).
  const platform = (spec.platform || "").toLowerCase();
  const REQ = { linkedin: "li_at", tiktok: "sessionid", pinterest: "_pinterest_sess" };
  const marker = REQ[platform];
  const loggedIn = !marker || cookies.some((c) => c.name === marker);

  log(
    loggedIn ? "info" : "warn",
    `Cookie gyűjtés kész: ${cookies.length} sütiről ${domains.size} doménről. Bejelentkezve: ${loggedIn ? "IGEN" : "NEM"} (marker=${marker || "n/a"})`,
  );

  const langIssues = languageChecks.filter((c) => c.ok === false);
  log(
    langIssues.length > 0 ? "warn" : "info",
    langIssues.length > 0
      ? `NYELVI HIBA: ${langIssues.length} oldalon nem angol szöveg jelent meg (${langIssues.map((c) => c.label).join(", ")})`
      : `Nyelvi ellenőrzés: mind a ${languageChecks.length} vizsgált oldal angol volt.`,
  );

  let finalUrl = null;
  try { finalUrl = page.url(); } catch {}

  return {
    replay_action_count: actions.length,
    replay_roles_used: rolesUsed,
    cookies_export: JSON.stringify(cookies),
    cookies_collected: cookies.length,
    cookie_domains: [...domains],
    logged_in: loggedIn,
    platform,
    final_url: finalUrl,
    screenshots,
    language_checks: languageChecks,
    language_issues: langIssues,
    language_ok: langIssues.length === 0,
  };

}

export { runRecordReplay };
