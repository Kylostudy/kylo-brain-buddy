// worker/executor/scripts/proxy-health.js
//
// Proxy-egészség és adaptív türelmi idők.
//
// Cél: ne a tesztelt terméket (Kylo) büntessük, ha a hiba valójában a
// hálózat / proxy oldalán van. Két dolgot csinál:
//
//   1) OSZTÁLYOZÁS — a hibaüzenetből felismeri, hogy ez infrastruktúra-hiba
//      (proxy nem épül fel, timeout, DNS, tunnel bontás, geo-eltérés), vagy
//      valódi termékhiba. Az előbbit a felület sárga „Proxy hiba"-ként
//      jelzi, nem pirosként.
//
//   2) ADAPTÍV VÁRAKOZÁS — a preflight (whoer.net betöltés) idejéből
//      megbecsüli a proxy sebességét, és ehhez igazítja az összes későbbi
//      várakozási határidőt. Gyors proxyn nem lassulunk, lassún viszont nem
//      bukunk el fölöslegesen.

// ---- 1) Infrastruktúra-hiba felismerés ----

const INFRA_PATTERNS = [
  { code: "proxy_connection", re: /ERR_(PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION_FAILED)/i },
  { code: "proxy_auth", re: /(ERR_PROXY_AUTH_(UNSUPPORTED|REQUESTED)|407\s*Proxy Authentication)/i },
  { code: "connection_reset", re: /ERR_(CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|EMPTY_RESPONSE|SOCKET_NOT_CONNECTED)/i },
  { code: "connection_refused", re: /(ERR_CONNECTION_REFUSED|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE)/i },
  { code: "dns", re: /(ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|EAI_AGAIN|ENOTFOUND)/i },
  { code: "tls", re: /ERR_(SSL_PROTOCOL_ERROR|CERT_[A-Z_]+|BAD_SSL_CLIENT_AUTH_CERT)/i },
  { code: "timeout", re: /(ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|net::ERR_ABORTED)/i },
  { code: "nav_timeout", re: /(page\.goto|Navigation).{0,80}Timeout \d+ms exceeded/i },
  { code: "geo_mismatch", re: /(Proxy ország eltérés|országa nem egyezik|proxy szivárgás)/i },
  { code: "browser_crash", re: /(Target (page|closed)|browser has been closed|Protocol error.*Target closed)/i },
];

// Ezek NEM infra-hibák, akkor sem, ha timeout szó van bennük: a termék oldali
// elem nem jelent meg, ami valódi bukás.
const PRODUCT_TIMEOUT_HINTS = [
  /waiting for (locator|selector)/i,
  /kritérium/i,
  /nem teljesült/i,
  /megerősít/i,
  /Stripe .*(mez|gomb)/i,
];

/**
 * @param {string|null|undefined} message
 * @returns {{ infra: boolean, code: string|null, label: string|null }}
 */
export function classifyInfra(message) {
  const msg = String(message || "");
  if (!msg) return { infra: false, code: null, label: null };
  for (const hint of PRODUCT_TIMEOUT_HINTS) {
    if (hint.test(msg)) return { infra: false, code: null, label: null };
  }
  for (const { code, re } of INFRA_PATTERNS) {
    if (re.test(msg)) return { infra: true, code, label: INFRA_LABELS[code] || code };
  }
  return { infra: false, code: null, label: null };
}

export const INFRA_LABELS = {
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
};

// ---- 2) Adaptív türelmi idők ----

const TIERS = [
  { tier: "fast", maxMs: 3000, multiplier: 1, label: "gyors" },
  { tier: "normal", maxMs: 8000, multiplier: 1.4, label: "átlagos" },
  { tier: "slow", maxMs: 18000, multiplier: 2.2, label: "lassú" },
  { tier: "very_slow", maxMs: Infinity, multiplier: 3.2, label: "nagyon lassú" },
];

let profile = { latencyMs: null, tier: "normal", multiplier: 1.4, label: "átlagos" };

/** A preflight mért idejéből beállítja a globális szorzót. */
export function setProxyLatency(latencyMs) {
  const ms = Number(latencyMs);
  if (!Number.isFinite(ms) || ms <= 0) return profile;
  const t = TIERS.find((x) => ms <= x.maxMs) || TIERS[TIERS.length - 1];
  profile = { latencyMs: Math.round(ms), tier: t.tier, multiplier: t.multiplier, label: t.label };
  return profile;
}

export function getProxyProfile() {
  return { ...profile };
}

/** Egy alap-időkorlátot a mért proxysebességhez skáláz (max 5 perc). */
export function scaleMs(baseMs) {
  const v = Math.round(Number(baseMs || 0) * profile.multiplier);
  return Math.min(Math.max(v, Number(baseMs || 0)), 300000);
}

/** Igaz, ha a proxy annyira lassú, hogy a bukást infra-hibaként kell könyvelni. */
export function isProxyCriticallySlow() {
  return profile.tier === "very_slow";
}

/**
 * Egységes „infra jelölés" a run eredményéhez, amit a szerver felismer.
 */
export function infraResult(base, code, detail) {
  return {
    ...(base && typeof base === "object" ? base : {}),
    infra_error: true,
    infra_code: code,
    infra_reason: INFRA_LABELS[code] || code,
    infra_detail: detail ? String(detail).slice(0, 800) : null,
    proxy_profile: getProxyProfile(),
  };
}
