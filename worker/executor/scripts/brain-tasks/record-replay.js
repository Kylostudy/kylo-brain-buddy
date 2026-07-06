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

function rand() { return Math.random(); }
function randRange(a, b) { return a + rand() * (b - a); }
function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }

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

function planSubstitutions(actions, creds, totpSecret) {
  const groups = groupTypeSessions(actions);
  // Map: indexOfFirstTypeInGroup -> { role, valueOverride, groupEnd, groupText }
  const plan = new Map();
  const rolesUsed = new Set();
  for (const g of groups) {
    let role = "as_recorded";
    let override = null;
    if (looksLikeTotp(g.text) && totpSecret) {
      role = "totp";
      override = generateTotp(totpSecret);
    } else if (looksLikeEmail(g.text) && creds?.username) {
      role = "username";
      override = creds.username;
    } else if (looksLikePassword(g.text) && creds?.password) {
      role = "password";
      override = creds.password;
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

async function runRecordReplay({ page, context, spec, creds, log }) {
  const actions = Array.isArray(spec.recorded_actions) ? spec.recorded_actions : [];
  if (actions.length === 0) {
    throw new Error("A workflow spec-jében nincs recorded_actions — vegyél fel egy login flow-t először.");
  }

  const totpSecret = creds?.totpSecret || null;
  const { plan, rolesUsed } = planSubstitutions(actions, creds || {}, totpSecret);

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

  let skipUntil = -1;
  for (let i = 0; i < actions.length; i++) {
    if (i <= skipUntil) continue;
    const a = actions[i];
    // Az emberi lépések közötti szünet: Poisson-eloszlásból, nem az eredeti t.
    await humanWait(page, randInt(220, 900));

    try {
      if (a.type === "navigate") {
        log("info", `[${i + 1}/${actions.length}] navigate → ${a.url}`);
        await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await humanThink(page, 900);
      } else if (a.type === "click") {
        if (typeof a.x === "number" && typeof a.y === "number") {
          log("info", `[${i + 1}/${actions.length}] click @ (${a.x}, ${a.y})${a.text ? ` — "${a.text.slice(0, 30)}"` : ""}`);
          await humanClickAt(page, a.x, a.y);
        } else if (a.selector) {
          log("info", `[${i + 1}/${actions.length}] click selector "${a.selector}"`);
          const el = await page.waitForSelector(a.selector, { state: "visible", timeout: 15000 }).catch(() => null);
          if (el) { const box = await el.boundingBox(); if (box) await humanClickAt(page, box.x + box.width / 2, box.y + box.height / 2); }
        }
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

  // Végén szedjük össze a cookie-kat.
  await humanWait(page, 1500);
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

  return {
    replay_action_count: actions.length,
    replay_roles_used: rolesUsed,
    cookies_export: JSON.stringify(cookies),
    cookies_collected: cookies.length,
    cookie_domains: [...domains],
    logged_in: loggedIn,
    platform,
  };
}

export { runRecordReplay };
