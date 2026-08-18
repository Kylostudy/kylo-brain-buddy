// worker/recorder/index.js
//
// Élő böngésző-felvétel worker. KIZÁRÓLAG a Lovable Brainnel beszél kifelé:
//
//  1) Brain HTTPS (Bearer WORKER_API_TOKEN):
//     POST {BRAIN_URL}/api/public/worker/record-claim   — új session lekérése
//     POST {BRAIN_URL}/api/public/worker/record-status  — állapot / hibajelzés
//
//  2) Supabase Realtime (kimenő WSS) — frame stream + felhasználói input.
//     A publishable kulcsot a Brain a record-claim válaszában küldi le,
//     így a VPS-en NINCS service role kulcs. A csatorna: record:<sessionId>.
//
// Semmilyen inbound portot NEM nyitunk a VPS-en.
// Egy folyamat több párhuzamos session-t is kezel (külön browser context-tel).

import { createClient } from "@supabase/supabase-js";
import { spawn, spawnSync } from "node:child_process";
import ws from "ws";
import { buildFingerprintInitScript } from "./fingerprint-patch.js";
import { createHealth, installGracefulShutdown, installCrashGuards } from "./health.js";

let chromium = null;
async function getChromium() {
  if (chromium) return chromium;
  // A recorder célja a stabil, látható, kézzel kezelhető bejelentkezési oldal.
  // A stealth plugin több modern oldalon (Pinterestnél biztosan) eltöri a JS/CSS
  // inicializálást: láthatóvá válnak a belső fontmérő szövegek („word word”),
  // az oldal pedig stílus nélkül szétesik. Az éles workflow executor továbbra is
  // használhat külön fingerprint/stealth védelmet; a recorder legyen tiszta Chrome.
  const { chromium: plainChromium } = await import("playwright");
  chromium = plainChromium;
  return chromium;
}

// ---- Proxy pool (residential, támogatott formátumok: host:port:user:pass vagy user:pass:host:port) ----
function parseProxy(raw, label) {
  const parts = String(raw || "")
    .trim()
    .split(":");
  const isPort = (value) => /^\d{2,5}$/.test(value || "");

  if (parts.length < 4) {
    console.error(
      `[proxy] ${label} hibás formátum (vár: host:port:user:pass vagy user:pass:host:port)`,
    );
    return null;
  }

  let host;
  let port;
  let username;
  let password;

  if (isPort(parts[1])) {
    [host, port, username] = parts;
    password = parts.slice(3).join(":");
  } else if (isPort(parts.at(-1))) {
    host = parts.at(-2);
    port = parts.at(-1);
    username = parts[0];
    password = parts.slice(1, -2).join(":");
  } else {
    console.error(`[proxy] ${label} hibás formátum (nem található port)`);
    return null;
  }

  return {
    server: `http://${host}:${port}`,
    username,
    password,
    label,
  };
}

function loadProxies() {
  const list = [];
  for (let i = 1; i <= 20; i++) {
    const raw = process.env[`PROXY_${i}`];
    if (!raw) continue;
    const proxy = parseProxy(raw, `PROXY_${i}`);
    if (proxy) list.push(proxy);
  }
  return list;
}
const PROXIES = loadProxies();
let proxyCursor = 0;
function nextProxy() {
  if (PROXIES.length === 0) return null;
  const p = PROXIES[proxyCursor % PROXIES.length];
  proxyCursor++;
  return p;
}

// ---- User-Agent pool (valódi, friss Chrome / Edge UA-k) ----
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36",
];
const pickUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const BRAIN_URL = (process.env.BRAIN_URL || "").replace(/\/$/, "");
const WORKER_API_TOKEN = process.env.WORKER_API_TOKEN;
const WORKER_ID = process.env.WORKER_ID || "recorder-1";
const POLL_INTERVAL_MS = Number(process.env.RECORD_POLL_INTERVAL_MS || 2000);
const MAX_SESSIONS = Number(process.env.RECORD_MAX_SESSIONS || 2);
const FRAME_FPS = Number(process.env.RECORD_FPS || 5);
const VIEWPORT_W = Number(process.env.RECORD_VIEWPORT_W || 1280);
const VIEWPORT_H = Number(process.env.RECORD_VIEWPORT_H || 800);
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));

if (!BRAIN_URL || !WORKER_API_TOKEN) {
  console.error("[recorder] BRAIN_URL és WORKER_API_TOKEN kötelező.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PINTEREST_LOGIN_URL = "https://www.pinterest.com/login/";

let xvfbProcess = null;

function isDisplayReady(display) {
  const result = spawnSync("xdpyinfo", ["-display", display], {
    stdio: "ignore",
    timeout: 1500,
  });
  return result.status === 0;
}

async function ensureVirtualDisplay() {
  const display = process.env.DISPLAY || ":99";
  process.env.DISPLAY = display;

  if (isDisplayReady(display)) {
    console.log(`[recorder] DISPLAY készen áll: ${display}`);
    return;
  }

  console.warn(`[recorder] DISPLAY nem elérhető (${display}), Xvfb indítása Node-ból...`);
  xvfbProcess = spawn(
    "Xvfb",
    [display, "-screen", "0", "1280x960x24", "-ac", "+extension", "GLX", "+render", "-noreset"],
    { detached: false, stdio: ["ignore", "ignore", "pipe"] },
  );

  xvfbProcess.stderr?.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line) console.warn(`[recorder:xvfb] ${line}`);
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (isDisplayReady(display)) {
      console.log(`[recorder] Xvfb készen áll: ${display}`);
      return;
    }
    await sleep(100);
  }

  throw new Error(`A virtuális kijelző nem indult el (${display}).`);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

async function humanPause(min = 35, max = 140) {
  await sleep(Math.round(randomBetween(min, max)));
}

async function humanMoveMouse(page, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = clamp(Math.round(distance / 70) + Math.floor(randomBetween(3, 8)), 7, 28);
  const curve = randomBetween(-0.22, 0.22);
  const jitter = Math.min(3.5, Math.max(0.8, distance / 280));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);
    const bow = Math.sin(Math.PI * t) * curve * distance;
    const px =
      from.x + dx * ease + (-dy / Math.max(distance, 1)) * bow + randomBetween(-jitter, jitter);
    const py =
      from.y + dy * ease + (dx / Math.max(distance, 1)) * bow + randomBetween(-jitter, jitter);
    await page.mouse.move(px, py);
    await humanPause(8, 26);
  }

  if (distance > 90 && Math.random() < 0.45) {
    await page.mouse.move(to.x + randomBetween(-5, 5), to.y + randomBetween(-4, 4));
    await humanPause(20, 70);
  }

  await page.mouse.move(to.x, to.y);
}

async function humanClick(page, from, to) {
  await humanMoveMouse(page, from, to);
  await humanPause(45, 160);
  await page.mouse.down();
  await humanPause(70, 190);
  await page.mouse.up();
  await humanPause(220, 520);
}

// ---- Belépés-előjáték lejátszása felvétel előtt ----
// A rögzített belépés-kocka lépéseit játssza le emberi ütemezéssel, a gépelt
// szövegeknél a felvételkori e-mail/jelszó helyére a kiosztott teszt fiók
// adatait helyettesíti be.
function groupPreludeTyping(actions) {
  const groups = [];
  let cur = null;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i] || {};
    if (a.type === "type") {
      const v = a.value ?? a.text ?? "";
      if (!cur) cur = { start: i, end: i, text: v, selector: a.selector || null };
      else {
        cur.end = i;
        cur.text += v;
      }
    } else if (cur) {
      if (a.type === "click" && a.selector && cur.selector && a.selector === cur.selector) continue;
      groups.push(cur);
      cur = null;
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

async function playPrelude(page, prelude, sessionId) {
  const actions = prelude.actions || [];
  const account = prelude.account || null;
  const plan = new Map();
  for (const g of groupPreludeTyping(actions)) {
    const sel = String(g.selector || "");
    let override = null;
    if (account) {
      if (/@/.test(g.text) || /e?mail/i.test(sel)) override = account.email;
      else if (/pass|jelszo|jelszó/i.test(sel)) override = account.password;
    }
    plan.set(g.start, { end: g.end, text: override ?? g.text });
  }

  let cursor = { x: 640, y: 400 };
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i] || {};
    const typed = plan.get(i);
    if (a.type === "type") {
      if (!typed) continue; // csoport belseje — a csoport elején már beírtuk
      await page.keyboard.type(String(typed.text), { delay: randomBetween(45, 130) });
      i = typed.end;
      continue;
    }
    try {
      if (a.type === "navigate" && a.url) {
        await page.goto(normalizeUrl(a.url) || a.url, { waitUntil: "domcontentloaded" });
      } else if (a.type === "click") {
        if (typeof a.x === "number" && typeof a.y === "number") {
          await humanClick(page, cursor, { x: a.x, y: a.y });
          cursor = { x: a.x, y: a.y };
        } else if (a.selector) {
          await page.click(a.selector, { timeout: 10000 });
        }
      } else if (a.type === "key" && a.key) {
        await page.keyboard.press(a.key);
      } else if (a.type === "scroll") {
        await page.mouse.wheel(a.dx || 0, a.dy || 0);
      } else if (a.type === "wait") {
        await page.waitForTimeout(Math.min(Number(a.ms) || 500, 5000));
      }
    } catch (e) {
      console.warn(`[session ${sessionId}] prelude lépés kihagyva (${a.type}): ${e?.message ?? e}`);
    }
    await humanPause(180, 520);
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(1200);
}

function normalizeUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "");
  const pinterestish = /pinterest/i.test(compact);

  // Megfogja az összeragasztott / autocomplete által elrontott Pinterest címeket,
  // pl. `www.pinterest.nl.login.pinterest.comcom`.
  if (pinterestish && (/\.comcom(?:\/|$)/i.test(compact) || /login\.pinterest\./i.test(compact))) {
    return PINTEREST_LOGIN_URL;
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(compact)
    ? compact
    : /^localhost(?::\d+)?(?:\/|$)/i.test(compact)
      ? `http://${compact}`
      : `https://${compact}`;

  try {
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.toLowerCase();
    if (pinterestish) {
      const official =
        host === "pinterest.com" ||
        host.endsWith(".pinterest.com") ||
        host === "pin.it" ||
        host.endsWith(".pin.it");
      if (!official) return PINTEREST_LOGIN_URL;
    }
    // A puszta gmail.com egy régi átirányító, ami proxy mögött gyakran elakad.
    // Rögtön a valódi postafiók / regisztrációs címre megyünk.
    if (host === "gmail.com" || host === "www.gmail.com") {
      return parsed.pathname && parsed.pathname !== "/"
        ? `https://mail.google.com${parsed.pathname}${parsed.search}`
        : "https://mail.google.com/mail/u/0/";
    }
    return parsed.toString();
  } catch {
    return pinterestish ? PINTEREST_LOGIN_URL : null;
  }
}

