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
import { startHeartbeat } from "./metrics.js";
import { createHealth, installGracefulShutdown, installCrashGuards } from "./health.js";
import { currentLimit, HARD_MAX } from "./capacity.js";

// A payloadokat (spec, credentials, proxy) fájlon keresztül adjuk át a
// konténernek. Régebben env változóként (SPEC_JSON=...) argv-be raktuk, de
// nagy süti-payloadnál (Reddit warmup) argv+envp együtt átlépte a Linux
// ARG_MAX limitet → `spawn E2BIG`. A fájlokat docker cp-vel másoljuk be az
// executor konténerbe, így nem függünk host volume mounttól.
const JOB_MOUNT_DIR = "/tmp/kylo-jobs";
try { mkdirSync(JOB_MOUNT_DIR, { recursive: true }); } catch {}

const BRAIN_URL = (process.env.BRAIN_URL || "").replace(/\/$/, "");
const WORKER_API_TOKEN = process.env.WORKER_API_TOKEN;
const WORKER_ID = process.env.WORKER_ID || "worker-1";
const IMAGE = process.env.EXECUTOR_IMAGE || "kylo-executor:latest";
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 12);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);

if (!BRAIN_URL || !WORKER_API_TOKEN) {
  console.error(
    "BRAIN_URL és WORKER_API_TOKEN kötelező a .env-ben. Lásd worker/README.md.",
  );
  process.exit(1);
}

const inflight = new Set();
let lastIdleLogAt = 0;

