/**
 * Szimmetrikus titkosítás a workflow_credentials számára.
 *
 * Kulcsképzés: HKDF-SHA256(SUPABASE_SERVICE_ROLE_KEY, salt="kylo-credentials-v1",
 * info="workflow-credentials") → 32 byte AES-GCM kulcs.
 * Algoritmus: AES-256-GCM, 12 byte random nonce, 16 byte authTag a ciphertext végén.
 * Formátum: base64(ciphertext||tag), külön base64(nonce).
 *
 * Web Crypto API (globalThis.crypto.subtle) — Node 18+ és Cloudflare workerd
 * egyaránt támogatja, így nem kell `node:crypto`, és a fájl nem dönti el
 * a kliens buildet sem, ha véletlenül oda kerül.
 *
 * Soha ne logold a visszafejtett értékeket. Ez a fájl SERVER-ONLY használatra van.
 */

const SALT = new TextEncoder().encode("kylo-credentials-v1");
const INFO = new TextEncoder().encode("workflow-credentials");

let cachedKey: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY hiányzik — a credentials titkosításhoz kötelező.",
      );
    }
    const subtle = globalThis.crypto.subtle;
    const ikm = await subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: INFO },
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  return cachedKey;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encryptString(
  plain: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const key = await getKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const enc = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plain),
    ),
  );
  // WebCrypto encrypt output már tartalmazza a tag-et a végén (16 byte).
  return { ciphertext: toB64(enc), nonce: toB64(iv) };
}

export async function decryptString(
  ciphertextB64: string,
  nonceB64: string,
): Promise<string> {
  const key = await getKey();
  const iv = fromB64(nonceB64);
  const data = fromB64(ciphertextB64);
  const dec = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource,
  );
  return new TextDecoder().decode(dec);
}
