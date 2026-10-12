// worker/executor/scripts/brain-tasks/membership-transcribe.js
//
// membership_transcribe — a membership_archive által letöltött MP3-ak és
// videók helyi leiratozása a VPS-en (faster-whisper), majd Kylomind-barát
// tagolás (fejezetcímek) a Brain AI-jával. Hang/videó soha nem hagyja el a
// VPS-t; csak a szöveg-darabok mennek a tagoláshoz.
//
// Kimenet: /membership/<slug>/kylomind/<lecke>.md + index.md (tartalomjegyzék)
// payload: { slug, language?: "hu", model?: "medium", max_items?: 3 }

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brainFetch } from "./brain-api.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.STT_PYTHON || "/opt/whisper/bin/python";
const ROOT = process.env.MEMBERSHIP_ROOT || "/membership";
const CHUNK = 12000;

function chunks(text) {
  const paras = text.split(/\n\n+/);
  const out = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > CHUNK) { out.push(cur); cur = ""; }
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur) out.push(cur);
  return out;
}

async function structure(text, title, log) {
  const parts = chunks(text);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    try {
      const r = await brainFetch("/api/public/worker/structure-transcript", {
        body: { text: parts[i], title, part: i + 1, parts: parts.length },
        timeoutMs: 180000,
      });
      out.push(r.markdown);
    } catch (e) {
      // 402/403/429: ne erőltessük — a nyers szöveg marad, a következő futás pótolja.
      if (/→ (402|403|429)/.test(e.message)) throw Object.assign(e, { pause: true });
      log("warn", `Tagolás hiba (${i + 1}/${parts.length}): ${e.message}`);
      return null;
    }
  }
  return out.join("\n\n");
}

export async function runMembershipTranscribe({ brainTask, log }) {
  const p = brainTask.payload || brainTask;
  const slug = String(p.slug || "").replace(/[^a-z0-9-]/gi, "");
  if (!slug) throw new Error("slug hiányzik");
  const root = path.join(ROOT, slug);
  const mf = path.join(root, "manifest.json");
  await fs.access(mf).catch(() => { throw new Error(`nincs archívum: ${slug} — előbb a letöltő fusson`); });

  // 1) helyi leirat
  const cfg = { root, language: p.language || "hu", model: p.model || "medium", max_items: Number(p.max_items) > 0 ? Number(p.max_items) : 3 };
  const res = await new Promise((resolve) => {
    const proc = spawn(PY, [path.join(HERE, "membership-transcribe.py"), JSON.stringify(cfg)]);
    let out = "", err = "";
    const t = setTimeout(() => proc.kill("SIGKILL"), 6 * 60 * 60 * 1000);
    proc.stdout.on("data", (d) => { out += d.toString(); for (const l of d.toString().split("\n")) if (l.includes('"event"')) log("info", l.trim()); });
    proc.stderr.on("data", (d) => { if (err.length < 8000) err += d.toString(); });
    proc.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
    proc.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
  });
  let summary;
  try {
    summary = JSON.parse(res.out.trim().split("\n").pop());
  } catch {
    throw new Error(`leiratkészítő hiba (kód ${res.code}): ${res.err.slice(-1500)}`);
  }

  // 2) tagolás + Kylomind-kimenet
  const m = JSON.parse(await fs.readFile(mf, "utf8"));
  const kdir = path.join(root, "kylomind");
  await fs.mkdir(kdir, { recursive: true });
  let structured = 0, paused = null;
  for (const item of Object.values(m.media)) {
    if (!item.raw_transcript || item.kylomind_file || paused) continue;
    const raw = await fs.readFile(path.join(root, item.raw_transcript), "utf8");
    const base = path.basename(item.raw_transcript, ".txt");
    let body;
    try {
      body = await structure(raw, item.page_title, log);
    } catch (e) {
      paused = e.message;
      break;
    }
    const head =
      `# ${item.page_title}\n\n` +
      `> Forrás: ${item.page_url}\n> Típus: ${item.kind === "audio" ? "hanganyag" : "videó"} leirata` +
      (item.duration_sec ? ` (${Math.round(item.duration_sec / 60)} perc)` : "") +
      `\n> Leirat készült: ${(item.transcribed_at || "").slice(0, 10)}\n\n`;
    const file = path.join(kdir, `${base}.md`);
    await fs.writeFile(file, head + (body || raw) + "\n");
    item.kylomind_file = path.relative(root, file);
    item.structured = !!body;
    structured++;
    await fs.writeFile(`${mf}.tmp`, JSON.stringify(m, null, 2));
    await fs.rename(`${mf}.tmp`, mf);
  }

  // A szöveges oldalak is bekerülnek a Kylomind-mappába.
  for (const pg of Object.values(m.pages)) {
    if (!pg.text_file) continue;
    await fs.copyFile(path.join(root, pg.text_file), path.join(kdir, `${pg.slug}--oldal.md`)).catch(() => {});
  }
  const files = (await fs.readdir(kdir)).filter((f) => f.endsWith(".md") && f !== "index.md").sort();
  await fs.writeFile(
    path.join(kdir, "index.md"),
    `# ${slug} — tartalomjegyzék\n\n` + files.map((f) => `- [${f.replace(/\.md$/, "")}](${f})`).join("\n") + "\n",
  );

  const media = Object.values(m.media).filter((x) => x.kind !== "document");
  return {
    ok: !paused,
    archive: slug,
    transcribed_this_run: summary.done,
    structured_this_run: structured,
    transcripts_total: media.filter((x) => x.raw_transcript).length,
    kylomind_files: files.length,
    remaining_to_transcribe: summary.remaining,
    paused_reason: paused,
  };
}
