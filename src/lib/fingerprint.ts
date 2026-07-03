// Per-workflow, stabil böngésző-fingerprint.
// A workflow id-ból determinisztikusan generálja ugyanazt a UA/viewport/locale/timezone
// kombinációt minden futáson — így egy fiók mindig "ugyanarról a gépről" jelentkezik be.
// Nincs külső függőség, tisztán JS.
//
// Kimenet mezők a Playwright browser.newContext() paramétereivel kompatibilisek.

export interface WorkflowFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
  platform: "Win32" | "MacIntel" | "Linux x86_64";
  deviceScaleFactor: number;
  // Chromium major version — a UA-val konzisztens legyen.
  chromeMajor: number;
}

// Reális, aktuális Chrome major verziók (2025 tavasz–ősz).
const CHROME_MAJORS = [124, 125, 126, 127, 128, 129, 130, 131];

// Ország → locale + timezone. Ha nincs a listában, magyarra esünk vissza.
const COUNTRY_LOCALE: Record<string, { locale: string; tz: string }> = {
  HU: { locale: "hu-HU", tz: "Europe/Budapest" },
  DE: { locale: "de-DE", tz: "Europe/Berlin" },
  AT: { locale: "de-AT", tz: "Europe/Vienna" },
  NL: { locale: "nl-NL", tz: "Europe/Amsterdam" },
  FR: { locale: "fr-FR", tz: "Europe/Paris" },
  IT: { locale: "it-IT", tz: "Europe/Rome" },
  ES: { locale: "es-ES", tz: "Europe/Madrid" },
  PL: { locale: "pl-PL", tz: "Europe/Warsaw" },
  CZ: { locale: "cs-CZ", tz: "Europe/Prague" },
  SK: { locale: "sk-SK", tz: "Europe/Bratislava" },
  RO: { locale: "ro-RO", tz: "Europe/Bucharest" },
  GB: { locale: "en-GB", tz: "Europe/London" },
  IE: { locale: "en-IE", tz: "Europe/Dublin" },
  US: { locale: "en-US", tz: "America/New_York" },
  CA: { locale: "en-CA", tz: "America/Toronto" },
  AU: { locale: "en-AU", tz: "Australia/Sydney" },
  CH: { locale: "de-CH", tz: "Europe/Zurich" },
  BE: { locale: "nl-BE", tz: "Europe/Brussels" },
  SE: { locale: "sv-SE", tz: "Europe/Stockholm" },
  DK: { locale: "da-DK", tz: "Europe/Copenhagen" },
  NO: { locale: "nb-NO", tz: "Europe/Oslo" },
  FI: { locale: "fi-FI", tz: "Europe/Helsinki" },
  PT: { locale: "pt-PT", tz: "Europe/Lisbon" },
  GR: { locale: "el-GR", tz: "Europe/Athens" },
};

// Reális desktop viewport-ok (a leggyakoribbak a StatCounter szerint).
const VIEWPORTS: { w: number; h: number; dsf: number }[] = [
  { w: 1920, h: 1080, dsf: 1 },
  { w: 1536, h: 864, dsf: 1.25 },
  { w: 1440, h: 900, dsf: 2 }, // Mac
  { w: 1366, h: 768, dsf: 1 },
  { w: 1600, h: 900, dsf: 1 },
  { w: 1680, h: 1050, dsf: 2 }, // Mac
  { w: 1280, h: 800, dsf: 1 },
];

// Egyszerű, determinisztikus hash (FNV-1a 32-bit). Nem kriptós, csak stabil szórás kell.
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(arr: readonly T[], seed: number, salt: string): T {
  const idx = fnv1a(seed.toString(36) + ":" + salt) % arr.length;
  return arr[idx];
}

/**
 * Determinisztikus fingerprint egy workflow-hoz.
 * Ugyanaz a workflowId + (opcionális) country mindig ugyanazt adja vissza.
 */
export function generateWorkflowFingerprint(
  workflowId: string,
  country?: string | null,
): WorkflowFingerprint {
  const seed = fnv1a(workflowId);
  const cc = (country || "").toUpperCase();
  const geo = COUNTRY_LOCALE[cc] || COUNTRY_LOCALE.HU;

  // Platform: 65% Windows, 25% Mac, 10% Linux — a workflowId-ból stabilan.
  const platformRoll = fnv1a(workflowId + ":platform") % 100;
  let platform: WorkflowFingerprint["platform"];
  if (platformRoll < 65) platform = "Win32";
  else if (platformRoll < 90) platform = "MacIntel";
  else platform = "Linux x86_64";

  // Viewport — Mac esetén a Retina-arányos viewportokat preferáljuk (dsf=2).
  const eligibleVps =
    platform === "MacIntel"
      ? VIEWPORTS.filter((v) => v.dsf >= 2)
      : VIEWPORTS.filter((v) => v.dsf < 2);
  const vp = pick(eligibleVps.length ? eligibleVps : VIEWPORTS, seed, "viewport");

  const chromeMajor = pick(CHROME_MAJORS, seed, "chrome");
  const chromeVersion = `${chromeMajor}.0.0.0`;

  const osPart =
    platform === "Win32"
      ? "Windows NT 10.0; Win64; x64"
      : platform === "MacIntel"
        ? "Macintosh; Intel Mac OS X 10_15_7"
        : "X11; Linux x86_64";

  const userAgent = `Mozilla/5.0 (${osPart}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

  return {
    userAgent,
    viewport: { width: vp.w, height: vp.h },
    locale: geo.locale,
    timezoneId: geo.tz,
    platform,
    deviceScaleFactor: vp.dsf,
    chromeMajor,
  };
}