async function brainPost(path, body) {
  return fetch(`${BRAIN_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WORKER_API_TOKEN}`,
      "x-worker-token": WORKER_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const chromium = await getChromium();
  await ensureVirtualDisplay();
  console.log(`[recorder] Playwright böngésző indítása DISPLAY=${process.env.DISPLAY}...`);
  // A tényleges proxy sessionönként, a newContext({ proxy }) hívásban dől el.
  // Nem szabad globális helykitöltő proxyt megadni: a proxy nélküli Audit
  // felvételek azt örökölnék, és üres/fehér oldalon ragadnának.
  browser = await chromium.launch({
    // Headed mód kell a Live Browse-hoz és a bot-védelem miatt, ezért indulás
    // előtt külön ellenőrizzük / elindítjuk az Xvfb virtuális kijelzőt.
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  return browser;
}

const active = new Map(); // sessionId -> Promise
let lastIdleLogAt = 0;

async function claimNext() {
  try {
    const res = await brainPost("/api/public/worker/record-claim", {
      workerId: WORKER_ID,
    });
    if (res.status === 204) {
      const now = Date.now();
      if (now - lastIdleLogAt > 30000) {
        console.log(`[record-claim] nincs felvehető recording session (204)`);
        lastIdleLogAt = now;
      }
      return null;
    }
    if (!res.ok) {
      console.error(`[record-claim] ${res.status} ${await res.text()}`);
      return null;
    }
    const payload = await res.json();
    if (payload?.session?.id) {
      console.log(`[record-claim] session felvéve: ${payload.session.id}`);
    } else {
      console.warn(`[record-claim] váratlan válasz: ${JSON.stringify(payload).slice(0, 500)}`);
    }
    return payload;
  } catch (e) {
    console.error("[record-claim] network error", e.message);
    return null;
  }
}

async function fetchStatus(sessionId, markFailed) {
  try {
    const res = await brainPost("/api/public/worker/record-status", {
      sessionId,
      ...(markFailed ? { markFailed } : {}),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.status;
  } catch {
    return null;
  }
}

function friendlyInitialNavigationError(error, proxy) {
  const message = String(error?.message || error || "");
  if (/ERR_TUNNEL_CONNECTION_FAILED|CONNECT tunnel failed|\b407\b/i.test(message)) {
    return `A hozzárendelt proxy nem engedte át a kapcsolatot (407 / tunnel hiba). Ez nem Reddit-kattintási hiba: a ${proxy?.label || "workflow"} proxy hitelesítése vagy szolgáltatói beállítása rossz, ezért Kanada marad, de ezt a proxyt javítani/cserélni kell.`;
  }
  if (/ERR_PROXY_CONNECTION_FAILED|proxy/i.test(message)) {
    return `A hozzárendelt proxyhoz nem sikerült kapcsolódni (${proxy?.label || "workflow proxy"}). Ellenőrizni kell a proxy host/port/felhasználónév/jelszó beállítását.`;
  }
  return `A kezdőoldal betöltése nem sikerült: ${message.slice(0, 420)}`;
}

// Selector-leíró az elemhez koordinátákból.
const SELECTOR_FN = `(x, y) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  function describe(n) {
    if (n.getAttribute && n.getAttribute('data-testid')) return '[data-testid="' + n.getAttribute('data-testid') + '"]';
    if (n.id && /^[A-Za-z][\\w-]*$/.test(n.id)) return '#' + n.id;
    if (n.getAttribute && n.getAttribute('aria-label')) return n.tagName.toLowerCase() + '[aria-label="' + n.getAttribute('aria-label').replace(/"/g,'\\\\"') + '"]';
    return null;
  }
  const own = describe(el);
  if (own) return { selector: own, text: (el.innerText||'').slice(0,80) };
  const path = [];
  let node = el;
  for (let depth = 0; depth < 4 && node && node.tagName; depth++) {
    let part = node.tagName.toLowerCase();
    if (node.classList && node.classList.length) {
      const cls = Array.from(node.classList).filter(c => /^[A-Za-z][\\w-]*$/.test(c)).slice(0,2);
      if (cls.length) part += '.' + cls.join('.');
    }
    path.unshift(part);
    node = node.parentElement;
  }
  return { selector: path.join(' > '), text: (el.innerText||'').slice(0,80) };
}`;

// A távoli kép csak screenshot. LinkedIn-szerű oldalaknál előfordul, hogy a
// sima Playwright egérkattintás nem hagy stabil fókuszt a mezőn (különösen
// password / 2FA mezőknél). Ez a segéd a kattintott pontnál megkeresi az
// érdemi beviteli mezőt, és explicit fókuszt + kurzort tesz bele.
const FOCUS_EDITABLE_AT_FN = `(x, y) => {
  // A Reddit (és sok modern oldal) web-componentekbe, árnyék-DOM-ba rejti a
  // beviteli mezőt. Ezért mindenhol átnézünk a shadow rootokon is.
  function deepElementFromPoint(px, py) {
    const chain = [];
    let root = document;
    let el = root.elementFromPoint(px, py);
    while (el) {
      chain.push(el);
      if (el.shadowRoot && el.shadowRoot.elementFromPoint) {
        const inner = el.shadowRoot.elementFromPoint(px, py);
        if (!inner || inner === el || chain.includes(inner)) break;
        el = inner;
      } else break;
    }
    return chain;
  }
  function allEditableNodes() {
    const sel = 'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]';
    const out = [];
    const seenRoots = new Set();
    function walk(root) {
      if (!root || seenRoots.has(root)) return;
      seenRoots.add(root);
      try { out.push(...root.querySelectorAll(sel)); } catch {}
      let hosts = [];
      try { hosts = root.querySelectorAll('*'); } catch {}
      for (const h of hosts) if (h.shadowRoot) walk(h.shadowRoot);
    }
    walk(document);
    return out;
  }

  function isEditable(el) {
    if (!el || !el.matches) return false;
    if (el.matches('textarea:not([disabled]):not([readonly])')) return true;
    if (el.matches('[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]')) return true;
    if (!el.matches('input:not([disabled]):not([readonly])')) return false;
    const type = String(el.getAttribute('type') || 'text').toLowerCase();
    return !['hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(type);
  }
  function editableFrom(el) {
    if (!el) return null;
    if (isEditable(el)) return el;
    const label = el.closest && el.closest('label');
    if (label) {
      const forId = label.getAttribute('for');
      const byFor = forId ? document.getElementById(forId) : null;
      if (isEditable(byFor)) return byFor;
      const inside = label.querySelector('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]');
      if (isEditable(inside)) return inside;
    }
    const closest = el.closest && el.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]');
    return isEditable(closest) ? closest : null;
  }
  function focus(el) {
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
    try {
      if (typeof el.value === 'string' && typeof el.setSelectionRange === 'function') {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    } catch {}
    return document.activeElement === el || el.matches(':focus');
  }

  let target = null;
  for (const el of deepElementFromPoint(x, y).reverse()) {
    target = editableFrom(el);
    if (target) break;
  }
  if (!target && document.elementsFromPoint) {
    for (const el of document.elementsFromPoint(x, y)) {
      target = editableFrom(el);
      if (target) break;
    }
  }
  // Utolsó mentőöv: ha a kattintás pár pixellel a mező mellé ment, keressünk
  // közeli látható inputot. Ez nem választ távoli mezőt, csak a kattintás
  // környezetében lévőt.
  if (!target) {
    const candidates = allEditableNodes()
      .filter(isEditable)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        return { el, r, edgeDistance: Math.hypot(dx, dy), centerDistance: Math.hypot(cx - x, cy - y) };
      })
      .filter((c) => c.r.width > 8 && c.r.height > 8 && c.edgeDistance <= 80)
      .sort((a, b) => a.edgeDistance - b.edgeDistance || a.centerDistance - b.centerDistance);
    target = candidates[0]?.el || null;
  }
  if (!target) return { focused: false };
  const ok = focus(target);
  return {
    focused: ok,
    tag: target.tagName,
    type: target.getAttribute('type') || null,
    role: target.getAttribute('role') || null,
  };
}`;

const ACTIVE_EDITABLE_FN = `() => {
  // Az árnyék-DOM-ban a document.activeElement csak a "gazda" elemet adja,
  // ezért lépkedünk befelé, amíg valódi beviteli mezőt nem találunk.
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || !el.matches) return false;
  if (el.matches('textarea:not([disabled]):not([readonly])')) return true;
  if (el.matches('[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]')) return true;
  if (!el.matches('input:not([disabled]):not([readonly])')) return false;
  const type = String(el.getAttribute('type') || 'text').toLowerCase();
  return !['hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(type);
}`;


const DISPATCH_SINGLE_CLICK_AT_FN = `(x, y) => {
  const direct = document.elementFromPoint(x, y);
  if (!direct) return { ok: false, reason: 'nincs elem a pontnál' };
  const target = direct.closest && direct.closest('button, a, [role="button"], input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]') || direct;
  const ev = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
    view: window,
  });
  target.dispatchEvent(ev);
  const label = String(target.innerText || target.textContent || target.getAttribute?.('aria-label') || target.getAttribute?.('alt') || target.tagName || '').trim();
  return { ok: true, target: target.tagName ? target.tagName.toLowerCase() : 'elem', text: label.slice(0, 80) };
}`;

const KYLO_LOGO_UNLOCK_FN = `async (requestedClicks) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width >= 8 && r.height >= 8 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0.01;
  };
  const all = [];
  for (const selector of [
    'header button',
    'header a',
    'button[aria-label*="Kylo" i]',
    'a[aria-label*="Kylo" i]',
    '[data-testid*="logo" i]',
    'img[alt*="Kylo" i]',
  ]) {
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
    target.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      view: window,
    }));
    sent += 1;
    await sleep(210 + Math.round(Math.random() * 110));
  }
  await sleep(850);
  const label = String(el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('alt') || el.tagName || '').trim();
  return { ok: true, clicks: sent, x, y, target: label.slice(0, 80) || 'Kylo logó', url: location.href };
}`;

const REMOVE_WEBDRIVER_INIT = `() => {
  try {
    const proto = Navigator.prototype;
    const protoDescriptor = Object.getOwnPropertyDescriptor(proto, 'webdriver');
    if (protoDescriptor) delete proto.webdriver;

    const ownDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
    if (ownDescriptor) delete navigator.webdriver;
  } catch {}
}`;

async function runSession(payload) {
  const { session, supabaseUrl, supabasePublishableKey } = payload;
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Brain nem küldött Realtime credenialt (supabaseUrl/PublishableKey).");
  }

  console.log(`[session ${session.id}] start (workflow ${session.workflowId})`);

  // Sessiononként saját Realtime kliens — anon publishable kulccsal.
  const sb = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 30 }, transport: ws },
  });

  const br = await getBrowser();

  // A Brain által küldött (workflow-hoz kötött) proxy elsőbbséget élvez a
  // recorder saját pool-jával szemben. Ez KRITIKUS: a bejelentkezésnek
  // ugyanarról az IP-ről kell történnie, amit a workflow futásidőben is
  // használ, különben az adott platform (LinkedIn, TikTok stb.) "új
  // helyről bejelentkezés" figyelmeztetést dob vagy captchát kér.
  let proxy = null;
  if (payload.proxy && payload.proxy.server) {
    proxy = {
      server: payload.proxy.server,
      username: payload.proxy.username || undefined,
      password: payload.proxy.password || undefined,
      label: payload.proxy.label || "workflow-proxy",
    };
  } else {
    proxy = nextProxy();
  }

  // A Brain által küldött fingerprint elsőbbséget élvez: UA + locale + tz
  // ugyanaz, mint amit a workflow futásidőben is használ. Ha nincs (régi
  // Brain), esik vissza a recorder saját pool-jára.
  const fp = payload.fingerprint || null;
  const userAgent = fp?.userAgent || pickUA();
  const locale = fp?.locale || payload.locale || "hu-HU";
  const timezoneId = fp?.timezoneId || payload.timezone || "Europe/Budapest";
  // FONTOS: a recorder böngésző-viewportja fix, mert ezt streameljük a
  // kliensnek. Viszont a fingerprint init-script NEM hazudhat ettől eltérő
  // screen/outerWidth/devicePixelRatio értékeket, mert a Pinterest ezekből
  // számolja a responsive layoutot. Ha a valódi viewport 1280×800, de a JS
  // 1920×1080-at vagy DPR=2-t lát, a Pinterest oldala széttörik: nagy üres
  // felület, elszórt képek, „word word word” jellegű fallback szöveg.
  const viewport = { width: VIEWPORT_W, height: VIEWPORT_H };
  const effectiveStartUrl = normalizeUrl(session.startUrl || "");
  const isPinterestSession = /pinterest/i.test(
    String(effectiveStartUrl || session.startUrl || payload.platform || ""),
  );
  const recorderFingerprint =
    fp && !isPinterestSession
      ? {
          ...fp,
          viewport,
          deviceScaleFactor: 1,
        }
      : null;
  if (fp?.viewport?.width && fp?.viewport?.height) {
    console.log(
      `[session ${session.id}] fp.viewport=${fp.viewport.width}×${fp.viewport.height}, dpr=${fp.deviceScaleFactor || 1} → recorder layout ${viewport.width}×${viewport.height}, dpr=1`,
    );
  }
  if (proxy) {
    console.log(
      `[session ${session.id}] using ${proxy.label} (${proxy.server}) · locale=${locale} · tz=${timezoneId} · fp=${fp ? `Chrome${fp.chromeMajor}/${fp.platform}` : "recorder-default"}`,
    );
  } else {
    console.warn(`[session ${session.id}] NINCS proxy — direkt IP-vel megy (nem javasolt)!`);
  }
  const context = await br.newContext({
    viewport,
    userAgent,
    locale,
    timezoneId,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    ...(proxy
      ? {
          proxy: {
            server: proxy.server,
            username: proxy.username,
            password: proxy.password,
          },
        }
      : {}),
  });
  // Fingerprint spoof (WebGL vendor/renderer, hardwareConcurrency,
  // deviceMemory, platform, WebRTC leak-védelem). Pinterest felvételnél ezt
  // szándékosan kihagyjuk: a mély navigator/screen/canvas override-ok a
  // Pinterest React/CSS layoutját fallback állapotba tudják lökni
  // („word word word”, üres oldal, szétesett képek). A context UA + proxy +
  // locale/tz marad, csak az oldaltörő init-script nem fut.
  if (recorderFingerprint) {
    try {
      await context.addInitScript(buildFingerprintInitScript(recorderFingerprint));
    } catch (e) {
      console.warn(`[session ${session.id}] fingerprint init-script hiba: ${e.message}`);
    }
  } else if (fp && isPinterestSession) {
    console.log(
      `[session ${session.id}] Pinterest-safe recorder mód: mély fingerprint init-script kihagyva`,
    );
  }
  // Pinterestnél semmilyen init-scriptet nem futtatunk, mert már a legkisebb
  // navigator-patch is elég volt ahhoz, hogy az oldal stílus nélkül essen vissza.
  // Más platformoknál marad a minimális webdriver-törlés.
  if (!isPinterestSession) {
    await context.addInitScript(REMOVE_WEBDRIVER_INIT);
  }
  // Ha a Brain küldött mentett cookie-kat (workflow_credentials-ből), töltsük
  // be MIELŐTT bármit navigálunk — így a felhasználó egyből bejelentkezve
  // nyitja meg pl. a Pinterestet, és nem kell újra belépnie.
  if (Array.isArray(payload.cookies) && payload.cookies.length > 0) {
    const validSameSite = new Set(["Strict", "Lax", "None"]);
    const normalized = payload.cookies
      .map((c) => {
        if (!c || !c.name || typeof c.value !== "string") return null;
        const out = {
          name: c.name,
          value: c.value,
          path: c.path || "/",
          httpOnly: !!c.httpOnly,
          secure: !!c.secure,
        };
        if (c.domain) out.domain = c.domain;
        // Playwright vagy `url`-t vagy `domain`-t vár; ha nincs domain, kihagyjuk.
        if (!out.domain) return null;
        if (typeof c.expires === "number" && c.expires > 0) out.expires = c.expires;
        if (c.sameSite) {
          const s = String(c.sameSite);
          const cap = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
          if (validSameSite.has(cap)) out.sameSite = cap;
        }
        return out;
      })
      .filter(Boolean);
    if (normalized.length > 0) {
      try {
        await context.addCookies(normalized);
        console.log(
          `[session ${session.id}] ${normalized.length} mentett cookie betöltve (${payload.cookies.length} kapott)`,
        );
      } catch (e) {
        console.warn(`[session ${session.id}] cookie betöltés hiba:`, e?.message);
      }
    }
  }

  const page = await context.newPage();

  let stopped = false;
  let viewportW = viewport.width;
  let viewportH = viewport.height;
  const actions = [];
  const channel = sb.channel(session.channel, {
    config: { broadcast: { self: false, ack: true } },
  });
  console.log(`[session ${session.id}] channel létrehozva: ${session.channel}`);
  // DIAGNOSZTIKA: minden beérkező broadcast eventet logolunk
  channel.on("broadcast", { event: "*" }, ({ event, payload }) => {
    try {
      const keys = payload ? Object.keys(payload).join(",") : "";
      console.log(`[session ${session.id}] BROADCAST IN: event=${event} payloadKeys=[${keys}]`);
    } catch {}
  });
  const pushAction = (a) => {
    actions.push(a);
    channel.send({ type: "broadcast", event: "action", payload: { action: a } }).catch(() => {});
  };

  async function describeAt(x, y) {
    try {
      return await page.evaluate(`(${SELECTOR_FN})(${x}, ${y})`);
    } catch {
      return null;
    }
  }

  async function focusEditableAt(x, y) {
    try {
      return await page.evaluate(`(${FOCUS_EDITABLE_AT_FN})(${x}, ${y})`);
    } catch (e) {
      console.warn(`[session ${session.id}] focusEditableAt hiba`, e?.message || e);
      return null;
    }
  }

  async function hasEditableFocus() {
    try {
      return await page.evaluate(`(${ACTIVE_EDITABLE_FN})()`);
    } catch {
      return false;
    }
  }

  function isLikelyKyloLogoClick(desc) {
    if (!/kylo\.study/i.test(page.url())) return false;
    const selector = String(desc?.selector || "");
    const text = String(desc?.text || "");
    return (
      /header/i.test(selector) &&
      /button/i.test(selector) &&
      (/img|logo|kylo|w-9\.h-9/i.test(selector) || /kylo/i.test(text))
    );
  }

  let lastClickPoint = null;
  let lastClickSelector = null;
  let cursorPoint = {
    x: Math.round(viewportW * randomBetween(0.25, 0.75)),
    y: Math.round(viewportH * randomBetween(0.25, 0.75)),
  };

  async function ensureEditableFocusFromLastClick() {
    if (await hasEditableFocus()) return true;
    // A jelszó beillesztése tovább tarthat, ezért itt nincs szűk időablak.
    if (!lastClickPoint) return false;
    await focusEditableAt(lastClickPoint.x, lastClickPoint.y);
    return await hasEditableFocus();
  }

  async function findSecretTarget() {
    // Először a fókuszált JELSZÓMEZŐT keressük. Korábban egy fókuszban maradt
    // felhasználónév-mező is sikeres célpontnak számított, ezért a worker kész
    // állapotot küldhetett úgy, hogy a látható jelszómező üres maradt.
    for (const frame of page.frames()) {
      const focusedPassword = frame.locator(
        'input[type="password"]:focus:not([disabled]):not([readonly])',
      );
      if (await focusedPassword.count().catch(() => 0)) return focusedPassword.first();
    }

    // Ha pontosan egy látható jelszómező van, az mindig elsőbbséget élvez egy
    // másik, korábban fókuszált szövegmezővel szemben.
    const passwords = [];
    for (const frame of page.frames()) {
      const fields = frame.locator(
        'input[type="password"]:visible:not([disabled]):not([readonly])',
      );
      const count = await fields.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) passwords.push(fields.nth(index));
    }
    if (passwords.length === 1) return passwords[0];

    // Nem belépési képernyőn a kijelölt általános beviteli mező marad a
    // tartalék célpont. Az iframe-eket itt is külön átnézzük.
    for (const frame of page.frames()) {
      const focused = frame.locator(
        'input:focus:not([disabled]):not([readonly]), textarea:focus:not([disabled]):not([readonly]), [contenteditable="true"]:focus, [contenteditable="plaintext-only"]:focus, [role="textbox"]:focus',
      );
      if (await focused.count().catch(() => 0)) return focused.first();
    }
    return null;
  }

  async function targetContainsExactSecret(locator, text) {
    // Csak logikai eredményt hozunk ki az oldalból: a jelszó értéke nem kerül
    // sem worker-naplóba, sem Realtime üzenetbe.
    return locator
      .evaluate((el, expected) => {
        if (typeof el.value === "string") return el.value === expected;
        if (el.isContentEditable) return (el.textContent || "") === expected;
        return false;
      }, text)
      .catch(() => false);
  }

  async function secretRemainsInTarget(locator, text) {
    if (!(await targetContainsExactSecret(locator, text))) return false;
    // A LinkedInhez hasonló, vezérelt mezők egy későbbi újrarajzoláskor
    // visszaállíthatják az értéket. Ne jelezzünk sikert egy pillanatnyi állapotra.
    await sleep(900);
    return await targetContainsExactSecret(locator, text);
  }

  async function writeSecretToTarget(locator, text) {
    // Minden művelet közvetlenül a megtalált locatoron fut. Ez iframe-ben is
    // biztosan a célmezőt kezeli, és egyik lépés sem tarthat tovább a felület
    // 15 másodperces visszajelzési idejénél.
    await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    await locator.focus({ timeout: 1500 });

    // 1. A Playwright fill kezeli helyesen a legtöbb React/Vue inputot, és a
    // bonyolult Bitwarden-jelszavakat is egyetlen értékként adja át.
    await locator.fill(text, { timeout: 2500 }).catch(() => {});
    await sleep(120);
    if (await secretRemainsInTarget(locator, text)) return "fill";

    // 2. Natív böngésző-bevitel. A locator.press tartja meg helyesen az
    // iframe-en belüli fókuszt, a page.keyboard önmagában ezt elveszíthette.
    await locator.focus({ timeout: 1500 });
    await locator.press("Control+A", { timeout: 1500 }).catch(() => {});
    await page.keyboard.insertText(text).catch(() => {});
    await sleep(120);
    if (await secretRemainsInTarget(locator, text)) return "insertText";

    // 3. Valódi billentyűesemények, közvetlenül a célmezőn. Ez lassabb, ezért
    // csak az előző két gyors módszer után használjuk.
    await locator.press("Control+A", { timeout: 1500 }).catch(() => {});
    await locator.pressSequentially(text, { delay: 8, timeout: 4000 }).catch(() => {});
    await sleep(120);
    if (await secretRemainsInTarget(locator, text)) return "keyboard";

    // 4. Utolsó tartalék: a natív value setter + input/change esemény.
    // Ez olyan vezérelt mezőknél segít, amelyek a billentyűeseményt elnyelik.
    await locator.evaluate((el, value) => {
      if (el.isContentEditable) {
        el.textContent = value;
      } else {
        const proto =
          el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
      }
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: value,
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }, text);
    await sleep(120);
    if (await secretRemainsInTarget(locator, text)) return "nativeSetter";

    throw new Error("A jelszómező nem fogadta el a beillesztést.");
  }

  let clickBusy = false;
  channel.on("broadcast", { event: "click" }, async ({ payload }) => {
    if (clickBusy) {
      const vs = page.viewportSize() || { width: viewportW, height: viewportH };
      const x = Math.round((Number(payload?.x) || 0) * vs.width);
      const y = Math.round((Number(payload?.y) || 0) * vs.height);
      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "click",
            status: "busy",
            x,
            y,
            target: "az előző kattintás még feldolgozás alatt van",
          },
        })
        .catch(() => {});
      return;
    }
    clickBusy = true;
    try {
      const vs = page.viewportSize();
      const x = payload.x * vs.width;
      const y = payload.y * vs.height;
      lastClickPoint = { x, y, t: Date.now() };
      const desc = await describeAt(x, y);
      lastClickSelector =
        desc?.selector || `point:${Math.round(payload.x * 10000)},${Math.round(payload.y * 10000)}`;
      const targetInfo = desc
        ? `${(desc.selector || "?").slice(0, 60)}${desc.text ? ` "${desc.text.slice(0, 30)}"` : ""}`
        : "nincs elem a pontnál";
      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "click",
            status: "received",
            x: Math.round(x),
            y: Math.round(y),
            target: targetInfo,
          },
        })
        .catch(() => {});
      const kyloLogoClick = isLikelyKyloLogoClick(desc);

      // A Kylo.study rejtett logó-kapuja érzékeny arra, ha egy kattintásból
      // natív + JS click is lesz. Itt ezért NINCS Playwright mouse down/up:
      // egyetlen DOM click eventet küldünk, így 1 felhasználói kattintás = 1
      // Kylo számláló lépés.
      if (kyloLogoClick) {
        const dispatched = await page
          .evaluate(`(${DISPATCH_SINGLE_CLICK_AT_FN})(${x}, ${y})`)
          .catch(() => null);
        if (!dispatched?.ok) {
          throw new Error(dispatched?.reason || "Kylo logó-kattintás nem sikerült");
        }
        cursorPoint = { x, y };
        await sleep(180);
      } else {
        // A natív CDP kattintás előtt telepítünk egy egyszeri capture-fázisú
        // listenert. Ha a natív down/up valóban click eventet szül az oldalon,
        // `nativeClickFired` true lesz — ilyenkor NEM dispatchelünk semmit,
        // hogy ne duplázzunk (ez okozta a Kylo.study 7→14 számláló bugot).
        // Ha viszont a natív kattintás után NEM futott le click handler
        // (pl. a Kylo coming-soon logó overlay-je elnyeli a pointer eventet),
        // akkor egyetlen szintetikus MouseEvent-tel bepótoljuk.
        await page
          .evaluate(() => {
            window.__kyloClickFired = false;
            const h = () => {
              window.__kyloClickFired = true;
            };
            window.__kyloClickHandler = h;
            document.addEventListener("click", h, true);
          })
          .catch(() => {});

        await humanClick(page, cursorPoint, { x, y });
        cursorPoint = { x, y };
        await focusEditableAt(x, y);

        await sleep(140);
        const nativeClickFired = await page
          .evaluate(() => {
            const fired = window.__kyloClickFired === true;
            try {
              document.removeEventListener("click", window.__kyloClickHandler, true);
            } catch {}
            delete window.__kyloClickFired;
            delete window.__kyloClickHandler;
            return fired;
          })
          .catch(() => true); // hibánál inkább ne dispatch-eljünk (biztonságosabb)

        if (!nativeClickFired) {
          await page
            .evaluate(
              ([cx, cy]) => {
                const el = document.elementFromPoint(cx, cy);
                if (!el) return;
                const opts = {
                  bubbles: true,
                  cancelable: true,
                  clientX: cx,
                  clientY: cy,
                  button: 0,
                  view: window,
                };
                el.dispatchEvent(new MouseEvent("mousedown", opts));
                el.dispatchEvent(new MouseEvent("mouseup", opts));
                el.dispatchEvent(new MouseEvent("click", opts));
              },
              [x, y],
            )
            .catch(() => {});
        }
      }

      pushAction({
        type: "click",
        selector: lastClickSelector,
        x: payload.x,
        y: payload.y,
        ...(typeof desc?.text === "string" && desc.text ? { text: desc.text } : {}),
        t: Date.now(),
      });
      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "click",
            status: "done",
            x: Math.round(x),
            y: Math.round(y),
            target: targetInfo,
          },
        })
        .catch(() => {});
    } catch (e) {
      console.error(`[session ${session.id}] click error`, e.message);
      await channel
        .send({
          type: "broadcast",
          event: "inputError",
          payload: { kind: "click", error: e.message },
        })
        .catch(() => {});
    } finally {
      clickBusy = false;
    }
  });

  channel.on("broadcast", { event: "gmailConfirmLink" }, async ({ payload }) => {
    try {
      const url = normalizeUrl(payload?.url);
      if (!url) throw new Error("nincs érvényes megerősítő link");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(1600);
      pushAction({
        type: "gmail_confirm_link",
        url,
        ...(typeof payload?.subject === "string" ? { subject: payload.subject } : {}),
        t: Date.now(),
      });
      await channel
        .send({
          type: "broadcast",
          event: "gmailConfirmAck",
          payload: { url: page.url(), subject: payload?.subject || null },
        })
        .catch(() => {});
    } catch (e) {
      console.error(`[session ${session.id}] gmailConfirmLink error`, e.message);
      await channel
        .send({
          type: "broadcast",
          event: "gmailConfirmError",
          payload: { error: e.message },
        })
        .catch(() => {});
    }
  });

  channel.on("broadcast", { event: "kyloUnlock" }, async ({ payload }) => {
    if (clickBusy) {
      await channel
        .send({
          type: "broadcast",
          event: "kyloUnlockError",
          payload: { error: "az előző kattintás még feldolgozás alatt van" },
        })
        .catch(() => {});
      return;
    }
    clickBusy = true;
    try {
      const clicks = Math.max(1, Math.min(12, Number(payload?.clicks) || 7));
      const result = await page.evaluate(`(${KYLO_LOGO_UNLOCK_FN})(${clicks})`);
      if (!result?.ok) throw new Error(result?.reason || "Kylo logó-kapu nem kattintható");
      cursorPoint = { x: result.x || cursorPoint.x, y: result.y || cursorPoint.y };
      pushAction({
        type: "kylo_unlock",
        selector: "kylo-study-logo-gate",
        clicks: result.clicks || clicks,
        url: result.url || page.url(),
        t: Date.now(),
      });
      await channel
        .send({
          type: "broadcast",
          event: "kyloUnlockAck",
          payload: {
            clicks: result.clicks || clicks,
            target: result.target || "Kylo logó",
            url: result.url || page.url(),
          },
        })
        .catch(() => {});
    } catch (e) {
      console.error(`[session ${session.id}] kyloUnlock error`, e.message);
      await channel
        .send({
          type: "broadcast",
          event: "kyloUnlockError",
          payload: { error: e.message },
        })
        .catch(() => {});
    } finally {
      clickBusy = false;
    }
  });

  channel.on("broadcast", { event: "type" }, async ({ payload }) => {
    const text = payload?.text || "";
    try {
      const focused = await ensureEditableFocusFromLastClick();
      let ok = false;
      if (focused) {
        await page.keyboard.type(text);
        ok = true;
      } else {
        // Nincs szerkeszthető fókusz: megpróbáljuk a legutóbb kattintott
        // selectort közvetlenül kitölteni (jelszómező esetén ez a tipikus eset).
        if (lastClickSelector && !lastClickSelector.startsWith("point:")) {
          await page.fill(lastClickSelector, text);
          ok = true;
        }
      }
      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "type",
            status: ok ? "received" : "error",
            target: ok
              ? `${text.length} karakter beírva`
              : "nincs kijelölt beviteli mező — kattints a mezőbe a képen, majd küldd újra",
          },
        })
        .catch(() => {});
      if (ok) {
        pushAction({
          type: "type",
          selector: lastClickSelector || "activeElement",
          value: text,
          t: Date.now(),
        });
      }
    } catch (e) {
      console.error(`[session ${session.id}] type error`, e.message);
      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: { kind: "type", status: "error", target: e.message },
        })
        .catch(() => {});
    }
  });

  // Egyszer használatos titkos beillesztés. Nem kerül az actions listába és
  // nem naplózzuk az értékét. Az insertText a Ctrl+V eredményével egyezően,
  // egyben viszi be a speciális karaktereket is.
  let secretPasteBusy = false;
  channel.on("broadcast", { event: "pasteSecret" }, async ({ payload }) => {
    const text = typeof payload?.text === "string" ? payload.text : "";
    try {
      if (!text) throw new Error("üres jelszó érkezett");
      if (secretPasteBusy)
        throw new Error(
          "Az előző beillesztés még fut. Várj néhány másodpercet, majd próbáld újra.",
        );
      secretPasteBusy = true;

      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "secret",
            status: "received",
            target: "A worker átvette a jelszót, beillesztés folyamatban…",
          },
        })
        .catch(() => {});

      await ensureEditableFocusFromLastClick();
      const target = await findSecretTarget();
      if (!target) {
        throw new Error(
          "Nem található kijelölt jelszómező. Kattints rá a képen, majd próbáld újra.",
        );
      }
      const method = await writeSecretToTarget(target, text);

      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "secret",
            status: "done",
            target: `${text.length} karakter ellenőrizve (${method})`,
          },
        })
        .catch(() => {});
    } catch (e) {
      console.error(`[session ${session.id}] secret paste error:`, e?.message || e);
      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "secret",
            status: "error",
            target: e?.message || "sikertelen beillesztés",
          },
        })
        .catch(() => {});
    } finally {
      secretPasteBusy = false;
    }
  });

  // Atomi jelszóbeillesztés koordinátára. A felület előbb bekéri a jelszót,
  // majd a következő távoli képkattintással együtt küldi el a célpontot. Így
  // nem függünk egy korábbi kattintás fókuszától vagy annak időzítésétől.
  channel.on("broadcast", { event: "pasteSecretAt" }, async ({ payload }) => {
    const text = typeof payload?.text === "string" ? payload.text : "";
    try {
      if (!text) throw new Error("üres jelszó érkezett");
      if (secretPasteBusy)
        throw new Error(
          "Az előző beillesztés még fut. Várj néhány másodpercet, majd próbáld újra.",
        );
      secretPasteBusy = true;
      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "secret",
            status: "received",
            target: "A worker átvette a célmezőt és a jelszót…",
          },
        })
        .catch(() => {});
      const vs = page.viewportSize() || { width: viewportW, height: viewportH };
      const x = Math.max(0, Math.min(vs.width - 1, Number(payload?.x) * vs.width));
      const y = Math.max(0, Math.min(vs.height - 1, Number(payload?.y) * vs.height));
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("érvénytelen kattintási hely");
      }

      lastClickPoint = { x, y, t: Date.now() };
      const desc = await describeAt(x, y);
      lastClickSelector =
        desc?.selector ||
        `point:${Math.round(Number(payload?.x) * 10000)},${Math.round(Number(payload?.y) * 10000)}`;

      // Előbb valódi kattintást küldünk, utána explicit módon is megkeressük
      // és fókuszáljuk az alatta lévő inputot (label/overlay esetén is).
      await page.mouse.click(x, y);
      const focusResult = await focusEditableAt(x, y);
      let focused = Boolean(focusResult?.focused) && (await hasEditableFocus());

      // LinkedIn belépésnél tipikusan pontosan egy látható password mező van.
      // Ez biztonságos tartalék, ha egy overlay miatt a képpont nem az inputot adja.
      if (!focused) {
        const visiblePasswords = page.locator('input[type="password"]:visible');
        if ((await visiblePasswords.count()) === 1) {
          await visiblePasswords.first().focus();
          focused = await hasEditableFocus();
        }
      }
      if (!focused) {
        throw new Error(
          "A kijelölt ponton nem található beviteli mező. Kattints közvetlenül a jelszómező közepére.",
        );
      }

      const target = await findSecretTarget();
      if (!target) throw new Error("A kijelölt jelszómező nem található.");
      const method = await writeSecretToTarget(target, text);

      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "secret",
            status: "done",
            target: `${text.length} karakter ellenőrizve (${method})`,
          },
        })
        .catch(() => {});
    } catch (e) {
      console.error(`[session ${session.id}] coordinate secret paste error:`, e?.message || e);
      await channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: {
            kind: "secret",
            status: "error",
            target: e?.message || "sikertelen beillesztés",
          },
        })
        .catch(() => {});
    } finally {
      secretPasteBusy = false;
    }
  });

  // Hosszú szöveg EMBERI tempóban való begépelése a kijelölt távoli mezőbe.
  // A felhasználó kézzel belép, rákattint a szövegmezőre, és a worker onnantól
  // úgy gépel, mint egy ember: változó ütem, gondolkodási szünetek, ritka
  // elgépelés azonnali javítással.
  let humanTypeBusy = false;
  let humanTypeCancelled = false;

  const TYPO_KEYS = {
    a: "s",
    s: "a",
    d: "f",
    f: "d",
    g: "h",
    h: "g",
    j: "k",
    k: "j",
    l: "k",
    q: "w",
    w: "q",
    e: "r",
    r: "e",
    t: "y",
    y: "t",
    u: "i",
    i: "u",
    o: "p",
    p: "o",
    z: "x",
    x: "z",
    c: "v",
    v: "c",
    b: "n",
    n: "b",
    m: "n",
  };

  channel.on("broadcast", { event: "humanTypeCancel" }, async () => {
    if (humanTypeBusy) humanTypeCancelled = true;
  });

  channel.on("broadcast", { event: "humanTypeAt" }, async ({ payload }) => {
    const text = typeof payload?.text === "string" ? payload.text : "";
    const ack = (status, target, extra = {}) =>
      channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: { kind: "humanType", status, target, ...extra },
        })
        .catch(() => {});

    try {
      if (!text.trim()) throw new Error("üres szöveg érkezett");
      if (humanTypeBusy) throw new Error("Már fut egy gépelés. Várd meg a végét, vagy állítsd le.");
      humanTypeBusy = true;
      humanTypeCancelled = false;

      await ack("received", "A worker átvette a szöveget, kezdem a gépelést…");

      const vs = page.viewportSize() || { width: viewportW, height: viewportH };
      const x = Math.max(0, Math.min(vs.width - 1, Number(payload?.x) * vs.width));
      const y = Math.max(0, Math.min(vs.height - 1, Number(payload?.y) * vs.height));
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error("érvénytelen kattintási hely");

      lastClickPoint = { x, y, t: Date.now() };
      await page.mouse.click(x, y);
      await sleep(400);
      const focusResult = await focusEditableAt(x, y);
      let focused = Boolean(focusResult?.focused) && (await hasEditableFocus());
      if (!focused) focused = await hasEditableFocus();
      // A LinkedIn szerkesztője időnként egy belső <p>/<div> réteget ad vissza
      // a képpontnál, miközben maga a contenteditable szülő nem kap fókuszt.
      // Ha pontosan egy látható poszt-szerkesztő van, biztonságosan azt használjuk.
      if (!focused) {
        const editors = [];
        for (const frame of page.frames()) {
          const fields = frame.locator(
            'div.ql-editor[contenteditable="true"]:visible, [role="textbox"][contenteditable="true"]:visible, textarea:visible:not([disabled]):not([readonly])',
          );
          const count = await fields.count().catch(() => 0);
          for (let index = 0; index < count; index += 1) editors.push(fields.nth(index));
        }
        if (editors.length === 1) {
          await editors[0].focus({ timeout: 2000 }).catch(() => {});
          focused = true;
        }
      }
      if (!focused) {
        throw new Error(
          "A kijelölt ponton nincs szövegmező. Kattints a mező közepére, majd próbáld újra.",
        );
      }

      // Rövid „gondolkodás”, mielőtt elkezdünk írni.
      await sleep(900 + Math.random() * 1600);

      const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
      let done = 0;
      let lastReport = Date.now();

      for (let p = 0; p < paragraphs.length; p += 1) {
        const lines = paragraphs[p].split("\n");
        for (let li = 0; li < lines.length; li += 1) {
          const line = lines[li];
          for (const ch of line) {
            if (humanTypeCancelled) throw new Error("A gépelést leállítottad.");

            // Ritka elgépelés, azonnali javítással (kb. 1,5%).
            const lower = ch.toLowerCase();
            if (TYPO_KEYS[lower] && Math.random() < 0.015) {
              const wrong = ch === lower ? TYPO_KEYS[lower] : TYPO_KEYS[lower].toUpperCase();
              await page.keyboard.type(wrong, { delay: 0 });
              await sleep(220 + Math.random() * 380);
              await page.keyboard.press("Backspace");
              await sleep(120 + Math.random() * 200);
            }

            await page.keyboard.type(ch, { delay: 0 });
            done += 1;

            // Változó ütem: alap 45–140 ms, szóköz után néha hosszabb szünet.
            let wait = 45 + Math.random() * 95;
            if (/[.,!?;:]/.test(ch)) wait += 180 + Math.random() * 420;
            if (ch === " " && Math.random() < 0.06) wait += 400 + Math.random() * 900;
            await sleep(wait);

            if (Date.now() - lastReport > 2500) {
              lastReport = Date.now();
              await ack("progress", `Gépelés folyamatban… ${done}/${text.length} karakter`, {
                done,
                total: text.length,
              });
            }
          }
          if (li < lines.length - 1) {
            await page.keyboard.press("Enter");
            await sleep(250 + Math.random() * 450);
          }
        }
        if (p < paragraphs.length - 1) {
          await page.keyboard.press("Enter");
          await page.keyboard.press("Enter");
          // Bekezdések között hosszabb „átgondolás”.
          await sleep(1200 + Math.random() * 2600);
        }
      }

      await ack("done", `Kész: ${done} karakter begépelve. A közzétételt te indítsd el.`, {
        done,
        total: text.length,
      });
    } catch (e) {
      console.error(`[session ${session.id}] human type error:`, e?.message || e);
      await ack("error", e?.message || "sikertelen gépelés");
    } finally {
      humanTypeBusy = false;
      humanTypeCancelled = false;
    }
  });

  // FÁJL (fotó / dokumentum) feltöltése a távoli böngészőbe.
  // A felület feltölti a fájlt a Brain tárhelyére, és csak egy aláírt linket
  // küld ide. A worker letölti, majd a KIJELÖLT pontra kattint, és az ott
  // megnyíló fájlválasztóba teszi be a fájlt (ha nincs fájlválasztó, akkor a
  // lap rejtett input[type=file] mezőjébe).
  let uploadBusy = false;
  channel.on("broadcast", { event: "uploadFileAt" }, async ({ payload }) => {
    const ack = (status, target) =>
      channel
        .send({
          type: "broadcast",
          event: "inputAck",
          payload: { kind: "upload", status, target },
        })
        .catch(() => {});

    try {
      const url = typeof payload?.url === "string" ? payload.url : "";
      const name = (typeof payload?.name === "string" && payload.name) || "kep.jpg";
      if (!url) throw new Error("nem érkezett fájl-link");
      if (uploadBusy) throw new Error("Az előző feltöltés még fut. Várj néhány másodpercet.");
      uploadBusy = true;
      await ack("received", "A worker átvette a fájlt, letöltés folyamatban…");

      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const dir = await mkdtemp(join(tmpdir(), "kylo-live-upload-"));
      const safe =
        String(name)
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(-120) || "fajl";
      const filePath = join(dir, safe);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`a fájl letöltése nem sikerült (HTTP ${res.status})`);
      await writeFile(filePath, Buffer.from(await res.arrayBuffer()));

      const vs = page.viewportSize() || { width: viewportW, height: viewportH };
      const x = Math.max(0, Math.min(vs.width - 1, Number(payload?.x) * vs.width));
      const y = Math.max(0, Math.min(vs.height - 1, Number(payload?.y) * vs.height));
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error("érvénytelen kattintási hely");

      await ack("progress", "Fájl letöltve — a kijelölt gomb megnyitása…");

      let used = "";
      try {
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 3000 }),
          page.mouse.click(x, y),
        ]);
        await chooser.setFiles(filePath);
        used = "fájlválasztón keresztül";
      } catch {
        // Tartalék: a lapon (vagy iframe-ekben) lévő rejtett fájlmező.
        // A LinkedIn gyakran előbb egy feltöltő panelt nyit, és csak abban
        // hozza létre a rejtett fájlmezőt. Röviden megvárjuk ezt a panelt.
        await sleep(800);
        const frames = page.frames();
        let ok = false;
        for (const f of frames) {
          try {
            const inputs = f.locator('input[type="file"]');
            const count = await inputs.count();
            for (let index = count - 1; index >= 0; index -= 1) {
              const input = inputs.nth(index);
              const accept = String((await input.getAttribute("accept").catch(() => "")) || "");
              if (accept && !/image|jpg|jpeg|png|webp|\*/i.test(accept)) continue;
              await input.setInputFiles(filePath);
              ok = true;
              break;
            }
            if (ok) break;
          } catch {}
        }
        if (!ok)
          throw new Error(
            "Nem nyílt meg fájlválasztó a kijelölt ponton. Kattints pontosan a „Fotó hozzáadása” gombra.",
          );
        used = "rejtett fájlmezőn keresztül";
      }

      await sleep(1500);
      await ack(
        "done",
        `A fájl bekerült a lapba (${used}). A vágást és a mentést te erősítsd meg.`,
      );
    } catch (e) {
      console.error(`[session ${session.id}] upload error:`, e?.message || e);
      await ack("error", e?.message || "sikertelen fájlfeltöltés");
    } finally {
      uploadBusy = false;
    }
  });

  channel.on("broadcast", { event: "key" }, async ({ payload }) => {
    try {
      await ensureEditableFocusFromLastClick();
      await page.keyboard.press(payload.key);
      pushAction({ type: "key", key: payload.key, t: Date.now() });
    } catch (e) {
      console.error(`[session ${session.id}] key error`, e.message);
    }
  });

  channel.on("broadcast", { event: "goto" }, async ({ payload }) => {
    const raw = String(payload?.url || "");
    try {
      const url = normalizeUrl(raw);
      if (!url) {
        await channel.send({
          type: "broadcast",
          event: "navError",
          payload: { url: raw, message: "Érvénytelen webcím." },
        });
        return;
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await channel.send({
        type: "broadcast",
        event: "nav",
        payload: { url: page.url() },
      });
    } catch (e) {
      console.error(`[session ${session.id}] goto error`, e.message);
      await channel
        .send({
          type: "broadcast",
          event: "navError",
          payload: { url: raw, message: e.message },
        })
        .catch(() => {});
    }
  });

  channel.on("broadcast", { event: "back" }, () => page.goBack().catch(() => {}));
  channel.on("broadcast", { event: "forward" }, () => page.goForward().catch(() => {}));
  channel.on("broadcast", { event: "reload" }, () => page.reload().catch(() => {}));

  channel.on("broadcast", { event: "viewport" }, async ({ payload }) => {
    try {
      // A kliens oldali modál/iframe mérete nem változtathatja a valódi
      // böngésző-viewportot. Pinterestnél az indulás után érkező resize üzenet
      // újratördelte a login modalt, ezért tűnt úgy, hogy "elugrik" az ablak.
      // A streamelt kép skálázása kliensoldali, a kattintás normalizált koordinátával
      // működik, így nincs szükség page.setViewportSize()-ra.
      const size = page.viewportSize() || { width: viewportW, height: viewportH };
      viewportW = size.width;
      viewportH = size.height;
      await channel.send({
        type: "broadcast",
        event: "ready",
        payload: { w: viewportW, h: viewportH },
      });
    } catch (e) {
      console.error(`[session ${session.id}] viewport error`, e.message);
    }
  });

  channel.on("broadcast", { event: "scroll" }, async ({ payload }) => {
    try {
      await page.mouse.wheel(payload.dx || 0, payload.dy || 0);
      pushAction({ type: "scroll", x: payload.dx || 0, y: payload.dy || 0, t: Date.now() });
    } catch {}
  });

  channel.on("broadcast", { event: "extractText" }, async () => {
    try {
      const text = await page.evaluate(() => {
        const selected = String(window.getSelection?.()?.toString?.() || "").trim();
        const title = document.title ? `Cím: ${document.title}` : "";
        const url = location.href ? `URL: ${location.href}` : "";
        const body = String(document.body?.innerText || "")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return [url, title, selected ? `Kijelölés:\n${selected}` : "", body]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 30000);
      });
      await channel.send({ type: "broadcast", event: "pageText", payload: { text } });
    } catch (e) {
      await channel
        .send({
          type: "broadcast",
          event: "pageText",
          payload: { text: `Nem sikerült kiolvasni az oldalszöveget: ${e.message}` },
        })
        .catch(() => {});
    }
  });

  channel.on("broadcast", { event: "selectAll" }, async () => {
    console.log(`[session ${session.id}] selectAll fogadva, kijelölés + szövegkinyerés indul`);
    // Azonnali visszajelzés: "Folyamatban…" — így a kliens tudja, hogy a worker él
    await channel
      .send({
        type: "broadcast",
        event: "pageText",
        payload: { text: "Folyamatban: oldalszöveg kinyerése…" },
      })
      .catch((e) => console.warn(`[session ${session.id}] ack send hiba:`, e?.message));
    try {
      await page.keyboard.press("Control+A").catch((e) => {
        console.warn(`[session ${session.id}] Control+A press hiba:`, e?.message);
      });
      const text = await page.evaluate(() => {
        const selected = String(window.getSelection?.()?.toString?.() || "").trim();
        const title = document.title ? `Cím: ${document.title}` : "";
        const url = location.href ? `URL: ${location.href}` : "";
        const body = String(document.body?.innerText || "")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return [url, title, selected ? `Kijelölés:\n${selected}` : "", body]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 60000);
      });
      console.log(
        `[session ${session.id}] szöveg kinyerve, hossz=${text.length}, küldés a kliensnek`,
      );
      const result = await channel.send({
        type: "broadcast",
        event: "pageText",
        payload: { text },
      });
      console.log(`[session ${session.id}] pageText send eredmény:`, result);
      pushAction({ type: "key", key: "Control+A", t: Date.now() });
    } catch (e) {
      console.error(`[session ${session.id}] selectAll hiba:`, e?.stack || e?.message || e);
      await channel
        .send({
          type: "broadcast",
          event: "pageText",
          payload: { text: `Nem sikerült kijelölni/kiolvasni az oldalt: ${e.message}` },
        })
        .catch(() => {});
    }
  });

  channel.on("broadcast", { event: "stop" }, async ({ payload }) => {
    console.log(`[session ${session.id}] stop received (save=${payload?.save})`);
    stopped = true;
  });

  // saveCookies: a modal a "Sütik mentése workflow-ba" gombra ezt küldi.
  // A recorder kiolvassa a böngésző context.cookies() állományát, majd
  // POST-tal átadja a Brainnek, ami titkosítva beírja a workflow_credentials
  // cookie mezőibe. Nem zárja le a sessiont — a felhasználó folytathatja,
  // pl. újabb sütiket gyűjthet, vagy egyből leállíthatja.
  channel.on("broadcast", { event: "saveCookies" }, async () => {
    console.log(`[session ${session.id}] saveCookies fogadva`);
    try {
      const cookies = await context.cookies();
      // Csak a Playwright által visszaadott, biztonságosan szerializálható
      // mezőket adjuk tovább; szűkítés a Brain oldalán Zod-dal is történik.
      const payload = cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      }));
      const res = await brainPost("/api/public/worker/save-cookies", {
        sessionId: session.id,
        cookies: payload,
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try {
          msg = JSON.parse(text).error || text;
        } catch {}
        console.error(`[session ${session.id}] cookieSave hiba: ${msg}`);
        await channel
          .send({
            type: "broadcast",
            event: "cookieSaveError",
            payload: { error: msg },
          })
          .catch(() => {});
        return;
      }
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {}
      console.log(
        `[session ${session.id}] cookieSave OK: ${data?.savedCount ?? payload.length} süti`,
      );
      await channel
        .send({
          type: "broadcast",
          event: "cookiesSaved",
          payload: {
            savedCount: data?.savedCount ?? payload.length,
            platform: data?.platform ?? null,
          },
        })
        .catch(() => {});
    } catch (e) {
      console.error(`[session ${session.id}] saveCookies exception`, e.message);
      await channel
        .send({
          type: "broadcast",
          event: "cookieSaveError",
          payload: { error: e.message },
        })
        .catch(() => {});
    }
  });

  page.on("framenavigated", async (f) => {
    if (f !== page.mainFrame()) return;
    const url = f.url();
    try {
      await channel.send({ type: "broadcast", event: "nav", payload: { url } });
    } catch {}
    pushAction({ type: "navigate", url, t: Date.now() });
  });

  await new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      console.log(`[session ${session.id}] channel subscribe status=${status}`);
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        reject(new Error(`realtime ${status}`));
    });
  });

  await channel.send({
    type: "broadcast",
    event: "ready",
    payload: { w: viewportW, h: viewportH },
  });

  // ---- Belépés-előjáték (prelude) ----
  // Ha a Brain küldött belépés-kockát, azt ELŐBB automatikusan lejátsszuk egy
  // valódi teszt fiókkal, és csak utána navigálunk a felvétel kezdőoldalára.
  // Így a felhasználó már bejelentkezve kezdi a rögzítést.
  if (
    !stopped &&
    payload.prelude &&
    Array.isArray(payload.prelude.actions) &&
    payload.prelude.actions.length
  ) {
    try {
      await channel
        .send({
          type: "broadcast",
          event: "status",
          payload: { status: "running", note: "Automatikus belépés folyamatban…" },
        })
        .catch(() => {});
      await playPrelude(page, payload.prelude, session.id);
      console.log(`[session ${session.id}] prelude done → ${page.url()}`);
    } catch (e) {
      console.error(`[session ${session.id}] prelude hiba:`, e?.message ?? e);
    }
  }

  if (effectiveStartUrl) {
    try {
      await page.goto(effectiveStartUrl, { waitUntil: "domcontentloaded" });
    } catch (e) {
      const friendlyError = friendlyInitialNavigationError(e, proxy);
      console.error(`[session ${session.id}] initial goto failed`, e.message);
      await fetchStatus(session.id, { error: friendlyError.slice(0, 500) });
      await channel
        .send({
          type: "broadcast",
          event: "status",
          payload: { status: "failed", error: friendlyError },
        })
        .catch(() => {});
      stopped = true;
    }
  }

  // Frame loop
  const frameDelay = Math.max(50, Math.floor(1000 / FRAME_FPS));
  (async () => {
    while (!stopped) {
      try {
        const size = page.viewportSize() || { width: viewportW, height: viewportH };
        viewportW = size.width;
        viewportH = size.height;
        const buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
        await channel.send({
          type: "broadcast",
          event: "frame",
          payload: {
            dataUrl: "data:image/jpeg;base64," + buf.toString("base64"),
            w: viewportW,
            h: viewportH,
            ts: Date.now(),
          },
        });
      } catch {
        // navigálás közben ok, megyünk tovább
      }
      await sleep(frameDelay);
    }
  })().catch((e) => console.error(`[session ${session.id}] frame loop`, e.message));

  // Várjuk meg a stop-ot vagy a Brain felől érkező cancel-t
  while (!stopped) {
    await sleep(POLL_INTERVAL_MS);
    const st = await fetchStatus(session.id);
    if (!st || ["cancelled", "completed", "failed", "missing"].includes(st)) {
      stopped = true;
    }
  }

  // Automatikus cookie-mentés a session lezárása ELŐTT.
  // Így a felhasználónak nem kell a "Sütik mentése" gombot külön megnyomnia:
  // ha a felvétel végén bejelentkezett állapotban volt, a sütik automatikusan
  // átkerülnek a workflow_credentials-be. Csak akkor futtatjuk, ha érdemi süti
  // van, hogy ne írjuk felül az esetleges korábbi mentést üres listával.
  try {
    const cookies = await context.cookies();
    if (Array.isArray(cookies) && cookies.length > 0) {
      const payload = cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      }));
      const res = await brainPost("/api/public/worker/save-cookies", {
        sessionId: session.id,
        cookies: payload,
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        let msg = text;
        try {
          msg = JSON.parse(text).error || text;
        } catch {}
        console.error(`[session ${session.id}] auto cookieSave hiba: ${msg}`);
      } else {
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {}
        console.log(
          `[session ${session.id}] auto cookieSave OK: ${data?.savedCount ?? payload.length} süti (session vége)`,
        );
      }
    } else {
      console.log(`[session ${session.id}] auto cookieSave kihagyva: nincs süti a contextben`);
    }
  } catch (e) {
    console.error(`[session ${session.id}] auto cookieSave exception:`, e?.message ?? e);
  }

  try {
    await channel.unsubscribe();
  } catch {}
  try {
    await sb.removeAllChannels();
  } catch {}
  try {
    await context.close();
  } catch {}

  console.log(`[session ${session.id}] ended (${actions.length} actions)`);
}

