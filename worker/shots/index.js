// worker/shots/index.js
//
// Egyszerű képpuffer a Hetzner vason. A futások képernyőképeit NEM a Lovable
// Cloud adatbázisába írjuk (ott a lemez IO drága), hanem ide, a saját SSD-re.
// Az adatbázisba csak a kép URL-je kerül.
//
//   POST /upload   { runId, label, at, b64, ext? }  → { url, path }
//   GET  /s/<run>/<file>                            → maga a kép
//   GET  /health                                    → { ok, files, bytes }
//
// Feltöltéshez WORKER_API_TOKEN kell (Bearer vagy x-worker-token).
// Az olvasás token nélkül megy (a fájlnév véletlen, a link kitalálhatatlan),
// hogy a Brain felületén simán megjelenhessen a kép.
//
// Takarítás: RETENTION_DAYS napnál (alapértelmezés 14) régebbi könyvtárakat
// óránként törli.

import { createServer } from "node:http";
import {
  mkdirSync,
  writeFileSync,
  createReadStream,
  existsSync,
  statSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, normalize } from "node:path";
import { randomBytes } from "node:crypto";

const DATA_DIR = process.env.SHOTS_DATA_DIR || "/data";
const PORT = Number(process.env.PORT || 8080);
const TOKEN = (process.env.WORKER_API_TOKEN || "").trim();
const PUBLIC_URL = (process.env.SHOTS_PUBLIC_URL || "").replace(/\/$/, "");
const RETENTION_DAYS = Number(process.env.SHOTS_RETENTION_DAYS || 14);
const MAX_BODY_BYTES = Number(process.env.SHOTS_MAX_BODY_BYTES || 25 * 1024 * 1024);

mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req) {
  if (!TOKEN) return false;
  const header = req.headers.authorization || "";
  const provided = header.startsWith("Bearer ")
    ? header.slice(7)
    : req.headers["x-worker-token"] || "";
  return String(provided).trim() === TOKEN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const SAFE = /^[A-Za-z0-9._-]+$/;

function dirSize(dir) {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = dirSize(p);
      bytes += sub.bytes;
      files += sub.files;
    } else {
      try {
        bytes += statSync(p).size;
        files += 1;
      } catch {}
    }
  }
  return { bytes, files };
}

function sweep() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = join(DATA_DIR, entry.name);
    try {
      if (statSync(p).mtimeMs < cutoff) {
        rmSync(p, { recursive: true, force: true });
        removed += 1;
      }
    } catch {}
  }
  if (removed > 0) {
    console.log(`[shots] takarítás: ${removed} régi futás könyvtára törölve (>${RETENTION_DAYS} nap)`);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    const { bytes, files } = dirSize(DATA_DIR);
    json(res, 200, { ok: true, files, bytes, retention_days: RETENTION_DAYS });
    return;
  }

  if (req.method === "POST" && url.pathname === "/upload") {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });
    let body;
    try {
      body = JSON.parse((await readBody(req)).toString("utf8"));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
    const runId = String(body.runId || "").trim();
    if (!SAFE.test(runId)) return json(res, 400, { error: "bad runId" });
    const b64 = typeof body.b64 === "string" ? body.b64 : "";
    if (!b64) return json(res, 400, { error: "missing b64" });
    const ext = MIME[String(body.ext || "jpg").toLowerCase()] ? String(body.ext).toLowerCase() : "jpg";

    const dir = join(DATA_DIR, runId);
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
    try {
      writeFileSync(join(dir, name), Buffer.from(b64, "base64"));
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
    const path = `/s/${runId}/${name}`;
    json(res, 200, { url: PUBLIC_URL ? `${PUBLIC_URL}${path}` : path, path });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/s/")) {
    const parts = normalize(url.pathname).split("/").filter(Boolean); // s, run, file
    if (parts.length !== 3 || !SAFE.test(parts[1]) || !SAFE.test(parts[2])) {
      return json(res, 400, { error: "bad path" });
    }
    const file = join(DATA_DIR, parts[1], parts[2]);
    if (!existsSync(file)) return json(res, 404, { error: "not found" });
    const ext = parts[2].split(".").pop()?.toLowerCase() || "jpg";
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
    });
    createReadStream(file).pipe(res);
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[shots] fut a ${PORT} porton | tárhely: ${DATA_DIR} | megőrzés: ${RETENTION_DAYS} nap`);
  sweep();
  setInterval(sweep, 60 * 60 * 1000);
});
