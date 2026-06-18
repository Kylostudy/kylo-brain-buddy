/**
 * Szimmetrikus titkosítás a workflow_credentials számára.
 *
 * Kulcsképzés: HKDF(SUPABASE_SERVICE_ROLE_KEY, salt = "kylo-credentials-v1") → 32 byte.
 * Algoritmus: AES-256-GCM. Minden mezőhöz külön random 12-byte nonce.
 * Tárolt formátum: base64 (ciphertext+authTag konkatenálva) + külön base64 nonce.
 *
 * Soha ne logold a visszafejtett értékeket. Ez a fájl SERVER-ONLY.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const SALT = Buffer.from("kylo-credentials-v1");
const INFO = Buffer.from("workflow-credentials");

function getKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY hiányzik — a credentials titkosításhoz kötelező.",
    );
  }
  const ikm = Buffer.from(secret);
  const derived = hkdfSync("sha256", ikm, SALT, INFO, 32);
  return Buffer.from(derived);
}

export function encryptString(plain: string): { ciphertext: string; nonce: string } {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString("base64"),
    nonce: iv.toString("base64"),
  };
}

export function decryptString(ciphertextB64: string, nonceB64: string): string {
  const key = getKey();
  const iv = Buffer.from(nonceB64, "base64");
  const data = Buffer.from(ciphertextB64, "base64");
  // utolsó 16 byte = auth tag
  const enc = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
