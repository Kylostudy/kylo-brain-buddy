// Pure shared contract: usable by the Brain gate and the Linux receiver.
export const PACKAGE_ID = "subject-20261018-v1";
export const KYLOGIC_TENANT = "14abbe6b-4781-4483-967f-84d87e0d2b05";
export const SOURCE_HOSTS = ["yqhipzwmgpopelfcenie.supabase.co"];
export const FILE_NAMES = ["README.md", "install.sh", "SHA256SUMS", ...Array.from({ length: 14 }, (_, i) => `payload.part-${String(i).padStart(3, "0")}`)];
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 600 * 1024 * 1024;
export function validatePackage(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1 || raw.package_id !== PACKAGE_ID || !/^[a-f0-9]{64}$/.test(raw.manifest_sha256 || "")) throw new Error("invalid_package_identity");
  if (!Array.isArray(raw.files) || raw.files.length !== 17) throw new Error("exactly_17_files_required");
  const seen = new Set();
  let total = 0;
  const files = raw.files.map((f) => {
    if (!f || !FILE_NAMES.includes(f.name) || seen.has(f.name)) throw new Error("invalid_or_duplicate_filename");
    seen.add(f.name);
    if (!Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(f.sha256 || "")) throw new Error("invalid_file_size_or_hash");
    let u;
    try { u = new URL(f.url); } catch { throw new Error("invalid_source_url"); }
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash || !SOURCE_HOSTS.includes(u.hostname) || !u.pathname.startsWith("/storage/v1/object/")) throw new Error("source_not_allowed");
    total += f.bytes;
    return { name: f.name, bytes: f.bytes, sha256: f.sha256, url: u.href };
  });
  if (total > MAX_PACKAGE_BYTES) throw new Error("package_too_large");
  if (files.find((f) => f.name === "SHA256SUMS")?.sha256 !== raw.manifest_sha256) throw new Error("manifest_hash_mismatch");
  return { version: 1, package_id: PACKAGE_ID, manifest_sha256: raw.manifest_sha256, files };
}