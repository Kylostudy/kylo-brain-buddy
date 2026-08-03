// worker/executor/scripts/brain-tasks/stt-media-fetch.js
//
// Kylo.study STT kalibrációs labor: hivatalos vizsgahang + szó szerinti átirat
// beszerzése. Nem social taszk — nincs cookie, nincs proxy, nincs emberi
// viselkedés. A VPS saját IP-jéről tölt.
//
// Hang:      közvetlen fájl → yt-dlp → Playwright hálózati elkapás,
//            majd ffmpeg -ac 1 -ar 16000 → MP3.
// Átirat:    HTML → szövegkinyerés; PDF → pdftotext szövegréteg,
//            ha üres → pdftoppm + tesseract OCR (nyelv a payload szerint).
// Visszaadás: aláírt PUT URL-re feltöltés, ha a payload adott ilyet.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_MAX_BYTES = 120 * 1024 * 1024; // 120 MB — bőven a 30–60 MB fölött

const OCR_LANG = {
  hu: "hun", en: "eng", de: "deu", fr: "fra", es: "spa", it: "ita",
  pl: "pol", pt: "por", nl: "nld", ro: "ron", sk: "slk", cs: "ces",
  hr: "hrv", sl: "slv", sr: "srp", sv: "swe", da: "dan", fi: "fin",
  tr: "tur", ru: "rus", el: "ell", ar: "ara", ja: "jpn", ko: "kor",
  zh: "chi_sim", hi: "hin",
};

function run(cmd, args, { timeoutMs = 10 * 60 * 1000, cwd } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd });
    let out = "", err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => { if (out.length < 200000) out += d.toString(); });
    p.stderr.on("data", (d) => { if (err.length < 20000) err += d.toString(); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function downloadTo(url, dest, maxBytes, log) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} a letöltésnél`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len > maxBytes) throw new Error(`túl nagy fájl (${Math.round(len / 1048576)} MB)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`túl nagy fájl (${Math.round(buf.length / 1048576)} MB)`);
  await fs.writeFile(dest, buf);
  log?.("info", `Letöltve: ${url.slice(0, 120)} → ${Math.round(buf.length / 1024)} KB`);
  return { bytes: buf.length, contentType: res.headers.get("content-type") || "" };
}

async function probeDuration(file) {
  const r = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ], { timeoutMs: 60000 });
  const v = parseFloat((r.out || "").trim());
  return Number.isFinite(v) ? Math.round(v) : null;
}

async function toMono16kMp3(input, output) {
  const r = await run("ffmpeg", [
    "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000",
    "-codec:a", "libmp3lame", "-q:a", "4", output,
  ]);
  if (r.code !== 0 || !(await exists(output))) {
    throw new Error(`ffmpeg konverzió sikertelen: ${(r.err || "").slice(-300)}`);
  }
}

/** Playwright hálózati elkapás: megnyitja a page_url-t és lementi az első
 *  érdemi hang-választ (audio/*, .m4a, .mp3, .mpd, .m3u8). */
async function captureAudioViaBrowser(pageUrl, dir, maxBytes, log) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let hit = null;
    page.on("response", (res) => {
      if (hit) return;
      const url = res.url();
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (ct.startsWith("audio/") || /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(url) ||
          /\.(m3u8|mpd)(\?|$)/i.test(url)) {
        hit = url;
      }
    });
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Próbáljuk elindítani a beépített lejátszót.
    await page.evaluate(() => {
      document.querySelectorAll("audio,video").forEach((el) => { try { el.play(); } catch { /* noop */ } });
    }).catch(() => {});
    for (let i = 0; i < 30 && !hit; i++) await page.waitForTimeout(1000);
    if (!hit) throw new Error("a böngésző nem talált hang-hálózati kérést az oldalon");
    log?.("info", `Böngészőből elkapott hangforrás: ${hit.slice(0, 140)}`);

    const raw = path.join(dir, "captured.bin");
    if (/\.(m3u8|mpd)(\?|$)/i.test(hit)) {
      // Stream → ffmpeg tudja közvetlenül.
      const r = await run("ffmpeg", ["-y", "-i", hit, "-vn", "-ac", "1", "-ar", "16000", path.join(dir, "audio.mp3")]);
      if (r.code !== 0) throw new Error(`stream letöltés sikertelen: ${(r.err || "").slice(-300)}`);
      return { file: path.join(dir, "audio.mp3"), method: "playwright-stream", alreadyConverted: true };
    }
    await downloadTo(hit, raw, maxBytes, log);
    return { file: raw, method: "playwright-capture", alreadyConverted: false };
  } finally {
    await browser.close().catch(() => {});
  }
}

