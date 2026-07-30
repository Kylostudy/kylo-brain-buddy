// worker/orchestrator/metrics.js
//
// Percenkénti gép-életjel: CPU, RAM, lemez, futó konténerek száma.
// A Brain /api/public/worker/heartbeat végpontjára megy, ott rögzül,
// és utólag elemezhető, mennyi párhuzamos futást bír el a VPS.

import { spawn } from "node:child_process";
import os from "node:os";
import { statfsSync } from "node:fs";

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const key of Object.keys(cpu.times)) total += cpu.times[key];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

let prev = cpuTimes();

function cpuPercent() {
  const now = cpuTimes();
  const idleDiff = now.idle - prev.idle;
  const totalDiff = now.total - prev.total;
  prev = now;
  if (totalDiff <= 0) return null;
  return Math.round((1 - idleDiff / totalDiff) * 1000) / 10;
}

function diskPercent() {
  try {
    const s = statfsSync("/");
    const total = s.blocks * s.bsize;
    const free = s.bfree * s.bsize;
    if (!total) return null;
    return Math.round(((total - free) / total) * 1000) / 10;
  } catch {
    return null;
  }
}

function dockerPs() {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["ps", "--format", "{{.Names}}"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (c) => { out += c.toString(); });
    proc.on("error", () => resolve([]));
    proc.on("close", () => {
      resolve(out.split("\n").map((s) => s.trim()).filter(Boolean));
    });
  });
}

export function startHeartbeat({ brainFetch, workerId, getInflight, intervalMs = 60000, getExtraDetail }) {
  const send = async () => {
    try {
      const names = await dockerPs();
      const memTotal = os.totalmem();
      const memFree = os.freemem();
      const memUsed = memTotal - memFree;
      const [load1, load5] = os.loadavg();

      await brainFetch("/api/public/worker/heartbeat", {
        workerId,
        cpuPercent: cpuPercent(),
        load1: Math.round(load1 * 100) / 100,
        load5: Math.round(load5 * 100) / 100,
        memTotalMb: Math.round(memTotal / 1048576),
        memUsedMb: Math.round(memUsed / 1048576),
        memPercent: Math.round((memUsed / memTotal) * 1000) / 10,
        diskPercent: diskPercent(),
        containersRunning: names.length,
        inflightJobs: getInflight(),
        uptimeSeconds: Math.round(os.uptime()),
        detail: {
          cpus: os.cpus().length,
          executors: names.filter((n) => !/orchestrator|recorder|shots/.test(n)).length,
          containers: names.slice(0, 40),
          ...(getExtraDetail?.() ?? {}),
        },
      }, { timeoutMs: 15000 });
      console.log(
        `[heartbeat] elküldve — RAM ${Math.round((memUsed / memTotal) * 100)}%, load1 ${load1.toFixed(2)}, konténer ${names.length}`,
      );
    } catch (e) {
      console.error("[heartbeat] hiba:", e.message);
    }
  };

  // Első mérés rövid késleltetéssel (kell egy CPU-minta a különbséghez).
  setTimeout(send, 5000);
  setInterval(send, intervalMs);
  console.log(`[heartbeat] gép-életjel aktív: ${Math.round(intervalMs / 1000)} mp-enként`);
}
