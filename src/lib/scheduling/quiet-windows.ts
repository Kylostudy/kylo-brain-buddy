// Központi időablak-szabályok minden worker ütemezéshez.
//
// 1) "Gazdi-ablak": este 17:00–23:00 budapesti idő között SEMMILYEN worker
//    futás nem indulhat (se bemelegítés, se monitor, se brain task), hogy
//    nyugodtan lehessen dolgozni a gépen.
// 2) Helyi nappal: egy fiókot/proxyt csak a saját országa szerinti nappali
//    órákban melegítünk — ne éjjel 3-kor görgessen a szingapúri fiók.

export const OWNER_TIMEZONE = "Europe/Budapest";
export const OWNER_BLACKOUT_START = 17; // 17:00
export const OWNER_BLACKOUT_END = 23; // 23:00 (nem inkluzív)

/** Helyi óra (0-23) egy IANA időzónában. */
export function hourInTimezone(timezone: string, now: Date = new Date()): number {
  try {
    const s = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now);
    const h = Number(s);
    return Number.isFinite(h) ? h % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/**
 * Ideiglenes "teljes gáz" ablak: eddig az időpontig a Reddit bemelegítések
 * a gazdi-ablak alatt is futhatnak (a gazdi kifejezett kérésére).
 * Lejárat után magától visszaáll a normál 17:00–23:00 tiltás.
 */
export const REDDIT_BOOST_UNTIL = new Date("2026-07-30T14:00:00Z"); // 2026.07.30. 16:00 budapesti idő

export function isRedditBoostActive(now: Date = new Date()): boolean {
  return now.getTime() < REDDIT_BOOST_UNTIL.getTime();
}

/** Igaz, ha most a gazdi esti tiltott ablakában vagyunk (17:00–23:00 CET/CEST). */
export function isOwnerBlackout(now: Date = new Date()): boolean {
  const h = hourInTimezone(OWNER_TIMEZONE, now);
  return h >= OWNER_BLACKOUT_START && h < OWNER_BLACKOUT_END;
}

/** Ország → IANA időzóna (a nálunk használt proxy/locale országokra). */
const COUNTRY_TZ: Record<string, string> = {
  AE: "Asia/Dubai",
  AR: "America/Argentina/Buenos_Aires",
  AT: "Europe/Vienna",
  AU: "Australia/Sydney",
  BE: "Europe/Brussels",
  BR: "America/Sao_Paulo",
  CA: "America/Toronto",
  CH: "Europe/Zurich",
  CL: "America/Santiago",
  CN: "Asia/Shanghai",
  CO: "America/Bogota",
  CZ: "Europe/Prague",
  DE: "Europe/Berlin",
  DK: "Europe/Copenhagen",
  EG: "Africa/Cairo",
  ES: "Europe/Madrid",
  FI: "Europe/Helsinki",
  FR: "Europe/Paris",
  GB: "Europe/London",
  HK: "Asia/Hong_Kong",
  HR: "Europe/Zagreb",
  HU: "Europe/Budapest",
  IE: "Europe/Dublin",
  IL: "Asia/Jerusalem",
  IN: "Asia/Kolkata",
  IT: "Europe/Rome",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  MA: "Africa/Casablanca",
  MX: "America/Mexico_City",
  NL: "Europe/Amsterdam",
  NO: "Europe/Oslo",
  NZ: "Pacific/Auckland",
  PL: "Europe/Warsaw",
  PT: "Europe/Lisbon",
  RO: "Europe/Bucharest",
  SA: "Asia/Riyadh",
  SE: "Europe/Stockholm",
  SG: "Asia/Singapore",
  SI: "Europe/Ljubljana",
  SK: "Europe/Bratislava",
  TR: "Europe/Istanbul",
  TW: "Asia/Taipei",
  UA: "Europe/Kyiv",
  US: "America/New_York",
  VN: "Asia/Ho_Chi_Minh",
  ZA: "Africa/Johannesburg",
};

/** Nyelv → alap időzóna, ha nincs országkód. */
const LANGUAGE_TZ: Record<string, string> = {
  ar: "Asia/Dubai",
  cs: "Europe/Prague",
  da: "Europe/Copenhagen",
  de: "Europe/Berlin",
  en: "Europe/London",
  es: "Europe/Madrid",
  fi: "Europe/Helsinki",
  fr: "Europe/Paris",
  hu: "Europe/Budapest",
  it: "Europe/Rome",
  ja: "Asia/Tokyo",
  nl: "Europe/Amsterdam",
  pl: "Europe/Warsaw",
  pt: "Europe/Lisbon",
  "pt-br": "America/Sao_Paulo",
  sv: "Europe/Stockholm",
  tr: "Europe/Istanbul",
};

/**
 * Időzóna kitalálása locale ("en-SG"), országkód ("SG") vagy nyelv ("hu")
 * alapján. Ha semmi sem stimmel, UTC.
 */
export function resolveTimezone(
  ...hints: Array<string | null | undefined>
): string {
  for (const hint of hints) {
    if (!hint) continue;
    const raw = String(hint).trim();
    if (!raw) continue;
    if (raw.includes("/")) return raw; // már IANA időzóna

    const parts = raw.split(/[-_]/);
    const maybeCountry = (parts[1] || (parts[0].length === 2 ? parts[0] : "")).toUpperCase();
    if (COUNTRY_TZ[maybeCountry]) return COUNTRY_TZ[maybeCountry];

    const lower = raw.toLowerCase();
    if (LANGUAGE_TZ[lower]) return LANGUAGE_TZ[lower];
    const lang = parts[0].toLowerCase();
    if (LANGUAGE_TZ[lang]) return LANGUAGE_TZ[lang];
  }
  return "UTC";
}

/** Helyi nappali ablak: alapból 09:00–21:00 az adott időzónában. */
export function isLocalDaytime(
  timezone: string,
  now: Date = new Date(),
  startHour = 9,
  endHour = 21,
): boolean {
  const h = hourInTimezone(timezone, now);
  return h >= startHour && h < endHour;
}
