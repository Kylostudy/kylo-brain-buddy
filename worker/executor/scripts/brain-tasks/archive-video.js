// worker/executor/scripts/brain-tasks/archive-video.js
//
// archive_video — a Kylogicban elkészült videó végleges archiválása a VPS
// lemezére. Nem social taszk: nincs böngésző, nincs cookie, nincs proxy.
//
// Menet: HTTP GET (streamelve) → <base>/<target_path>.part → ellenőrzés
// (méret > 0 + MP4 aláírás) → kizárólagos véglegesítés (soha nem ír felül).
// Végleges archív fájlt soha nem törlünk.

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { digestFile, finalizeExclusive } from "./receive-subject-factory-package.js";

const ARCHIVE_ROOT = process.env.ARCHIVE_ROOT || "/archive";
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const TIMEOUT_MS = 5 * 60 * 1000; // 5 perc

/** Relatív, kilépés nélküli útvonal — a payload már tisztított, itt is védünk. */
function safeRelPath(raw) {
  const parts = String(raw || "")
    .trim()
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || p.includes("\0") || p.includes("\\"))) throw new Error("target_path érvénytelen");
  if (!parts.length) throw new Error("target_path érvénytelen");
  return parts.join("/");
}

/** MP4 aláírás: a 4. bájttól "ftyp" doboz. */
async function looksLikeMp4(file) {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, 12, 0);
    if (bytesRead < 12) return false;
    return buf.slice(4, 8).toString("latin1") === "ftyp";
  } finally {
    await fh.close();
  }
}

export async function runArchiveVideo({ brainTask, log }) {
  const payload = brainTask.payload || {};
  const sourceUrl = payload.source_url;
  const refId = payload.ref_id || null;

  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    throw new Error("source_url hiányzik vagy nem http(s)");
  }

  const rel = safeRelPath(payload.target_path);
  const finalPath = path.join(ARCHIVE_ROOT, rel);
  const partPath = `${finalPath}.${randomUUID()}.part`;

  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  if (await fs.realpath(path.dirname(finalPath)) !== path.resolve(path.dirname(finalPath))) throw new Error("archív szimbolikus útvonal tiltva");

  log("info", `Archiválás indul: ${rel}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let bytes = 0;
  try {
    const res = await fetch(sourceUrl, { signal: controller.signal, redirect: "follow" });
    if (!res.ok || !res.body) {
      throw new Error(`letöltés HTTP ${res.status}`);
    }

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) {
      throw new Error(`a fájl túl nagy (${declared} bájt, limit 2 GB)`);
    }

    const out = createWriteStream(partPath, { flags: "wx" });
    const source = Readable.fromWeb(res.body);
    source.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        source.destroy(new Error("a fájl túllépte a 2 GB limitet"));
      }
    });

    await pipeline(source, out);
  } catch (err) {
    await fs.rm(partPath, { force: true }).catch(() => {});
    const msg =
      err?.name === "AbortError"
        ? "letöltési időtúllépés (5 perc)"
        : err?.message || String(err);
    throw new Error(msg);
  } finally {
    clearTimeout(timer);
  }

  const stat = await fs.stat(partPath).catch(() => null);
  if (!stat || stat.size === 0) {
    await fs.rm(partPath, { force: true }).catch(() => {});
    throw new Error("a letöltött fájl üres");
  }
  if (!(await looksLikeMp4(partPath))) {
    await fs.rm(partPath, { force: true }).catch(() => {});
    throw new Error("a letöltött fájl nem MP4 (hiányzó ftyp aláírás)");
  }

  // Same bytes may be adopted; different bytes block, never overwrite.
  const expected = await digestFile(partPath);
  try { await finalizeExclusive(partPath, finalPath, expected); }
  finally { await fs.rm(partPath, { force: true }); }

  log("info", `Archiválva: ${finalPath} (${stat.size} bájt)`);

  return {
    ref_id: refId,
    status: "done",
    archive_path: finalPath,
    bytes: stat.size,
    sha256: expected.sha256,
    kind: payload.kind || "poster_video",
    target_path: rel,
    archived_at: new Date().toISOString(),
  };
}
