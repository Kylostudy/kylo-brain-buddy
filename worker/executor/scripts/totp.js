// TOTP kód generátor (RFC 6238, HMAC-SHA1, 6 számjegy, 30 mp).
// Kompatibilis a Google Authenticator / Authy / TikTok Authenticator kimenetével.
// Nincs külső függőség — Node beépített crypto.
//
// Használat:
//   import { generateTotp, secondsUntilNextTotp } from "./totp.js";
//   const code = generateTotp(creds.totpSecret); // "483920"

import { createHmac } from "node:crypto";

// Base32 (RFC 4648) → Buffer. Space/dash eltávolítva, kis/nagybetű mindegy.
function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * 6-jegyű TOTP kódot ad vissza az aktuális 30 mp-es ablakra.
 * @param {string} secret - base32 kódolt titok (Google Authenticator formátum)
 * @param {number} [timeMs] - opcionális teszt-időpont (ms)
 * @returns {string} 6 számjegy
 */
export function generateTotp(secret, timeMs = Date.now()) {
  if (!secret || typeof secret !== "string") {
    throw new Error("TOTP secret hiányzik.");
  }
  const key = base32Decode(secret);
  if (key.length === 0) throw new Error("TOTP secret érvénytelen (base32).");

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

/** Hány másodperc van hátra az aktuális TOTP ablakból. */
export function secondsUntilNextTotp(timeMs = Date.now()) {
  return 30 - (Math.floor(timeMs / 1000) % 30);
}