async function loop() {
  console.log(`[${WORKER_ID}] recorder → ${BRAIN_URL} | max ${MAX_SESSIONS} párhuzamos session`);
  console.log(
    `[${WORKER_ID}] recording poll aktív: ${POLL_INTERVAL_MS}ms-onként nézem a /api/public/worker/record-claim végpontot`,
  );

  installCrashGuards();
  const health = createHealth({
    port: Number(process.env.HEALTH_PORT || 9091),
    label: `recorder ${WORKER_ID}`,
    getInflight: () => active.size,
    getLimit: () => MAX_SESSIONS,
  });
  installGracefulShutdown({
    state: health.state,
    getInflight: () => active.size,
    maxWaitMs: Number(process.env.RECORDER_DRAIN_TIMEOUT_MS || 20 * 60 * 1000),
  });

  while (true) {
    try {
      health.tick();
      if (!health.state.draining && active.size < MAX_SESSIONS) {
        const payload = await claimNext();
        if (payload?.session) {
          const id = payload.session.id;
          const p = runSession(payload)
            .catch(async (e) => {
              console.error(`[session ${id}] crashed`, e.message);
              await fetchStatus(id, { error: e.message?.slice(0, 500) ?? "unknown" });
            })
            .finally(() => active.delete(id));
          active.set(id, p);
          continue; // azonnal próbálj még egyet
        }
      }
    } catch (e) {
      console.error("[loop] hiba, folytatom:", e?.message || e);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

loop().catch((e) => {
  console.error("[recorder] fatal", e);
  process.exit(1);
});
