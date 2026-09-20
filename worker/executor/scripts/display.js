// worker/executor/scripts/display.js
// Virtuális kijelző (Xvfb) biztosítása a headed Chromium indításához.
//
// Miért kell: a headless Chrome önmagában erős botjel (CreepJS "100% headless",
// Cloudflare/Pinterest/Facebook loop). A recorder már headed módban fut Xvfb
// alatt — az executor is ugyanezt kapja, hogy a két futtatókörnyezet
// ujjlenyomata megegyezzen.

import { spawn, spawnSync } from "node:child_process";

let xvfbProcess = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isDisplayReady(display) {
  const result = spawnSync("xdpyinfo", ["-display", display], {
    stdio: "ignore",
    timeout: 1500,
  });
  return result.status === 0;
}

/**
 * Elindítja (vagy megtalálja) az Xvfb kijelzőt, és beállítja a DISPLAY env-et.
 * @returns {Promise<string|null>} a kijelző neve, vagy null ha nem sikerült
 */
export async function ensureVirtualDisplay(log = () => {}, size = "1280x960x24") {
  const display = process.env.DISPLAY || ":99";
  process.env.DISPLAY = display;

  if (isDisplayReady(display)) return display;

  try {
    xvfbProcess = spawn(
      "Xvfb",
      [display, "-screen", "0", size, "-ac", "+extension", "GLX", "+render", "-noreset"],
      { detached: false, stdio: ["ignore", "ignore", "pipe"] },
    );
    xvfbProcess.on("error", () => {});
  } catch {
    log("warn", "Xvfb nem indítható — headless módra esünk vissza.");
    return null;
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (isDisplayReady(display)) {
      log("info", `Virtuális kijelző kész: ${display}`);
      return display;
    }
    await sleep(100);
  }

  log("warn", "A virtuális kijelző nem indult el — headless módra esünk vissza.");
  return null;
}

export function stopVirtualDisplay() {
  if (xvfbProcess && !xvfbProcess.killed) {
    try {
      xvfbProcess.kill("SIGTERM");
    } catch {}
    xvfbProcess = null;
  }
}
