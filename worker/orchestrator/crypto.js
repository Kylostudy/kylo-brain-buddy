// worker/orchestrator/crypto.js
// AES-256-GCM dekriptáló — pontosan az `src/lib/credentials/crypto.server.ts`
// párja. Ugyanaz a HKDF-kulcsképzés (SUPABASE_SERVICE_ROLE_KEY-ből), így a
// Lovable Cloud-on titkosított credentialek itt is megnyithatók.

import { createDecipheriv, hkdfSync } from "node:crypto";

const SALT = Buffer.from("kylo-credentials-v1");
const INFO = Buffer.from("workflow-credentials");

function getKey() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY hiányzik a workeren.");
  }
  const derived = hkdfSync("sha256", Buffer.from(secret), SALT, INFO, 32);
  return Buffer.from(derived);
}

export function decryptString(ciphertextB64, nonceB64) {
  if (!ciphertextB64 || !nonceB64) return null;
  const key = getKey();
  const iv = Buffer.from(nonceB64, "base64");
  const data = Buffer.from(ciphertextB64, "base64");
  const enc = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
