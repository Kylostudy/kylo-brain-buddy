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

import { chromium as _rawChromium } from "playwright";
import { chromium as _extraChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Stealth plugin: álcázza a headless böngészőt valódi böngészőnek
// (Cloudflare / DataDome / PerimeterX bot-detektorok ellen).
_extraChromium.use(StealthPlugin());
const chromium = _extraChromium;

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
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
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

function normalizeUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return "https://" + url;
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
  // 'per-context' proxy placeholder — a tényleges proxy a newContext({ proxy })-ban dől el.
  browser = await chromium.launch({
    headless: true,
    proxy: { server: "http://per-context" },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  return browser;
}

const active = new Map(); // sessionId -> Promise

async function claimNext() {
  try {
    const res = await brainPost("/api/public/worker/record-claim", {
      workerId: WORKER_ID,
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      console.error(`[record-claim] ${res.status} ${await res.text()}`);
      return null;
    }
    return await res.json();
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

  const userAgent = pickUA();
  const locale = payload.locale || "hu-HU";
  const timezoneId = payload.timezone || "Europe/Budapest";
  if (proxy) {
    console.log(
      `[session ${session.id}] using ${proxy.label} (${proxy.server}) · locale=${locale} · tz=${timezoneId}`,
    );
  } else {
    console.warn(
      `[session ${session.id}] NINCS proxy — direkt IP-vel megy (nem javasolt)!`,
    );
  }
  const context = await br.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    userAgent,
    locale,
    timezoneId,
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
  const page = await context.newPage();

  let stopped = false;
  let viewportW = VIEWPORT_W;
  let viewportH = VIEWPORT_H;
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

  channel.on("broadcast", { event: "click" }, async ({ payload }) => {
    try {
      const vs = page.viewportSize();
      const x = payload.x * vs.width;
      const y = payload.y * vs.height;
      const desc = await describeAt(x, y);
      await page.mouse.click(x, y);
      pushAction({
        type: "click",
        selector: desc?.selector ?? null,
        x: payload.x,
        y: payload.y,
        text: desc?.text ?? null,
        t: Date.now(),
      });
    } catch (e) {
      console.error(`[session ${session.id}] click error`, e.message);
    }
  });

  channel.on("broadcast", { event: "type" }, async ({ payload }) => {
    try {
      await page.keyboard.type(payload.text || "");
      pushAction({ type: "type", value: payload.text || "", t: Date.now() });
    } catch (e) {
      console.error(`[session ${session.id}] type error`, e.message);
    }
  });

  channel.on("broadcast", { event: "key" }, async ({ payload }) => {
    try {
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
      viewportW = clamp(payload?.w, 900, 1920);
      viewportH = clamp(payload?.h, 620, 1200);
      await page.setViewportSize({ width: viewportW, height: viewportH });
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
