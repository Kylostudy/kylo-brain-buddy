// worker/orchestrator/index.js
// Saját VPS-en futó folyamat. Pollozza a Supabase workflow_runs táblát,
// minden 'queued' sorhoz indít egy Docker konténert az executor image-ből,
// és visszaírja a logokat + végállapotot.
//
// Indítás: node index.js (lásd worker/README.md)

import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { decryptString } from "./crypto.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_ID = process.env.WORKER_ID || "worker-1";
const POLL_INTERVAL_MS = 3000;
const IMAGE = process.env.EXECUTOR_IMAGE || "kylo-executor:latest";
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 4);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL és SUPABASE_SERVICE_ROLE_KEY kötelező.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const inflight = new Set();

async function pickNextRun() {
  // Naiv claim: 1 sor lekérése, státusz frissítése running-ra.
  // Production: cseréld le `select ... for update skip locked` RPC-re.
  const { data } = await supabase
    .from("workflow_runs")
    .select("id, workflow_id, spec_snapshot, runner")
    .eq("runner", "docker")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  const { error } = await supabase
    .from("workflow_runs")
    .update({
      status: "running",
      external_id: `${WORKER_ID}:${row.id}`,
      started_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "queued");
  if (error) return null;

  return row;
}

async function loadCredentials(workflowId) {
  const { data } = await supabase
    .from("workflow_credentials")
    .select(
      "platform, username, password_ciphertext, password_nonce, cookie_ciphertext, cookie_nonce, totp_secret_ciphertext, totp_nonce",
    )
    .eq("workflow_id", workflowId)
    .maybeSingle();
  if (!data) return null;
  try {
    return {
      platform: data.platform,
      username: data.username || null,
      password: decryptString(data.password_ciphertext, data.password_nonce),
      cookies: decryptString(data.cookie_ciphertext, data.cookie_nonce),
      totpSecret: decryptString(
        data.totp_secret_ciphertext,
        data.totp_nonce,
      ),
    };
  } catch (e) {
    console.error("Credential decrypt hiba:", e.message);
    return null;
  }
}

function runContainer(row, creds) {
  return new Promise((resolve) => {
    const args = [
      "run", "--rm",
      "--network", "bridge",
      "-e", `SPEC_JSON=${JSON.stringify(row.spec_snapshot ?? {})}`,
    ];
    if (creds) {
      args.push("-e", `CREDENTIALS_JSON=${JSON.stringify(creds)}`);
    }
    args.push(IMAGE);
    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });

    const logs = [];
    let finalEntry = null;

    const onLine = (line) => {
      const s = line.trim();
      if (!s) return;
      try {
        const obj = JSON.parse(s);
        if (obj.final) {
          finalEntry = obj;
        } else {
          logs.push({ ts: obj.ts, level: obj.level || "info", message: obj.message });
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
      logs.push({ ts: new Date().toISOString(), level: "error", message: chunk.toString().trim() });
    });

    proc.on("close", (code) => {
      const status = finalEntry?.status ?? (code === 0 ? "succeeded" : "failed");
      resolve({
        status,
        logs,
        result: finalEntry?.result ?? null,
        error: finalEntry?.error ?? (code !== 0 ? `exit ${code}` : null),
      });
    });
  });
}

async function processOne() {
  const row = await pickNextRun();
  if (!row) return;
  inflight.add(row.id);
  try {
    const creds = await loadCredentials(row.workflow_id);
    const out = await runContainer(row, creds);
    await supabase
      .from("workflow_runs")
      .update({
        status: out.status,
        logs: out.logs,
        result: out.result,
        error: out.error,
        finished_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  } catch (e) {
    await supabase
      .from("workflow_runs")
      .update({
        status: "failed",
        error: e.message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  } finally {
    inflight.delete(row.id);
  }
}

async function loop() {
  while (true) {
    if (inflight.size < MAX_PARALLEL) {
      processOne().catch(console.error);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

console.log(`[${WORKER_ID}] orchestrator indul, max ${MAX_PARALLEL} párhuzamos futás`);
loop();
