// TOTP (RFC 6238, HMAC-SHA1, 6 számjegy, 30 mp) — szerveroldali TS változat.
// Ugyanaz a logika, mint worker/executor/scripts/totp.js; itt a server function-ök
// használják (előnézet / validálás a UI-nak).

import { createHmac } from "node:crypto";

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotp(secret: string, timeMs = Date.now()): string {
  const key = base32Decode(secret);
  if (key.length === 0) throw new Error("Érvénytelen TOTP secret (base32).");
  const counter = Math.floor(timeMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

export function secondsUntilNextTotp(timeMs = Date.now()): number {
  return 30 - (Math.floor(timeMs / 1000) % 30);
}
