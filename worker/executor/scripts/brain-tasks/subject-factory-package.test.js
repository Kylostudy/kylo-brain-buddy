import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { validatePackage, FILE_NAMES, MAX_FILE_BYTES, MAX_PACKAGE_BYTES } from "./subject-factory-contract.js";
import { isPublicAddress, finalizeExclusive, verifyManifest, runReceiveSubjectFactoryPackage } from "./receive-subject-factory-package.js";
const hash = (text) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const content = new Map(FILE_NAMES.filter((n) => n !== "SHA256SUMS").map((n) => [n, `test-${n}`]));
  content.set("SHA256SUMS", [...content].map(([n, text]) => `${hash(text)}  ${n}\n`).join(""));
  const files = [...content].map(([name, text]) => ({ name, bytes: Buffer.byteLength(text), sha256: hash(text), url: `https://yqhipzwmgpopelfcenie.supabase.co/storage/v1/object/sign/fixture/${name}?token=not-a-real-token` }));
  return { content, payload: { version: 1, package_id: "subject-20261018-v1", manifest_sha256: hash(content.get("SHA256SUMS")), files } };
}
test("versioned package accepts exactly the 17 authorized filenames", () => {
  const { payload } = fixture();
  assert.equal(validatePackage(payload).files.length, 17);
  payload.files[0].name = "../install.sh";
  assert.throws(() => validatePackage(payload), /filename/);
});
test("40 MiB per-file limit is enforced", () => {
  const { payload } = fixture(); payload.files[0].bytes = MAX_FILE_BYTES + 1;
  assert.equal(MAX_FILE_BYTES, 41943040);
  assert.throws(() => validatePackage(payload), /size/);
});
test("600 MiB aggregate limit is enforced", () => {
  const { payload } = fixture(); payload.files.forEach((f) => f.bytes = MAX_FILE_BYTES);
  assert.equal(MAX_PACKAGE_BYTES, 629145600);
  assert.throws(() => validatePackage(payload), /package_too_large/);
});
test("authenticated manifest hash must match SHA256SUMS entry", () => {
  const { payload } = fixture(); payload.manifest_sha256 = "a".repeat(64);
  assert.throws(() => validatePackage(payload), /manifest_hash/);
});
test("only HTTPS on the approved storage host is accepted", () => {
  for (const url of ["http://yqhipzwmgpopelfcenie.supabase.co/storage/v1/object/a", "https://127.0.0.1/a", "https://evil.example/a", "https://user:pass@yqhipzwmgpopelfcenie.supabase.co/storage/v1/object/a"]) {
    const { payload } = fixture(); payload.files[0].url = url;
    assert.throws(() => validatePackage(payload), /source/);
  }
});
test("private, loopback, link-local and rebinding destinations are rejected", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(isPublicAddress(ip), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
});
test("exclusive finalization never overwrites a different final file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "factory-protection-"));
  try {
    const target = path.join(dir, "video.mp4"), part = path.join(dir, "new.part");
    await fs.writeFile(target, "existing"); await fs.writeFile(part, "replacement");
    await assert.rejects(finalizeExclusive(part, target, { sha256: hash("replacement"), bytes: 11 }), /conflict/);
    assert.equal(await fs.readFile(target, "utf8"), "existing");
    await fs.writeFile(part, "existing");
    await finalizeExclusive(part, target, { sha256: hash("existing"), bytes: 8 });
    assert.equal(await fs.readFile(target, "utf8"), "existing");
  } finally { await fs.rm(dir, { recursive: true }); }
});
test("downloaded checksum manifest cannot contradict signed metadata", () => {
  const { payload, content } = fixture();
  verifyManifest(content.get("SHA256SUMS"), payload.files);
  assert.throws(() => verifyManifest(content.get("SHA256SUMS").replace(payload.files[0].sha256, "0".repeat(64)), payload.files), /conflict/);
});
test("real receiver adopts all 17 verified files, retries safely and never exposes URLs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "factory-receipt-"));
  const oldRoot = process.env.FACTORY_PACKAGES_ROOT;
  process.env.FACTORY_PACKAGES_ROOT = root;
  try {
    const { payload, content } = fixture(); const dir = path.join(root, payload.package_id);
    await fs.mkdir(dir);
    for (const [name, text] of content) await fs.writeFile(path.join(dir, name), text);
    const args = { brainTask: { payload }, log: () => {} };
    const result = await runReceiveSubjectFactoryPackage(args);
    assert.equal(result.receipt_status, "verified"); assert.equal(result.installation_status, "awaiting_review");
    assert.equal(result.files.length, 17);
    assert.equal(JSON.stringify(result).includes("token="), false);
    assert.equal((await runReceiveSubjectFactoryPackage(args)).receipt_status, "verified");
    await fs.writeFile(path.join(dir, "README.md"), "corrupt");
    await assert.rejects(runReceiveSubjectFactoryPackage(args), /conflict/);
    assert.equal(await fs.readFile(path.join(dir, "README.md"), "utf8"), "corrupt");
  } finally { if (oldRoot === undefined) delete process.env.FACTORY_PACKAGES_ROOT; else process.env.FACTORY_PACKAGES_ROOT = oldRoot; await fs.rm(root, { recursive: true }); }
});