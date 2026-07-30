// worker/orchestrator/live-mode.js
//
// "Esti fejlesztői mód" — élő szkript-becsatolás build nélkül.
//
// Mit csinál: ha aktív, akkor az executor konténer NEM az image-be sütött
// szkripteket futtatja, hanem a VPS fájlrendszerén lévő friss fájlokat
// (read-only becsatolással). Így egy `git pull` után azonnal az új kód fut,
// nem kell `docker build` — másodpercek a percek helyett.
//
// Miért biztonságos:
//   * Csak KÉT dolgot csatolunk be: `executor/run.js` és `executor/scripts/`.
//     A node_modules és a Playwright böngészők maradnak az image-ből, tehát
//     csomagváltozáshoz továbbra is rendes (blue-green) build kell.
//   * Minden becsatolás read-only — a konténer nem tudja elrontani a forrást.
//   * Indítás előtt szintaxis-ellenőrzés (`node --check`) fut az összes érintett
//     fájlon. Egyetlen hibás fájl esetén a live mód KIKAPCSOL, és a futás a
//     bevált image-ből megy tovább. Soha nem indítunk félkész kóddal.
//   * Idősáv: alapból csak este/éjjel aktív (17:00–08:00, Európa/Budapest),
//     nappal a kiszámítható image-es működés van érvényben.
//   * Kapcsolófájlok a becsatolt könyvtárban: `.live-off` (mindig ki),
//     `.live-on` (mindig be). Ezekkel SSH-ból, 1 másodperc alatt lehet
//     kapcsolni, konténer-újraindítás nélkül.
//
// Beállítás (worker/.env):
//   LIVE_MODE=auto|on|off                (alap: auto)
//   LIVE_EXECUTOR_HOST_DIR=/opt/kylo/worker/executor   ← a VPS valódi útvonala
//   LIVE_WINDOW=17:00-08:00
//   LIVE_TZ=Europe/Budapest

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const MODE = (process.env.LIVE_MODE || "auto").toLowerCase();
const HOST_DIR = (process.env.LIVE_EXECUTOR_HOST_DIR || "").replace(/\/$/, "");
// Ugyanaz a könyvtár read-only becsatolva az orchestrator konténerbe, hogy
// ellenőrizni tudjuk a fájlokat, mielőtt bármit elindítanánk.
const MIRROR_DIR = (process.env.LIVE_EXECUTOR_MIRROR || "/live-executor").replace(/\/$/, "");
const WINDOW = process.env.LIVE_WINDOW || "17:00-08:00";
const TZ = process.env.LIVE_TZ || "Europe/Budapest";
// Ne ellenőrizzük fájlonként minden futásnál: 5 mp-nél frissebb eredményt újrahasználunk.
const CHECK_TTL_MS = Number(process.env.LIVE_CHECK_TTL_MS || 5000);

function parseWindow(spec) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(spec).trim());
  if (!m) return null;
  return {
    startMin: Number(m[1]) * 60 + Number(m[2]),
    endMin: Number(m[3]) * 60 + Number(m[4]),
  };
}

function nowMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mi = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + mi;
}

export function inLiveWindow(spec = WINDOW) {
  const w = parseWindow(spec);
  if (!w) return false;
  const n = nowMinutes();
  // Éjfélen átnyúló ablak (pl. 17:00–08:00) is helyesen működik.
  return w.startMin <= w.endMin
    ? n >= w.startMin && n < w.endMin
    : n >= w.startMin || n < w.endMin;
}

function listJsFiles(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) listJsFiles(full, out, depth + 1);
    else if (e.isFile() && (e.name.endsWith(".js") || e.name.endsWith(".mjs"))) out.push(full);
  }
  return out;
}

function signature(files) {
  const parts = [];
  for (const f of files) {
    try {
      const s = statSync(f);
      parts.push(`${f}:${Math.round(s.mtimeMs)}:${s.size}`);
    } catch {
      parts.push(`${f}:missing`);
    }
  }
  return parts.join("|");
}

let cache = { at: 0, sig: "", ok: false, errors: [], files: 0 };

// Szintaxis-ellenőrzés az összes becsatolandó fájlon. Csak akkor fut újra,
// ha valamelyik fájl megváltozott (mtime/méret) vagy lejárt a rövid TTL.
function verifyMirror() {
  const runJs = join(MIRROR_DIR, "run.js");
  const scriptsDir = join(MIRROR_DIR, "scripts");
  if (!existsSync(runJs) || !existsSync(scriptsDir)) {
    return { ok: false, errors: [`hiányzó fájlok a ${MIRROR_DIR} becsatolásban`], files: 0 };
  }

  const files = [runJs, ...listJsFiles(scriptsDir)];
  const sig = signature(files);
  const now = Date.now();
  if (sig === cache.sig && now - cache.at < CHECK_TTL_MS) {
    return { ok: cache.ok, errors: cache.errors, files: cache.files, cached: true };
  }

  const errors = [];
  for (const f of files) {
    const res = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    if (res.status !== 0) {
      errors.push(`${f}: ${(res.stderr || "").trim().split("\n").slice(0, 2).join(" ")}`);
      if (errors.length >= 5) break;
    }
  }

  cache = { at: now, sig, ok: errors.length === 0, errors, files: files.length };
  return { ok: cache.ok, errors, files: files.length };
}

let lastLoggedState = null;

/**
 * Eldönti, hogy az adott pillanatban élő szkriptekkel induljon-e a futás.
 * Visszaad: { active, reason, mounts: string[] (docker argumentumok), files }
 */
export function liveMounts() {
  if (MODE === "off") return { active: false, reason: "LIVE_MODE=off", mounts: [] };
  if (!HOST_DIR) {
    return { active: false, reason: "LIVE_EXECUTOR_HOST_DIR nincs beállítva", mounts: [] };
  }

  // Kapcsolófájlok — azonnali kézi vezérlés SSH-ból.
  const forcedOff = existsSync(join(MIRROR_DIR, ".live-off"));
  const forcedOn = existsSync(join(MIRROR_DIR, ".live-on"));
  if (forcedOff) return { active: false, reason: ".live-off kapcsolófájl", mounts: [] };

  if (MODE === "auto" && !forcedOn && !inLiveWindow()) {
    return { active: false, reason: `idősávon kívül (${WINDOW}, ${TZ})`, mounts: [] };
  }

  const check = verifyMirror();
  if (!check.ok) {
    return {
      active: false,
      reason: `szintaxis-ellenőrzés bukott — image-ből futtatok: ${check.errors.join(" | ")}`,
      mounts: [],
    };
  }

  return {
    active: true,
    reason: forcedOn ? ".live-on kapcsolófájl" : MODE === "on" ? "LIVE_MODE=on" : `idősáv ${WINDOW}`,
    files: check.files,
    mounts: [
      "-v", `${HOST_DIR}/run.js:/app/run.js:ro`,
      "-v", `${HOST_DIR}/scripts:/app/scripts:ro`,
    ],
  };
}

/** Naplózás csak állapotváltáskor, hogy ne szemetelje tele a logot. */
export function liveStatusForLog(state) {
  const key = `${state.active}|${state.reason}`;
  if (key === lastLoggedState) return null;
  lastLoggedState = key;
  return state.active
    ? `[live] esti fejlesztői mód BE (${state.reason}, ${state.files} fájl) — build nélkül a friss szkriptek futnak`
    : `[live] esti fejlesztői mód KI (${state.reason}) — az image-be épített szkriptek futnak`;
}

export const liveConfig = { MODE, HOST_DIR, MIRROR_DIR, WINDOW, TZ };
