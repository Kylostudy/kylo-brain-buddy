/**
 * A VPS fájlkiszolgáló alapcíme.
 *
 * A Brain Cloudflare Workeren fut, ami nyers IP-címre (pl. http://1.2.3.4:8079)
 * nem engedi a kimenő kérést — ilyenkor 403-at kapunk. Ezért ha a beállított
 * cím IP-cím, a HTTPS-es aldomaint használjuk helyette.
 */
const DEFAULT_VAULT_FILE_BASE = "https://vault.kylosystems.com";

export function vaultFileBaseUrl(): string {
  const raw = process.env.VAULT_FILE_BASE_URL?.trim().replace(/\/+$/, "");
  if (!raw) return DEFAULT_VAULT_FILE_BASE;
  try {
    const host = new URL(raw).hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
      return DEFAULT_VAULT_FILE_BASE;
    }
  } catch {
    return DEFAULT_VAULT_FILE_BASE;
  }
  return raw;
}
