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
import ws from "ws";
import { buildFingerprintInitScript } from "./fingerprint-patch.js";

let chromium = null;
async function getChromium() {
  if (chromium) return chromium;
  // A nehéz Playwright/stealth importokat nem top-level töltjük be, mert ha
  // ezek bármelyike megakad a VPS image-ben, a recorder a poll loopig sem jut el.
  const [{ chromium: extraChromium }, { default: StealthPlugin }] = await Promise.all([
    import("playwright-extra"),
    import("puppeteer-extra-plugin-stealth"),
  ]);
  const stealth = StealthPlugin();
  // A WebGL/CPU/RAM/platform értékeket a saját, workflow-hoz kötött
  // fingerprint init-script kezeli. Ha ezeket a stealth alapértékei írják felül,
  // a recorder és a későbbi executor nem ugyanannak a gépnek látszik.
  stealth.enabledEvasions.delete("webgl.vendor");
  stealth.enabledEvasions.delete("navigator.hardwareConcurrency");
  extraChromium.use(stealth);
  chromium = extraChromium;
  return chromium;
}

// ---- Proxy pool (residential, támogatott formátumok: host:port:user:pass vagy user:pass:host:port) ----
function parseProxy(raw, label) {
  const parts = String(raw || "").trim().split(":");
  const isPort = (value) => /^\d{2,5}$/.test(value || "");

  if (parts.length < 4) {
    console.error(`[proxy] ${label} hibás formátum (vár: host:port:user:pass vagy user:pass:host:port)`);
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
  const steps = clamp(
    Math.round(distance / 70) + Math.floor(randomBetween(3, 8)),
    7,
    28,
  );
  const curve = randomBetween(-0.22, 0.22);
  const jitter = Math.min(3.5, Math.max(0.8, distance / 280));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);
    const bow = Math.sin(Math.PI * t) * curve * distance;
    const px =
      from.x +
      dx * ease +
      (-dy / Math.max(distance, 1)) * bow +
      randomBetween(-jitter, jitter);
    const py =
      from.y +
      dy * ease +
      (dx / Math.max(distance, 1)) * bow +
      randomBetween(-jitter, jitter);
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
    if (pinterestish) {
      const host = parsed.hostname.toLowerCase();
      const official =
        host === "pinterest.com" ||
        host.endsWith(".pinterest.com") ||
        host === "pin.it" ||
        host.endsWith(".pin.it");
      if (!official) return PINTEREST_LOGIN_URL;
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
  // 'per-context' proxy placeholder — a tényleges proxy a newContext({ proxy })-ban dől el.
  browser = await chromium.launch({
    // A Pinterest a sima headless módot néha szétesett, "word word word"
    // fallback oldallal bünteti. A konténerben xvfb alatt futtatjuk, ezért
    // itt lehet headed módot használni valódi ablak nélkül is.
    headless: false,
    proxy: { server: "http://per-context" },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan,WebGPU",
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

  let target = editableFrom(document.elementFromPoint(x, y));
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
    const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]'))
      .filter(isEditable)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        return { el, r, edgeDistance: Math.hypot(dx, dy), centerDistance: Math.hypot(cx - x, cy - y) };
      })
      .filter((c) => c.r.width > 8 && c.r.height > 8 && c.edgeDistance <= 48)
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
  const el = document.activeElement;
  if (!el || !el.matches) return false;
  if (el.matches('textarea:not([disabled]):not([readonly])')) return true;
  if (el.matches('[contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]')) return true;
  if (!el.matches('input:not([disabled]):not([readonly])')) return false;
  const type = String(el.getAttribute('type') || 'text').toLowerCase();
  return !['hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(type);
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
  // FONTOS: a recorder böngésző-viewportját NEM a fingerprint diktálja
  // (az gyakran 1920×1080-at ad → a login modal a modálban kilóg a jobb
  // oldalra és nem lehet rákattintani). A recorder fix 1280×800-as képet
  // streamel, a kliens pedig csak megjeleníti/skálázza, nem méretezi át.
  // Alap: 1280×800, amit a fp-beli screen spoofing nem érint,
  // mert a fingerprint-patch csak a JS screen/window API-kat hazudja át.
  const viewport = { width: VIEWPORT_W, height: VIEWPORT_H };
  if (fp?.viewport?.width && fp?.viewport?.height) {
    console.log(
      `[session ${session.id}] fp.viewport=${fp.viewport.width}×${fp.viewport.height} ignorálva → recorder böngésző ${viewport.width}×${viewport.height} (a spoof screen dimenziók változatlanok)`,
    );
  }
  if (proxy) {
    console.log(
      `[session ${session.id}] using ${proxy.label} (${proxy.server}) · locale=${locale} · tz=${timezoneId} · fp=${fp ? `Chrome${fp.chromeMajor}/${fp.platform}` : "recorder-default"}`,
    );
  } else {
    console.warn(
      `[session ${session.id}] NINCS proxy — direkt IP-vel megy (nem javasolt)!`,
    );
  }
  const context = await br.newContext({
    viewport,
    userAgent,
    locale,
    timezoneId,
    ...(fp?.deviceScaleFactor ? { deviceScaleFactor: fp.deviceScaleFactor } : {}),
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
  // deviceMemory, platform, WebRTC leak-védelem) — hogy a recorderrel
  // felvett első bejelentkezés is UGYANOLYAN böngészőnek látsszon, mint
  // a későbbi workflow futások.
  if (fp) {
    try {
      await context.addInitScript(buildFingerprintInitScript(fp));
    } catch (e) {
      console.warn(`[session ${session.id}] fingerprint init-script hiba: ${e.message}`);
    }
  }
  // Pinterest és hasonló oldalak nem csak azt nézik, hogy `navigator.webdriver`
  // false-e, hanem azt is, hogy a getter egyáltalán létezik-e. Ezért a propertyt
  // teljesen töröljük minden oldal betöltése előtt.
  await context.addInitScript(REMOVE_WEBDRIVER_INIT);
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
    config: { broadcast: { self: false, ack: false } },
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
    channel
      .send({ type: "broadcast", event: "action", payload: { action: a } })
      .catch(() => {});
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

  let lastClickPoint = null;
  let lastClickSelector = null;
  let cursorPoint = {
    x: Math.round(viewportW * randomBetween(0.25, 0.75)),
    y: Math.round(viewportH * randomBetween(0.25, 0.75)),
  };

  async function ensureEditableFocusFromLastClick() {
    if (!lastClickPoint || Date.now() - lastClickPoint.t > 8000) return;
    if (await hasEditableFocus()) return;
    await focusEditableAt(lastClickPoint.x, lastClickPoint.y);
  }

  channel.on("broadcast", { event: "click" }, async ({ payload }) => {
    try {
      const vs = page.viewportSize();
      const x = payload.x * vs.width;
      const y = payload.y * vs.height;
      lastClickPoint = { x, y, t: Date.now() };
      const desc = await describeAt(x, y);
      lastClickSelector = desc?.selector || `point:${Math.round(payload.x * 10000)},${Math.round(payload.y * 10000)}`;
      await channel.send({
        type: "broadcast",
        event: "inputAck",
        payload: { kind: "click", status: "received", x: Math.round(x), y: Math.round(y) },
      }).catch(() => {});
      await humanClick(page, cursorPoint, { x, y });
      cursorPoint = { x, y };
      await focusEditableAt(x, y);
      pushAction({
        type: "click",
        selector: lastClickSelector,
        x: payload.x,
        y: payload.y,
        text: desc?.text ?? null,
        t: Date.now(),
      });
      await channel.send({
        type: "broadcast",
        event: "inputAck",
        payload: { kind: "click", status: "done", x: Math.round(x), y: Math.round(y) },
      }).catch(() => {});
    } catch (e) {
      console.error(`[session ${session.id}] click error`, e.message);
      await channel.send({
        type: "broadcast",
        event: "inputError",
        payload: { kind: "click", error: e.message },
      }).catch(() => {});
    }
  });

  channel.on("broadcast", { event: "type" }, async ({ payload }) => {
    try {
      await ensureEditableFocusFromLastClick();
      await page.keyboard.type(payload.text || "");
      pushAction({
        type: "type",
        selector: lastClickSelector || "activeElement",
        value: payload.text || "",
        t: Date.now(),
      });
    } catch (e) {
      console.error(`[session ${session.id}] type error`, e.message);
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
    try {
      const url = normalizeUrl(payload?.url);
      if (!url) return;
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      console.error(`[session ${session.id}] goto error`, e.message);
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
      await channel.send({
        type: "broadcast",
        event: "pageText",
        payload: { text: `Nem sikerült kiolvasni az oldalszöveget: ${e.message}` },
      }).catch(() => {});
    }
  });

  channel.on("broadcast", { event: "selectAll" }, async () => {
    console.log(`[session ${session.id}] selectAll fogadva, kijelölés + szövegkinyerés indul`);
    // Azonnali visszajelzés: "Folyamatban…" — így a kliens tudja, hogy a worker él
    await channel.send({
      type: "broadcast",
      event: "pageText",
      payload: { text: "Folyamatban: oldalszöveg kinyerése…" },
    }).catch((e) => console.warn(`[session ${session.id}] ack send hiba:`, e?.message));
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
      console.log(`[session ${session.id}] szöveg kinyerve, hossz=${text.length}, küldés a kliensnek`);
      const result = await channel.send({ type: "broadcast", event: "pageText", payload: { text } });
      console.log(`[session ${session.id}] pageText send eredmény:`, result);
      pushAction({ type: "key", key: "Control+A", t: Date.now() });
    } catch (e) {
      console.error(`[session ${session.id}] selectAll hiba:`, e?.stack || e?.message || e);
      await channel.send({
        type: "broadcast",
        event: "pageText",
        payload: { text: `Nem sikerült kijelölni/kiolvasni az oldalt: ${e.message}` },
      }).catch(() => {});
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

  if (session.startUrl) {
    const url = normalizeUrl(session.startUrl);
    try {
      if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      console.error(`[session ${session.id}] initial goto failed`, e.message);
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

  try { await channel.unsubscribe(); } catch {}
  try { await sb.removeAllChannels(); } catch {}
  try { await context.close(); } catch {}

  console.log(`[session ${session.id}] ended (${actions.length} actions)`);
}

async function loop() {
  console.log(
    `[${WORKER_ID}] recorder → ${BRAIN_URL} | max ${MAX_SESSIONS} párhuzamos session`,
  );
  console.log(
    `[${WORKER_ID}] recording poll aktív: ${POLL_INTERVAL_MS}ms-onként nézem a /api/public/worker/record-claim végpontot`,
  );
  while (true) {
    if (active.size < MAX_SESSIONS) {
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
    await sleep(POLL_INTERVAL_MS);
  }
}

loop().catch((e) => {
  console.error("[recorder] fatal", e);
  process.exit(1);
});
