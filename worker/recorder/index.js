// worker/recorder/index.js
//
// Élő böngésző-felvétel worker. Két oldalról beszél kifelé:
//
//  1) Lovable Brain (HTTPS POST) — új session lekérése
//     POST {BRAIN_URL}/api/public/worker/record-claim  Bearer WORKER_API_TOKEN
//
//  2) Supabase Realtime (kimenő WSS) — frame stream + user input
//     csatorna: record:<sessionId>
//
// Semmilyen inbound portot NEM nyitunk a VPS-en.
//
// Egy folyamat több párhuzamos session-t is kezel (külön Playwright
// browser context-tel). A MAX_SESSIONS env-vel korlátozható.

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BRAIN_URL = (process.env.BRAIN_URL || "").replace(/\/$/, "");
const WORKER_API_TOKEN = process.env.WORKER_API_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_ID = process.env.WORKER_ID || "recorder-1";
const POLL_INTERVAL_MS = Number(process.env.RECORD_POLL_INTERVAL_MS || 2000);
const MAX_SESSIONS = Number(process.env.RECORD_MAX_SESSIONS || 2);
const FRAME_FPS = Number(process.env.RECORD_FPS || 5);
const VIEWPORT_W = Number(process.env.RECORD_VIEWPORT_W || 1280);
const VIEWPORT_H = Number(process.env.RECORD_VIEWPORT_H || 800);

if (!BRAIN_URL || !WORKER_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[recorder] BRAIN_URL, WORKER_API_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY kötelezőek.",
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 30 } },
});

let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
}

const active = new Map(); // sessionId -> { stop }

async function claimNext() {
  try {
    const res = await fetch(`${BRAIN_URL}/api/public/worker/record-claim`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WORKER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workerId: WORKER_ID }),
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      console.error(`[record-claim] ${res.status} ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    return data.session ?? null;
  } catch (e) {
    console.error("[record-claim] network error", e.message);
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Az elem visszafejtése koordinátákból + robosztus selector.
const SELECTOR_FN = `(x, y) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const path = [];
  let node = el;
  function describe(n) {
    if (n.getAttribute && n.getAttribute('data-testid')) return '[data-testid="' + n.getAttribute('data-testid') + '"]';
    if (n.id && /^[A-Za-z][\\w-]*$/.test(n.id)) return '#' + n.id;
    if (n.getAttribute && n.getAttribute('aria-label')) return n.tagName.toLowerCase() + '[aria-label="' + n.getAttribute('aria-label').replace(/"/g,'\\\\"') + '"]';
    return null;
  }
  // Próbáljunk egylépéses egyedi selectort
  const own = describe(node);
  if (own) return { selector: own, text: (node.innerText||'').slice(0,80) };
  // Egyébként path 3 mélyig
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

async function runSession(session) {
  console.log(`[session ${session.id}] start (workflow ${session.workflowId})`);
  const br = await getBrowser();
  const context = await br.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
  });
  const page = await context.newPage();

  let stopped = false;
  const actions = [];
  const pushAction = (a) => {
    actions.push(a);
    channel.send({
      type: "broadcast",
      event: "action",
      payload: { action: a },
    }).catch(() => {});
  };

  const channel = sb.channel(session.channel, {
    config: { broadcast: { self: false, ack: false } },
  });

  async function describeAt(x, y) {
    try {
      return await page.evaluate(`(${SELECTOR_FN})(${x}, ${y})`);
    } catch {
      return null;
    }
  }

  channel.on("broadcast", { event: "click" }, async ({ payload }) => {
    try {
      const vw = page.viewportSize().width;
      const vh = page.viewportSize().height;
      const x = payload.x * vw;
      const y = payload.y * vh;
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
      pushAction({ type: "type", selector: null, value: payload.text || "", t: Date.now() });
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
      await page.goto(payload.url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      console.error(`[session ${session.id}] goto error`, e.message);
    }
  });

  channel.on("broadcast", { event: "back" }, () => page.goBack().catch(() => {}));
  channel.on("broadcast", { event: "forward" }, () => page.goForward().catch(() => {}));
  channel.on("broadcast", { event: "reload" }, () => page.reload().catch(() => {}));

  channel.on("broadcast", { event: "scroll" }, async ({ payload }) => {
    try {
      await page.mouse.wheel(payload.dx || 0, payload.dy || 0);
      pushAction({ type: "scroll", x: payload.dx || 0, y: payload.dy || 0, t: Date.now() });
    } catch {}
  });

  channel.on("broadcast", { event: "stop" }, async ({ payload }) => {
    console.log(`[session ${session.id}] stop received (save=${payload?.save})`);
    stopped = true;
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
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`realtime ${status}`));
    });
  });

  // ready ping, hogy a kliens tudja: a worker él
  await channel.send({
    type: "broadcast",
    event: "ready",
    payload: { w: VIEWPORT_W, h: VIEWPORT_H },
  });

  if (session.startUrl) {
    try {
      await page.goto(session.startUrl, { waitUntil: "domcontentloaded" });
    } catch (e) {
      console.error(`[session ${session.id}] initial goto failed`, e.message);
    }
  }

  // Frame loop
  const frameDelay = Math.max(50, Math.floor(1000 / FRAME_FPS));
  (async () => {
    while (!stopped) {
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
        await channel.send({
          type: "broadcast",
          event: "frame",
          payload: {
            dataUrl: "data:image/jpeg;base64," + buf.toString("base64"),
            w: VIEWPORT_W,
            h: VIEWPORT_H,
            ts: Date.now(),
          },
        });
      } catch (e) {
        // page lehet, hogy navigálás közben volt — csak nézzük tovább
      }
      await sleep(frameDelay);
    }
  })().catch((e) => console.error(`[session ${session.id}] frame loop`, e.message));

  // Várjuk meg a stop-ot vagy a DB cancel-t
  while (!stopped) {
    await sleep(2000);
    try {
      const { data } = await sb
        .from("recording_sessions")
        .select("status")
        .eq("id", session.id)
        .maybeSingle();
      if (!data || ["cancelled", "completed", "failed"].includes(data.status)) {
        stopped = true;
      }
    } catch {}
  }

  // Takarítás
  try {
    await channel.unsubscribe();
  } catch {}
  try {
    await context.close();
  } catch {}

  console.log(`[session ${session.id}] ended (${actions.length} actions recorded)`);
  // Az action_log-ot a kliens menti `saveRecording`-gal.
  // Csak akkor jelölünk failed-et, ha mi magunk hibáztunk — itt nem.
}

async function loop() {
  console.log(
    `[${WORKER_ID}] recorder → ${BRAIN_URL} | max ${MAX_SESSIONS} párhuzamos session`,
  );
  while (true) {
    if (active.size < MAX_SESSIONS) {
      const session = await claimNext();
      if (session) {
        const wrapped = runSession(session)
          .catch(async (e) => {
            console.error(`[session ${session.id}] crashed`, e.message);
            try {
              await sb
                .from("recording_sessions")
                .update({
                  status: "failed",
                  error: e.message?.slice(0, 500) ?? "unknown",
                  ended_at: new Date().toISOString(),
                })
                .eq("id", session.id);
            } catch {}
          })
          .finally(() => active.delete(session.id));
        active.set(session.id, { stop: () => {} });
        // Ne await-eljünk — párhuzamosan futnak
        void wrapped;
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

loop();

process.on("SIGTERM", async () => {
  console.log("[recorder] SIGTERM — leállás");
  try {
    if (browser) await browser.close();
  } catch {}
  process.exit(0);
});
