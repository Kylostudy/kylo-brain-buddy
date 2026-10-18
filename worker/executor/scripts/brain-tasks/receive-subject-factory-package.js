import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { validatePackage, PACKAGE_ID, MAX_FILE_BYTES } from "./subject-factory-contract.js";

// Deliberately conservative: disallow special-use IPv4 and all IPv6 here.
export function isPublicAddress(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0);
}
export async function digestFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe_existing_file");
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return { sha256: h.digest("hex"), bytes: stat.size };
}
async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await fs.realpath(dir)) !== path.resolve(dir)) throw new Error("symlink_directory_forbidden");
}
export async function finalizeExclusive(part, target, expected) {
  try { await fs.link(part, target); }
  catch (e) { if (e.code !== "EEXIST") throw e; }
  const actual = await digestFile(target);
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new Error("existing_file_conflict");
  await fs.unlink(part); // only our private transient file, never a final file
  return actual;
}
async function download(f, part) {
  const u = new URL(f.url);
  const addresses = await dns.lookup(u.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new Error("unsafe_dns_address");
  const pinned = addresses[0];
  if (!pinned) throw new Error("dns_empty");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await new Promise((resolve, reject) => {
      const req = https.get(u, {
        agent: false, signal: controller.signal,
        lookup: (_host, _options, callback) => callback(null, pinned.address, 4),
      }, resolve);
      req.on("error", reject);
    });
    if (res.statusCode !== 200) { res.destroy(); throw new Error(`source_http_${res.statusCode}`); }
    const declared = res.headers["content-length"];
    if (declared && Number(declared) !== f.bytes) { res.destroy(); throw new Error("declared_size_mismatch"); }
    let bytes = 0;
    const hash = createHash("sha256");
    const guard = new Transform({ transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > f.bytes || bytes > MAX_FILE_BYTES) return cb(new Error("stream_size_limit"));
      hash.update(chunk); cb(null, chunk);
    } });
    await pipeline(res, guard, createWriteStream(part, { flags: "wx", mode: 0o600 }), { signal: controller.signal });
    if (bytes !== f.bytes || hash.digest("hex") !== f.sha256) throw new Error("download_checksum_mismatch");
    const handle = await fs.open(part, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } finally { clearTimeout(timer); }
}
export function verifyManifest(text, files) {
  const records = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!m || records.has(m[2])) throw new Error("invalid_checksum_manifest");
    records.set(m[2], m[1]);
  }
  const expected = files.filter((f) => f.name !== "SHA256SUMS");
  if (records.size !== 16 || expected.some((f) => records.get(f.name) !== f.sha256)) throw new Error("checksum_manifest_conflict");
}
export async function runReceiveSubjectFactoryPackage({ brainTask, log }) {
  const p = validatePackage(brainTask.payload);
  const root = process.env.FACTORY_PACKAGES_ROOT || "/factory-packages";
  const dir = path.join(root, PACKAGE_ID);
  await ensureDirectory(dir);
  const identity = { version: 1, package_id: PACKAGE_ID, manifest_sha256: p.manifest_sha256, files: p.files.map(({ url, ...f }) => f).sort((a, b) => a.name.localeCompare(b.name)) };
  const identityText = JSON.stringify(identity);
  const identityPart = path.join(dir, `.identity-${randomUUID()}.part`);
  await fs.writeFile(identityPart, identityText, { flag: "wx", mode: 0o600 });
  try {
    await finalizeExclusive(identityPart, path.join(dir, "receipt-identity.json"), { sha256: createHash("sha256").update(identityText).digest("hex"), bytes: Buffer.byteLength(identityText) });
  } finally { await fs.rm(identityPart, { force: true }); }
  const verified = [];
  const deadline = Date.now() + 30 * 60 * 1000;
  for (const f of p.files) {
    if (Date.now() > deadline) throw new Error("package_time_limit");
    log("info", `Package verification: ${f.name}`);
    const target = path.join(dir, f.name);
    const existing = await fs.lstat(target).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
    if (existing) {
      const actual = await digestFile(target);
      if (actual.sha256 !== f.sha256 || actual.bytes !== f.bytes) throw new Error("existing_file_conflict");
    } else {
      const part = path.join(dir, `.${f.name}-${randomUUID()}.part`);
      try { await download(f, part); await finalizeExclusive(part, target, f); }
      catch (e) {
        // Errors must never contain signed URLs or network request objects.
        throw new Error(`package_file_failed:${f.name}:${/^[a-z0-9_]+$/.test(e.message || "") ? e.message : "download_failed"}`);
      } finally { await fs.rm(part, { force: true }); }
    }
    verified.push({ name: f.name, bytes: f.bytes, sha256: f.sha256 });
  }
  verifyManifest(await fs.readFile(path.join(dir, "SHA256SUMS"), "utf8"), p.files);
  const result = { version: 1, package_id: PACKAGE_ID, manifest_sha256: p.manifest_sha256, receipt_status: "verified", installation_status: "awaiting_review", files: verified, verified_at: new Date().toISOString() };
  const part = path.join(dir, `.receipt-${randomUUID()}.part`);
  const text = JSON.stringify(result);
  await fs.writeFile(part, text, { flag: "wx", mode: 0o600 });
  try { await fs.link(part, path.join(dir, "receipt.json")); }
  catch (e) { if (e.code !== "EEXIST") throw e; }
  finally { await fs.rm(part, { force: true }); }
  return result;
}