async function brainFetch(path, body, { timeoutMs = 60000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRAIN_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WORKER_API_TOKEN}`,
        "x-worker-token": WORKER_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      signal: ac.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadBytes(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? {}), "utf8");
  } catch {
    return 0;
  }
}

// A screenshotokat nem az adatbázisba küldjük, hanem a helyi (Hetzner) képpufferbe:
// a base64 blob helyére csak egy URL kerül. Ha a puffer nem érhető el, marad a régi
// viselkedés (base64 a riportban), hogy semmi ne vesszen el.
const SHOTS_UPLOAD_URL = (process.env.SHOTS_UPLOAD_URL || "").replace(/\/$/, "");

async function offloadScreenshots(runId, result) {
  if (!SHOTS_UPLOAD_URL || !result || typeof result !== "object") return result;
  const shots = result.screenshots;
  if (!Array.isArray(shots) || shots.length === 0) return result;

  let uploaded = 0;
  let failed = 0;
  const next = [];
  for (const shot of shots) {
    if (!shot || typeof shot !== "object" || typeof shot.b64 !== "string" || !shot.b64) {
      next.push(shot);
      continue;
    }
    try {
      const res = await fetch(`${SHOTS_UPLOAD_URL}/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WORKER_API_TOKEN}`,
          "x-worker-token": WORKER_API_TOKEN,
        },
        body: JSON.stringify({ runId: String(runId), b64: shot.b64, ext: "jpg" }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const { b64, ...rest } = shot;
      next.push({ ...rest, url: data.url, stored: "hetzner" });
      uploaded += 1;
    } catch (e) {
      failed += 1;
      next.push(shot);
    }
  }
  if (uploaded || failed) {
    console.log(`[shots ${runId}] ${uploaded} kép a helyi pufferbe, ${failed} maradt a riportban`);
  }
  return { ...result, screenshots: next, screenshots_storage: uploaded ? "hetzner" : "inline" };
}

function compactResultForRetry(result) {
  if (!result || typeof result !== "object") return result ?? null;
  const out = { ...result };
  if (Array.isArray(out.screenshots)) {
    out.screenshots_count = out.screenshots.length;
    out.screenshots_stripped_for_retry = true;
    out.screenshots = out.screenshots.map((shot) => {
      if (!shot || typeof shot !== "object") return shot;
      const { b64, ...rest } = shot;
      return { ...rest, b64_omitted: Boolean(b64) };
    });
  }
  if (typeof out.cookies_export === "string") {
    out.cookies_export_omitted_for_retry = true;
    delete out.cookies_export;
  }
  return out;
}

function compactCompletePayload(payload) {
  return {
    ...payload,
    logs: Array.isArray(payload.logs) ? payload.logs.slice(-250) : [],
    result: compactResultForRetry(payload.result),
  };
}

async function postCompleteOnce(payload, label, attempt) {
  const sizeKb = Math.round(payloadBytes(payload) / 1024);
  try {
    const res = await brainFetch("/api/public/worker/complete", payload, { timeoutMs: 120000 });
    if (res.ok) return true;
    const text = await res.text().catch(() => "");
    console.error(`[complete] ${label} attempt ${attempt} → ${res.status} (${sizeKb} KB) ${text.slice(0, 300)}`);
    return false;
  } catch (e) {
    console.error(`[complete] ${label} attempt ${attempt} network error (${sizeKb} KB): ${e.message}`);
    return false;
  }
}

async function reportComplete(payload) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await postCompleteOnce(payload, "full", attempt)) return;
    await wait(1500 * attempt);
  }

  const compact = compactCompletePayload(payload);
  console.warn(
    `[complete] full payload sikertelen, kompakt lezáró riporttal próbálkozom (${Math.round(payloadBytes(payload) / 1024)} KB → ${Math.round(payloadBytes(compact) / 1024)} KB)`,
  );
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (await postCompleteOnce(compact, "compact", attempt)) return;
    await wait(2000 * attempt);
  }
  console.error("[complete] végleg nem sikerült elküldeni a futás lezárását");
}

function dockerCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
      reject(new Error(`docker ${args[0]} hiba: ${detail}`));
    });
  });
}

function runContainer(job) {
  return new Promise(async (resolve) => {
    let containerId = null;
    const jobDir = join(JOB_MOUNT_DIR, String(job.id));
    const cleanup = async () => {
      if (containerId) {
        try { await dockerCommand(["rm", "-f", containerId]); } catch {}
      }
      try { rmSync(jobDir, { recursive: true, force: true }); } catch {}
    };

    try {
      // Per-run könyvtár az orchestrator konténer saját /tmp-jében. Nem kell
      // host mount: a docker cp a Docker API-n keresztül másolja be a fájlokat.
      mkdirSync(jobDir, { recursive: true });
      writeFileSync(join(jobDir, "spec.json"), JSON.stringify(job.spec ?? {}));
      if (job.credentials) {
        writeFileSync(join(jobDir, "credentials.json"), JSON.stringify(job.credentials));
      }
      if (job.proxy) {
        writeFileSync(join(jobDir, "proxy.json"), JSON.stringify(job.proxy));
      }

      const createArgs = [
      "create",
      "--network", "bridge",
      "-e", `SPEC_FILE=/job/spec.json`,
      "-e", `RUN_ID=${job.id}`,
      "-e", `WORKFLOW_ID=${job.workflowId}`,
      "-e", `BRAIN_URL=${BRAIN_URL}`,
      "-e", `WORKER_API_TOKEN=${WORKER_API_TOKEN}`,
      ];
      if (process.env.BRAIN_KYLO_TEST_BYPASS_TOKEN) {
        createArgs.push("-e", `BRAIN_KYLO_TEST_BYPASS_TOKEN=${process.env.BRAIN_KYLO_TEST_BYPASS_TOKEN}`);
      }

      if (job.credentials) createArgs.push("-e", `CREDENTIALS_FILE=/job/credentials.json`);
      if (job.proxy) createArgs.push("-e", `PROXY_FILE=/job/proxy.json`);
      createArgs.push(IMAGE);

      const created = await dockerCommand(createArgs);
      containerId = created.stdout.trim();
      if (!containerId) throw new Error("docker create nem adott konténer ID-t");
      await dockerCommand(["cp", `${jobDir}/.`, `${containerId}:/job`]);
    } catch (err) {
      await cleanup();
      resolve({
        status: "failed",
        logs: [],
        result: null,
        error: err.message,
        preflight: null,
      });
      return;
    }

    const proc = spawn("docker", ["start", "-a", containerId], { stdio: ["ignore", "pipe", "pipe"] });

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
    // Ha épp nincs új log (pl. hosszú oldalbetöltés vagy emberi dwell), akkor is
    // küldünk ritka életjelet, különben a 15 perces watchdog tévesen megöli a runt.
    let lastProgressAt = 0;
    // Ha 20 percen át egyetlen új naplósor sem jön, a futás némán beragadt
    // (pl. Playwright hívás, ami sosem tér vissza) — ilyenkor megöljük.
    let lastLineAt = Date.now();
    let stalled = false;
    const STALL_MS = 20 * 60 * 1000;
    const flushTimer = setInterval(async () => {
      const now = Date.now();
      if (dirty) lastLineAt = now;
      if (!stalled && now - lastLineAt > STALL_MS) {
        stalled = true;
        logs.push({
          ts: new Date().toISOString(),
          level: "error",
          message: `Beragadt futás: 20 perce nincs új naplósor — a konténert leállítjuk.`,
        });
        dirty = true;
        try { await dockerCommand(["rm", "-f", containerId]); } catch {}
      }
      if (!dirty && now - lastProgressAt < 30000) return;
      dirty = false;
      lastProgressAt = now;
      try {
        await brainFetch("/api/public/worker/progress", {
          runId: job.id,
          logs: logs.slice(-500),
        });
      } catch (e) {
        // csendben — a végén /complete úgyis rögzíti
      }
    }, 2000);


    proc.on("close", async (code) => {
      clearInterval(flushTimer);
      await cleanup();
      const status = finalEntry?.status ?? (code === 0 ? "succeeded" : "failed");
      resolve({
        status,
        logs,
        result: finalEntry?.result ?? null,
        error: finalEntry?.error ?? (code !== 0 ? `exit ${code}` : null),
        preflight,
      });
    });
    proc.on("error", async (err) => {
      clearInterval(flushTimer);
      await cleanup();
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
    const resultForReport = await offloadScreenshots(job.id, out.result);
    await reportComplete({
      runId: job.id,
      status: out.status,
      logs: out.logs,
      result: resultForReport,
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
    `[${WORKER_ID}] orchestrator → ${BRAIN_URL} | felső korlát ${HARD_MAX} párhuzamos (dinamikus fékkel)`,
  );
  console.log(
    `[${WORKER_ID}] workflow poll aktív: ${POLL_INTERVAL_MS}ms-onként nézem a /api/public/worker/claim végpontot`,
  );

  installCrashGuards();

  let effectiveLimit = HARD_MAX;
  const health = createHealth({
    port: Number(process.env.HEALTH_PORT || 9090),
    label: `orchestrator ${WORKER_ID}`,
    getInflight: () => inflight.size,
    getLimit: () => effectiveLimit,
  });

  installGracefulShutdown({
    state: health.state,
    getInflight: () => inflight.size,
  });

  startHeartbeat({
    brainFetch,
    workerId: WORKER_ID,
    getInflight: () => inflight.size,
    intervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS || 60000),
  });

  let lastThrottleLogAt = 0;
  while (true) {
    try {
      health.tick();
      const cap = currentLimit(inflight.size);
      effectiveLimit = cap.limit;

      if (health.state.draining) {
        // Leállás alatt nem veszünk fel újat, de a futókat kivárjuk.
      } else if (inflight.size < cap.limit) {
        processOne().catch((e) => console.error("processOne", e));
      } else if (cap.reasons.length && Date.now() - lastThrottleLogAt > 60000) {
        lastThrottleLogAt = Date.now();
        console.warn(
          `[fék] ${inflight.size} futás fut, új munkát most nem veszek fel — ${cap.reasons.join(", ")}`,
        );
      }
    } catch (e) {
      console.error("[loop] hiba, folytatom:", e?.message || e);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop().catch((e) => {
  console.error("[orchestrator] fatal", e?.stack || e?.message || e);
  process.exit(1);
});

