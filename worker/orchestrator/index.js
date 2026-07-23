// worker/orchestrator/index.js
//
// Saját VPS-en futó folyamat. NEM nyúl közvetlenül a Supabase-hez —
// a Lovable Brain publikus job-API-ját hívja megosztott tokennel:
//
//   POST {BRAIN_URL}/api/public/worker/claim     → következő job (vagy 204)
//   POST {BRAIN_URL}/api/public/worker/complete  → végeredmény + logok
//
// Minden claim-elt jobra indít egy Docker konténert az executor image-ből,
// és a stdout JSON-line logjait + a `final` rekordot visszaküldi.
//
// Indítás: docker compose up -d --build (lásd worker/README.md)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// A payloadokat (spec, credentials, proxy) fájlon keresztül adjuk át a
// konténernek. Régebben env változóként (SPEC_JSON=...) argv-be raktuk, de
// nagy süti-payloadnál (Reddit warmup) argv+envp együtt átlépte a Linux
// ARG_MAX limitet → `spawn E2BIG`. Fájl+mount esetén az argv rövid marad.
const JOB_MOUNT_DIR = "/tmp/kylo-jobs";
try { mkdirSync(JOB_MOUNT_DIR, { recursive: true }); } catch {}

const BRAIN_URL = (process.env.BRAIN_URL || "").replace(/\/$/, "");
const WORKER_API_TOKEN = process.env.WORKER_API_TOKEN;
const WORKER_ID = process.env.WORKER_ID || "worker-1";
const IMAGE = process.env.EXECUTOR_IMAGE || "kylo-executor:latest";
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 4);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);

if (!BRAIN_URL || !WORKER_API_TOKEN) {
  console.error(
    "BRAIN_URL és WORKER_API_TOKEN kötelező a .env-ben. Lásd worker/README.md.",
  );
  process.exit(1);
}

const inflight = new Set();
let lastIdleLogAt = 0;

async function brainFetch(path, body) {
  const res = await fetch(`${BRAIN_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WORKER_API_TOKEN}`,
      "x-worker-token": WORKER_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  return res;
}

async function claimNext() {
  try {
    const res = await brainFetch("/api/public/worker/claim", { workerId: WORKER_ID });
    if (res.status === 204) {
      const now = Date.now();
      if (now - lastIdleLogAt > 30000) {
        console.log(`[claim] nincs felvehető workflow run (204)`);
        lastIdleLogAt = now;
      }
      return null;
    }
    if (!res.ok) {
      console.error(`[claim] ${res.status} ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    if (data.run?.id) {
      console.log(`[claim] workflow run felvéve: ${data.run.id}`);
    } else {
      console.warn(`[claim] váratlan válasz: ${JSON.stringify(data).slice(0, 500)}`);
    }
    return data.run ?? null;
  } catch (e) {
    console.error("[claim] network error", e.message);
    return null;
  }
}

async function reportComplete(payload) {
  try {
    const res = await brainFetch("/api/public/worker/complete", payload);
    if (!res.ok) console.error(`[complete] ${res.status} ${await res.text()}`);
  } catch (e) {
    console.error("[complete] network error", e.message);
  }
}

function runContainer(job) {
  return new Promise((resolve) => {
    // Per-run job könyvtár a host /tmp/kylo-jobs-ban (a compose bemounttal
    // ugyanezt látja az orchestrator konténer is). A konténerbe /job néven
    // mountoljuk, hogy az executor stabil útvonalról olvashassa.
    const jobDir = join(JOB_MOUNT_DIR, String(job.id));
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, "spec.json"), JSON.stringify(job.spec ?? {}));
    if (job.credentials) {
      writeFileSync(join(jobDir, "credentials.json"), JSON.stringify(job.credentials));
    }
    if (job.proxy) {
      writeFileSync(join(jobDir, "proxy.json"), JSON.stringify(job.proxy));
    }

    const args = [
      "run", "--rm",
      "--network", "bridge",
      "-v", `${jobDir}:/job:ro`,
      "-e", `SPEC_FILE=/job/spec.json`,
      "-e", `BRAIN_URL=${BRAIN_URL}`,
      "-e", `WORKER_API_TOKEN=${WORKER_API_TOKEN}`,
    ];
    if (job.credentials) args.push("-e", `CREDENTIALS_FILE=/job/credentials.json`);
    if (job.proxy) args.push("-e", `PROXY_FILE=/job/proxy.json`);
    args.push(IMAGE);

    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const cleanup = () => { try { rmSync(jobDir, { recursive: true, force: true }); } catch {} };

    const logs = [];
    let finalEntry = null;
    let preflight = null;
    let dirty = false;

    const onLine = (line) => {
      const s = line.trim();
      if (!s) return;
      try {
        const obj = JSON.parse(s);
        if (obj.final) {
          finalEntry = obj;
        } else if (obj.preflight) {
          preflight = obj.preflight;
        } else {
          logs.push({
            ts: obj.ts || new Date().toISOString(),
            level: obj.level || "info",
            message: obj.message ?? s,
          });
          dirty = true;
        }
      } catch {
        logs.push({ ts: new Date().toISOString(), level: "info", message: s });
        dirty = true;
      }
    };

    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) onLine(line);
    });
    proc.stderr.on("data", (chunk) => {
      logs.push({
        ts: new Date().toISOString(),
        level: "error",
        message: chunk.toString().trim(),
      });
      dirty = true;
    });

    // Élő log-flush a Brain-nek ~2 mp-enként, hogy a UI-n látszódjon a folyamat.
    const flushTimer = setInterval(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await brainFetch("/api/public/worker/progress", {
          runId: job.id,
          logs: logs.slice(-500),
        });
      } catch (e) {
        // csendben — a végén /complete úgyis rögzíti
      }
    }, 2000);

    proc.on("close", (code) => {
      clearInterval(flushTimer);
      cleanup();
      const status = finalEntry?.status ?? (code === 0 ? "succeeded" : "failed");
      resolve({
        status,
        logs,
        result: finalEntry?.result ?? null,
        error: finalEntry?.error ?? (code !== 0 ? `exit ${code}` : null),
        preflight,
      });
    });
    proc.on("error", (err) => {
      clearInterval(flushTimer);
      cleanup();
      resolve({
        status: "failed",
        logs,
        result: null,
        error: `docker spawn hiba: ${err.message}`,
        preflight,
      });
    });
  });
}


async function processOne() {
  const job = await claimNext();
  if (!job) return;
  inflight.add(job.id);
  console.log(`[run ${job.id}] start (workflow ${job.workflowId})`);
  try {
    const out = await runContainer(job);
    await reportComplete({
      runId: job.id,
      status: out.status,
      logs: out.logs,
      result: out.result,
      error: out.error,
      preflight: out.preflight ?? null,
    });

    console.log(`[run ${job.id}] ${out.status}`);
  } catch (e) {
    await reportComplete({
      runId: job.id,
      status: "failed",
      logs: [],
      result: null,
      error: e.message,
    });
  } finally {
    inflight.delete(job.id);
  }
}

async function loop() {
  console.log(
    `[${WORKER_ID}] orchestrator → ${BRAIN_URL} | max ${MAX_PARALLEL} párhuzamos`,
  );
  console.log(
    `[${WORKER_ID}] workflow poll aktív: ${POLL_INTERVAL_MS}ms-onként nézem a /api/public/worker/claim végpontot`,
  );
  while (true) {
    if (inflight.size < MAX_PARALLEL) {
      processOne().catch((e) => console.error("processOne", e));
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
