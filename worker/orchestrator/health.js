// worker/orchestrator/health.js
//
// Öngyógyító réteg: kis HTTP health szerver + leállási (drain) állapot.
//
// - /health : 200, ha a fő ciklus az elmúlt STALL_MS-ben pörgött, különben 503.
//             A Docker healthcheck ezt hívja; ha 503, az autoheal újraindítja.
// - drain   : SIGTERM/SIGINT esetén NEM szakítjuk félbe a futó munkákat,
//             csak abbahagyjuk az új munkák felvételét, és megvárjuk a
//             folyamatban lévőket. Így egy worker újraindítás nem töri szét
//             a Brain éppen futó folyamatait (pl. 45 perces süti-gyűjtés).

import { createServer } from "node:http";

const STALL_MS = Number(process.env.HEALTH_STALL_MS || 120000);

export function createHealth({ port = 9090, getInflight, getLimit, getExtra, label = "worker" }) {
  const state = {
    lastTickAt: Date.now(),
    startedAt: Date.now(),
    draining: false,
  };

  const tick = () => {
    state.lastTickAt = Date.now();
  };

  const server = createServer((req, res) => {
    const age = Date.now() - state.lastTickAt;
    const healthy = age < STALL_MS;
    const body = {
      ok: healthy,
      label,
      draining: state.draining,
      lastTickAgoMs: age,
      uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
      inflight: getInflight?.() ?? null,
      limit: getLimit?.() ?? null,
    };
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  server.listen(port, () => {
    console.log(`[health] figyelő port ${port} (stall limit ${Math.round(STALL_MS / 1000)} mp)`);
  });
  server.on("error", (e) => console.error("[health] szerver hiba:", e.message));

  return { state, tick };
}

// Szabályos leállás: nincs új munka felvétele, a futók befejeződhetnek.
export function installGracefulShutdown({ state, getInflight, maxWaitMs, onDrainStart }) {
  const limit = Number(maxWaitMs ?? process.env.DRAIN_TIMEOUT_MS ?? 45 * 60 * 1000);
  let started = false;

  const handler = (signal) => {
    if (started) return;
    started = true;
    state.draining = true;
    const n = getInflight?.() ?? 0;
    console.log(
      `[drain] ${signal} érkezett — nem veszek fel új munkát. Folyamatban: ${n}. ` +
        `Legfeljebb ${Math.round(limit / 60000)} percet várok rájuk.`,
    );
    onDrainStart?.();
    const deadline = Date.now() + limit;
    const timer = setInterval(() => {
      const left = getInflight?.() ?? 0;
      if (left === 0) {
        clearInterval(timer);
        console.log("[drain] minden futás befejeződött, kilépés.");
        process.exit(0);
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        console.warn(`[drain] időkorlát lejárt, ${left} futás félbeszakad.`);
        process.exit(0);
      }
    }, 2000);
    timer.unref?.();
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}

// A folyamat soha ne haljon meg egy elkapatlan hibától: naplózzuk és megyünk tovább.
export function installCrashGuards() {
  process.on("uncaughtException", (e) => {
    console.error("[guard] uncaughtException:", e?.stack || e?.message || e);
  });
  process.on("unhandledRejection", (e) => {
    console.error("[guard] unhandledRejection:", e?.stack || e?.message || e);
  });
}
