// worker/executor/scripts/brain-tasks/stt-calibrate.js
//
// Kylo.study STT kalibrálás — teljesen helyben, a VPS-en.
// A /stt-corpus/<nyelv>/ hang+szöveg párjain lefuttatja a Whispert,
// összeveti a referencia-szöveggel, és CSAK az apró eredményt adja vissza
// (pontosság %, mintaszám, dátum). Mérés után a fájlokat törli.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.STT_PYTHON || "/opt/whisper/bin/python";

export async function runSttCalibrate({ brainTask, log }) {
  const p = brainTask.payload || {};
  const lang = String(p.language || "").slice(0, 2).toLowerCase();
  if (["he", "iw", "uk"].includes(lang)) {
    return { ok: false, language: lang, error: "kizárt nyelv (héber/ukrán)" };
  }
  if (p.engine && p.engine !== "whisper") {
    return { ok: false, language: lang, error: "a VPS-en csak a Whisper motor fut helyben" };
  }
  const cfg = {
    language: lang,
    model: p.model || "small",
    max_samples: Number(p.max_samples) > 0 ? Number(p.max_samples) : 300,
    delete_after: p.delete_after !== false,
    corpus_root: process.env.STT_CORPUS_ROOT || "/stt-corpus",
  };
  log("info", `Kalibrálás indul: ${lang}, modell ${cfg.model}`);

  const res = await new Promise((resolve) => {
    const proc = spawn(PY, [path.join(HERE, "stt-calibrate.py"), JSON.stringify(cfg)]);
    let out = "", err = "";
    const t = setTimeout(() => proc.kill("SIGKILL"), 6 * 60 * 60 * 1000);
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { if (err.length < 8000) err += d.toString(); });
    proc.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    proc.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
  });

  const last = res.out.trim().split("\n").pop() || "";
  try {
    const parsed = JSON.parse(last);
    log(parsed.ok ? "info" : "warn", `Eredmény: ${last}`);
    return parsed;
  } catch {
    return { ok: false, language: lang, error: `kalibráló hiba (kód ${res.code}): ${res.err.slice(-1500)}` };
  }
}
