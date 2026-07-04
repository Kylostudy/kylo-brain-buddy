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
    if (res.status === 204) return null;
    if (!res.ok) {
      console.error(`[claim] ${res.status} ${await res.text()}`);
      return null;
    }
    const data = await res.json();
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
    const args = [
      "run", "--rm",
      "--network", "bridge",
      "-e", `SPEC_JSON=${JSON.stringify(job.spec ?? {})}`,
      // Az executor a Brain publikus worker-API-jához kapcsolódik (tanult
      // szelektorok lekérése, Gemini vision hívás). Ugyanaz a URL és token
      // mint az orchestrator-é.
      "-e", `BRAIN_URL=${BRAIN_URL}`,
      "-e", `WORKER_API_TOKEN=${WORKER_API_TOKEN}`,
    ];
    if (job.credentials) {
      args.push("-e", `CREDENTIALS_JSON=${JSON.stringify(job.credentials)}`);
    }
    if (job.proxy) {
      args.push("-e", `PROXY_JSON=${JSON.stringify(job.proxy)}`);
    }
    args.push(IMAGE);

    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });

    const logs = [];
    let finalEntry = null;
    let preflight = null;

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
        }
      } catch {
        logs.push({ ts: new Date().toISOString(), level: "info", message: s });
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
    });

    proc.on("close", (code) => {
      const status = finalEntry?.status ?? (code === 0 ? "succeeded" : "failed");
      resolve({
        status,
        logs,
        result: finalEntry?.result ?? null,
        error: finalEntry?.error ?? (code !== 0 ? `exit ${code}` : null),
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
  while (true) {
    if (inflight.size < MAX_PARALLEL) {
      processOne().catch((e) => console.error("processOne", e));
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