function pageUrlOf(payload) {
  return payload.page_url || payload.source_page || payload.url || null;
}

function isStreamingSite(url) {
  return /(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|soundcloud\.com)/i.test(url || "");
}

async function fetchAudio(payload, dir, maxBytes, log) {
  const candidate = payload.audio_url || null;
  const pageUrl = pageUrlOf(payload);
  let lastError = "";
  const streaming = isStreamingSite(candidate) || isStreamingSite(pageUrl);

  // 1) Közvetlen fájl (streaming oldalnál értelmetlen — ott egyből yt-dlp)
  if (candidate && !streaming) {
    try {
      const raw = path.join(dir, "source.bin");
      const meta = await downloadTo(candidate, raw, maxBytes, log);
      const looksAudio = /^(audio|video)\//.test(meta.contentType) ||
        /\.(mp3|m4a|aac|ogg|wav|mp4|webm)(\?|$)/i.test(candidate);
      if (looksAudio) return { file: raw, method: "direct", alreadyConverted: false };
      log("warn", `A megadott audio_url nem hangfájl (${meta.contentType}) — yt-dlp következik`);
    } catch (e) {
      lastError = e.message;
      log("warn", `Közvetlen letöltés nem ment: ${e.message}`);
    }
  }

  // 2) yt-dlp
  const targets = [...new Set([candidate, pageUrl].filter(Boolean))];
  for (const target of targets) {
    const out = path.join(dir, "ytdlp.%(ext)s");
    const args = [
      "-f", "bestaudio/best",
      "--no-playlist",
      "--no-warnings",
      "--retries", "5",
      "--extractor-args", "youtube:player_client=android,web",
      "-o", out,
      target,
    ];
    const r = await run("yt-dlp", args, { timeoutMs: 15 * 60 * 1000 });
    if (r.code === 0) {
      const files = (await fs.readdir(dir)).filter((f) => f.startsWith("ytdlp."));
      if (files[0]) {
        log("info", `yt-dlp sikeres: ${files[0]}`);
        return { file: path.join(dir, files[0]), method: "yt-dlp", alreadyConverted: false };
      }
    }
    lastError = (r.err || "").trim().slice(-300) || `yt-dlp kilépési kód ${r.code}`;
    log("warn", `yt-dlp nem járt sikerrel (${target.slice(0, 100)}): ${lastError}`);
  }

  // 3) Playwright hálózati elkapás — streaming oldalnál TILOS,
  //    mert csak pár másodperces DASH-szeletet kapnánk el.
  if (pageUrl && !streaming) {
    return await captureAudioViaBrowser(pageUrl, dir, maxBytes, log);
  }
  throw new Error(
    lastError
      ? `nem sikerült hangot szerezni: ${lastError}`
      : "nincs használható hangforrás (audio_url / page_url / source_page)",
  );
}



