#!/usr/bin/env node
/**
 * Kylo Vault — csak olvasó fájlkiszolgáló a VPS-en.
 *
 * Ezt kizárólag a Brain hívja (Bearer WORKER_API_TOKEN), a látogató soha.
 * Feltöltés, törlés, módosítás nincs — csak listázás és letöltés.
 *
 * Végpontok:
 *   GET /health
 *   GET /list?path=<relatív>            → { kind, name, size, files[] }
 *   GET /file?path=<relatív>            → a fájl tartalma
 *   GET /zip?path=<relatív>&maxBytes=N  → a mappa ZIP-ben (streamelve)
 *
 * Környezet:
 *   VAULT_ROOT        alapértelmezés: /srv/kylo-vault/data
 *   VAULT_FS_PORT     alapértelmezés: 8079
 *   WORKER_API_TOKEN  ugyanaz, mint a workeré
 */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { timingSafeEqual, createHash } = require("node:crypto");

const ROOT = path.resolve(process.env.VAULT_ROOT || "/srv/kylo-vault/data");
const PORT = Number(process.env.VAULT_FS_PORT || 8079);
const TOKEN = (process.env.WORKER_API_TOKEN || "").trim();
const MAX_ENTRIES = 5000;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB / fájl


if (!TOKEN) {
  console.error("WORKER_API_TOKEN hiányzik — a kiszolgáló nem indul el.");
  process.exit(1);
}

function authorized(req) {
  const header = req.headers.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A széf gyökerén kívülre mutató útvonalak elutasítása. */
function safeResolve(relative) {
  const clean = String(relative || "").replace(/^\/+/, "");
  if (clean.split("/").some((s) => s === "..")) return null;
  const abs = path.resolve(ROOT, clean);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

async function walk(dir, base, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (out.length >= MAX_ENTRIES) return;
    if (e.name.startsWith(".")) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(abs, base, out);
    } else if (e.isFile()) {
      const st = await fsp.stat(abs);
      out.push({ path: path.relative(base, abs).split(path.sep).join("/"), size: st.size });
    }
  }
}

function json(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/health") return json(res, { ok: true, root: ROOT });
    if (!authorized(req)) return json(res, { error: "unauthorized" }, 401);

    // ---- Feltöltés (a Brain ügynök-végpontja folyatja át ide a bájtokat) ----
    if (url.pathname === "/upload") {
      if (req.method !== "PUT" && req.method !== "POST") {
        return json(res, { error: "method not allowed" }, 405);
      }
      const target = safeResolve(url.searchParams.get("path"));
      if (!target || target === ROOT) return json(res, { error: "bad path" }, 400);

      const wantHash = String(req.headers["x-vault-hash"] || "").trim().toLowerCase();
      const mtime = Number(req.headers["x-vault-mtime"] || 0);

      await fsp.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.part-${process.pid}-${Date.now()}`;
      const hasher = createHash("sha256");
      let written = 0;

      try {
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(tmp);
          req.on("data", (chunk) => {
            written += chunk.length;
            hasher.update(chunk);
            if (written > MAX_UPLOAD_BYTES) {
              req.destroy();
              out.destroy();
              reject(new Error("too large"));
            }
          });
          req.on("error", reject);
          out.on("error", reject);
          out.on("finish", resolve);
          req.pipe(out);
        });
      } catch (e) {
        await fsp.rm(tmp, { force: true });
        const tooLarge = String(e.message).includes("too large");
        return json(res, { error: e.message }, tooLarge ? 413 : 400);
      }

      const got = hasher.digest("hex");
      if (wantHash && wantHash !== got) {
        await fsp.rm(tmp, { force: true });
        return json(res, { error: "hash mismatch", expected: wantHash, got }, 422);
      }

      await fsp.rename(tmp, target); // atomikus csere
      if (Number.isFinite(mtime) && mtime > 0) {
        const when = new Date(mtime > 1e12 ? mtime : mtime * 1000);
        await fsp.utimes(target, when, when).catch(() => {});
      }
      return json(res, { ok: true, size: written, hash: got });
    }

    if (req.method !== "GET") return json(res, { error: "method not allowed" }, 405);




    const abs = safeResolve(url.searchParams.get("path"));
    if (!abs) return json(res, { error: "bad path" }, 400);

    let st;
    try {
      st = await fsp.stat(abs);
    } catch {
      return json(res, { error: "not found" }, 404);
    }

    if (url.pathname === "/list") {
      if (st.isFile()) {
        return json(res, { kind: "file", name: path.basename(abs), size: st.size, files: [] });
      }
      const files = [];
      await walk(abs, abs, files);
      files.sort((a, b) => a.path.localeCompare(b.path));
      const size = files.reduce((n, f) => n + f.size, 0);
      return json(res, { kind: "dir", name: path.basename(abs), size, files });
    }

    if (url.pathname === "/file") {
      if (!st.isFile()) return json(res, { error: "not a file" }, 400);
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": st.size,
      });
      const stream = fs.createReadStream(abs);
      stream.on("error", () => res.destroy());
      return stream.pipe(res);
    }

    if (url.pathname === "/zip") {
      if (!st.isDirectory()) return json(res, { error: "not a directory" }, 400);
      const maxBytes = Number(url.searchParams.get("maxBytes") || 0);
      if (maxBytes > 0) {
        const files = [];
        await walk(abs, abs, files);
        const total = files.reduce((n, f) => n + f.size, 0);
        if (total > maxBytes) return json(res, { error: "too large", total }, 413);
      }
      res.writeHead(200, { "content-type": "application/zip" });
      // -0 = nincs tömörítés (gyors, streamelhető), -r = rekurzív, - = stdout
      const zip = spawn("zip", ["-r", "-0", "-q", "-", "."], { cwd: abs });
      zip.stdout.pipe(res);
      zip.stderr.on("data", (d) => console.error("zip:", d.toString().slice(0, 500)));
      zip.on("error", () => res.destroy());
      req.on("close", () => zip.kill("SIGKILL"));
      return;
    }

    return json(res, { error: "not found" }, 404);
  } catch (e) {
    console.error("fileserver hiba:", e);
    if (!res.headersSent) json(res, { error: "internal error" }, 500);
    else res.destroy();
  }
});

// 0.0.0.0 = minden interfészen figyel, hogy a Brain (Lovable felhő) is elérje.
// Biztonság: a Bearer token védi, + a VPS tűzfal csak a 8079 portot nyitja ki.
const BIND = process.env.VAULT_FS_BIND || "0.0.0.0";
server.listen(PORT, BIND, () => {
  console.log(`Kylo Vault fájlkiszolgáló fut: ${BIND}:${PORT} (gyökér: ${ROOT})`);
});
