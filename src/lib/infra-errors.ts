// Infrastruktúra- (proxy-) hibák felismerése és megnevezése.
//
// Ugyanaz a logika, mint a workerben (worker/executor/scripts/proxy-health.js),
// hogy a szerver akkor is helyesen tudja besorolni a futást, ha egy régebbi
// worker-verzió még nem küld `infra_error` jelölést.

export const INFRA_STATUS = "infra_error";

export const INFRA_LABELS: Record<string, string> = {
  proxy_connection: "A proxy kapcsolat nem épült fel",
  proxy_auth: "A proxy hitelesítés elutasítva",
  connection_reset: "A proxy bontotta a kapcsolatot",
  connection_refused: "A proxy nem fogadta a kapcsolatot",
  dns: "Névfeloldási hiba a proxyn",
  tls: "Titkosított kapcsolat hiba a proxyn",
  timeout: "Időtúllépés — a proxy nem válaszolt",
  nav_timeout: "Az oldal nem töltődött be időben (lassú proxy)",
  geo_mismatch: "A proxy nem a várt országból jött ki",
  browser_crash: "A böngésző lefagyott / bezárult a kapcsolat közben",
  slow_proxy: "Nagyon lassú proxy",
  preflight_unreachable: "A proxy-ellenőrzés nem futott le",
};

const INFRA_PATTERNS: Array<{ code: string; re: RegExp }> = [
  { code: "proxy_connection", re: /ERR_(PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION_FAILED)/i },
  { code: "proxy_auth", re: /(ERR_PROXY_AUTH_(UNSUPPORTED|REQUESTED)|407\s*Proxy Authentication)/i },
  { code: "connection_reset", re: /ERR_(CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|EMPTY_RESPONSE|SOCKET_NOT_CONNECTED)/i },
  { code: "connection_refused", re: /(ERR_CONNECTION_REFUSED|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE)/i },
  { code: "dns", re: /(ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|EAI_AGAIN|ENOTFOUND)/i },
  { code: "tls", re: /ERR_(SSL_PROTOCOL_ERROR|CERT_[A-Z_]+|BAD_SSL_CLIENT_AUTH_CERT)/i },
  { code: "timeout", re: /(ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT|ETIMEDOUT)/i },
  { code: "nav_timeout", re: /(page\.goto|Navigation)[\s\S]{0,80}Timeout \d+ms exceeded/i },
  { code: "geo_mismatch", re: /(Proxy ország eltérés|országa nem egyezik|proxy szivárgás)/i },
  { code: "browser_crash", re: /(Target (page|closed)|browser has been closed|Protocol error[\s\S]{0,40}Target closed)/i },
  { code: "preflight_unreachable", re: /Preflight sikertelen/i },
];

const PRODUCT_HINTS: RegExp[] = [
  /waiting for (locator|selector)/i,
  /kritérium/i,
  /nem teljesült/i,
  /megerősít/i,
];

export function classifyInfraError(message?: string | null): string | null {
  const msg = String(message ?? "");
  if (!msg) return null;
  if (PRODUCT_HINTS.some((r) => r.test(msg))) return null;
  for (const { code, re } of INFRA_PATTERNS) {
    if (re.test(msg)) return code;
  }
  return null;
}

export function infraLabel(code?: string | null): string {
  if (!code) return "Infrastruktúra (proxy) hiba";
  return INFRA_LABELS[code] ?? "Infrastruktúra (proxy) hiba";
}

export function isInfraStatus(status?: string | null): boolean {
  return status === INFRA_STATUS;
}