function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchTranscript(payload, dir, maxBytes, log) {
  const url = payload.transcript_url || pageUrlOf(payload);
  if (!url) throw new Error("nincs transcript_url és page_url/source_page sem");


  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} az átirat letöltésénél`);
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("túl nagy átirat fájl");

  const isPdf = ct.includes("pdf") || buf.subarray(0, 4).toString() === "%PDF";
  if (!isPdf) {
    const text = htmlToText(buf.toString("utf8"));
    if (!text) throw new Error("az oldalról nem sikerült szöveget kinyerni");
    return { text, method: "html" };
  }

  const pdf = path.join(dir, "transcript.pdf");
  await fs.writeFile(pdf, buf);

  // PDF szövegréteg
  const txt = path.join(dir, "transcript.txt");
  const r = await run("pdftotext", ["-layout", pdf, txt], { timeoutMs: 5 * 60 * 1000 });
  if (r.code === 0 && (await exists(txt))) {
    const text = (await fs.readFile(txt, "utf8")).trim();
    if (text.length > 200) return { text, method: "pdf-text", pdfPath: pdf };
    log("info", "A PDF-ben nincs érdemi szövegréteg — OCR következik");
  }

  // OCR
  const lang = OCR_LANG[(payload.language || "").slice(0, 2).toLowerCase()] || "eng";
  const pr = await run("pdftoppm", ["-r", "200", "-png", pdf, path.join(dir, "page")], { timeoutMs: 10 * 60 * 1000 });
  if (pr.code !== 0) {
    return { text: "", method: "pdf-raw", pdfPath: pdf, note: "OCR nem futott, nyers PDF visszaadva" };
  }
  const pages = (await fs.readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
  let text = "";
  for (const pg of pages.slice(0, 60)) {
    const base = path.join(dir, `${pg}.ocr`);
    const or = await run("tesseract", [path.join(dir, pg), base, "-l", lang], { timeoutMs: 5 * 60 * 1000 });
    if (or.code === 0 && (await exists(`${base}.txt`))) {
      text += (await fs.readFile(`${base}.txt`, "utf8")) + "\n";
    }
  }
  text = text.trim();
  if (!text) return { text: "", method: "pdf-raw", pdfPath: pdf, note: "OCR üres, nyers PDF visszaadva" };
  return { text, method: "pdf-ocr", pdfPath: pdf };
}

async function putToSignedUrl(url, file, contentType, log) {
  const body = await fs.readFile(file);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType, "x-upsert": "true" },
    body,
  });
  if (!res.ok) {
    throw new Error(`feltöltés sikertelen: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  log("info", `Feltöltve (${Math.round(body.length / 1024)} KB)`);
  return url.split("?")[0];
}

export async function runSttMediaFetch({ brainTask, log }) {
  const payload = brainTask.payload || {};
  const want = Array.isArray(payload.want) ? payload.want : ["audio", "transcript"];
  const maxBytes = Number(payload.max_bytes) > 0 ? Number(payload.max_bytes) : DEFAULT_MAX_BYTES;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stt-"));

  const out = {
    source_id: payload.source_id,
    audio: null,
    transcript: null,
    notes: "",
  };
  const notes = [];

  try {
    if (want.includes("audio")) {
      try {
        const got = await fetchAudio(payload, dir, maxBytes, log);
        const mp3 = got.alreadyConverted ? got.file : path.join(dir, "audio.mp3");
        if (!got.alreadyConverted) await toMono16kMp3(got.file, mp3);
        const duration = await probeDuration(mp3);
        const size = (await fs.stat(mp3)).size;

        let url = null;
        if (payload.audio_upload_url) {
          url = await putToSignedUrl(payload.audio_upload_url, mp3, "audio/mpeg", log);
        } else {
          notes.push("audio_upload_url hiányzott — a hang a workeren maradt, adj aláírt PUT URL-t");
        }
        out.audio = {
          ok: !!url,
          url,
          duration_sec: duration,
          bytes: size,
          format: "mp3/16kHz/mono",
          method: got.method,
          ...(url ? {} : { error: "nincs feltöltési cél (audio_upload_url)" }),
        };
      } catch (e) {
        log("warn", `Hang hiba: ${e.message}`);
        out.audio = { ok: false, error: e.message };
      }
    }

    if (want.includes("transcript")) {
      try {
        const t = await fetchTranscript(payload, dir, maxBytes, log);
        let url = null;
        if (payload.transcript_upload_url) {
          const file = t.text
            ? path.join(dir, "transcript-final.txt")
            : t.pdfPath;
          if (t.text) await fs.writeFile(file, t.text, "utf8");
          url = await putToSignedUrl(
            payload.transcript_upload_url,
            file,
            t.text ? "text/plain; charset=utf-8" : "application/pdf",
            log,
          );
        }
        if (t.note) notes.push(t.note);
        out.transcript = {
          ok: !!(t.text || url),
          text: t.text ? t.text.slice(0, 400000) : null,
          url,
          method: t.method,
          chars: t.text ? t.text.length : 0,
          ...(t.text || url ? {} : { error: "nem sikerült szöveget kinyerni" }),
        };
      } catch (e) {
        log("warn", `Átirat hiba: ${e.message}`);
        out.transcript = { ok: false, error: e.message };
      }
    }

    out.notes = notes.join(" | ");
    return out;
  } finally {
    // Feltöltés után nem tartjuk meg a nyers fájlokat.
    if (payload.audio_upload_url && payload.transcript_upload_url) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
