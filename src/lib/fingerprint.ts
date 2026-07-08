// Per-workflow, stabil böngésző-fingerprint.
// A workflow id-ból determinisztikusan generálja ugyanazt a UA/viewport/locale/timezone
// kombinációt minden futáson — így egy fiók mindig "ugyanarról a gépről" jelentkezik be.
// Nincs külső függőség, tisztán JS.
//
// Kimenet mezők a Playwright browser.newContext() paramétereivel kompatibilisek,
// PLUSZ extra spoof-mezők, amelyeket a worker init-script-ben a böngészőben
// visszaad (WebGL, hardwareConcurrency, deviceMemory, WebGPU, fontok).

export interface WorkflowFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
  platform: "Win32" | "MacIntel" | "Linux x86_64";
  deviceScaleFactor: number;
  chromeMajor: number;
  // ---- Extra spoof mezők (a worker init-script-ben injektálódnak) ----
  webglVendor: string;
  webglRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  // "real" (a Dolphin default is ez) vagy "noise"
  canvasMode: "real" | "noise";
  audioMode: "real" | "noise";
  canvasSeed: number;
  audioSeed: number;
  // Fontok — a "Fonts: Auto" alatt a Dolphin egy reális OS-fontlistát ad.
  fonts: string[];
}

// A workerben lévő Playwright 1.61.1 Chromium 149-et futtat. Fontos, hogy a
// user-agent ne hazudjon régebbi főverziót, mert ez botdetektálási jel lehet.
const CHROME_MAJORS = [149];

// Ország → locale + timezone. Ha nincs a listában, magyarra esünk vissza.
const COUNTRY_LOCALE: Record<string, { locale: string; tz: string }> = {
  HU: { locale: "hu-HU", tz: "Europe/Budapest" },
  DE: { locale: "de-DE", tz: "Europe/Berlin" },
  AT: { locale: "de-AT", tz: "Europe/Vienna" },
  NL: { locale: "en-US", tz: "Europe/Amsterdam" }, // NL proxy + EN böngésző (Dolphin mintája)
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
  NZ: { locale: "en-NZ", tz: "Pacific/Auckland" },
  CH: { locale: "de-CH", tz: "Europe/Zurich" },
  BE: { locale: "nl-BE", tz: "Europe/Brussels" },
  SE: { locale: "sv-SE", tz: "Europe/Stockholm" },
  DK: { locale: "da-DK", tz: "Europe/Copenhagen" },
  NO: { locale: "nb-NO", tz: "Europe/Oslo" },
  FI: { locale: "fi-FI", tz: "Europe/Helsinki" },
  PT: { locale: "pt-PT", tz: "Europe/Lisbon" },
  GR: { locale: "el-GR", tz: "Europe/Athens" },
  IL: { locale: "en-US", tz: "Asia/Jerusalem" },
  BR: { locale: "pt-BR", tz: "America/Sao_Paulo" },
  MX: { locale: "es-MX", tz: "America/Mexico_City" },
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

// Reális WebGL vendor/renderer párok platformonként. A Dolphin Pinterest NL
// profilja pl. `ANGLE (NVIDIA, RTX 4060 ... Direct3D11)`-t hazudik.
const WEBGL_WIN: { vendor: string; renderer: string }[] = [
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002808) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 (0x00002184) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (Intel)",
    renderer:
      "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (AMD)",
    renderer:
      "ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
];
const WEBGL_MAC: { vendor: string; renderer: string }[] = [
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)" },
];
const WEBGL_LINUX: { vendor: string; renderer: string }[] = [
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)" },
];

// Tipikus Windows 10/11 rendszerfontok — a legtöbb desktop gépen ott vannak.
const FONTS_WIN = [
  "Arial", "Arial Black", "Arial Narrow", "Bahnschrift", "Calibri", "Cambria",
  "Cambria Math", "Candara", "Comic Sans MS", "Consolas", "Constantia",
  "Corbel", "Courier New", "Ebrima", "Franklin Gothic Medium", "Gabriola",
  "Gadugi", "Georgia", "HoloLens MDL2 Assets", "Impact", "Ink Free",
  "Javanese Text", "Leelawadee UI", "Lucida Console", "Lucida Sans Unicode",
  "Malgun Gothic", "Marlett", "Microsoft Himalaya", "Microsoft JhengHei",
  "Microsoft New Tai Lue", "Microsoft PhagsPa", "Microsoft Sans Serif",
  "Microsoft Tai Le", "Microsoft YaHei", "Microsoft Yi Baiti", "MingLiU-ExtB",
  "Mongolian Baiti", "MS Gothic", "MV Boli", "Myanmar Text",
  "Nirmala UI", "Palatino Linotype", "Segoe MDL2 Assets", "Segoe Print",
  "Segoe Script", "Segoe UI", "Segoe UI Emoji", "Segoe UI Historic",
  "Segoe UI Symbol", "SimSun", "Sitka", "Sylfaen", "Symbol", "Tahoma",
  "Times New Roman", "Trebuchet MS", "Verdana", "Webdings", "Wingdings",
  "Yu Gothic",
];
const FONTS_MAC = [
  "Andale Mono", "Arial", "Arial Black", "Arial Narrow", "Arial Unicode MS",
  "Avenir", "Avenir Next", "Baskerville", "Big Caslon", "Bodoni 72",
  "Bradley Hand", "Brush Script MT", "Chalkboard", "Chalkduster",
  "Charter", "Cochin", "Comic Sans MS", "Copperplate", "Courier",
  "Courier New", "Didot", "Futura", "Geneva", "Georgia",
  "Gill Sans", "Helvetica", "Helvetica Neue", "Herculanum", "Hoefler Text",
  "Impact", "Lucida Grande", "Marker Felt", "Menlo", "Monaco",
  "Optima", "Palatino", "Papyrus", "Phosphate", "Rockwell",
  "Savoye LET", "SignPainter", "Skia", "Snell Roundhand", "Tahoma",
  "Times", "Times New Roman", "Trebuchet MS", "Verdana", "Zapfino",
];
const FONTS_LINUX = [
  "DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono", "Liberation Sans",
  "Liberation Serif", "Liberation Mono", "Noto Sans", "Noto Serif",
  "Ubuntu", "Ubuntu Mono", "Cantarell", "FreeMono", "FreeSans", "FreeSerif",
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
  const chromeVersion = `${chromeMajor}.0.7827.55`;

  const osPart =
    platform === "Win32"
      ? "Windows NT 10.0; Win64; x64"
      : platform === "MacIntel"
        ? "Macintosh; Intel Mac OS X 10_15_7"
        : "X11; Linux x86_64";

  const userAgent = `Mozilla/5.0 (${osPart}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

  // WebGL vendor + renderer platformhoz igazítva.
  const webglPool =
    platform === "Win32" ? WEBGL_WIN : platform === "MacIntel" ? WEBGL_MAC : WEBGL_LINUX;
  const webgl = pick(webglPool, seed, "webgl");

  // Hardware concurrency: 4/6/8/12/16 (reális asztali CPU-k).
  const hardwareConcurrency = pick([4, 6, 8, 8, 12, 16], seed, "cores");
  // Device memory (GB): a Chrome csak 0.25/0.5/1/2/4/8-at ad vissza.
  const deviceMemory = pick([4, 8, 8, 8], seed, "ram");

  const fonts =
    platform === "Win32" ? FONTS_WIN : platform === "MacIntel" ? FONTS_MAC : FONTS_LINUX;

  return {
    userAgent,
    viewport: { width: vp.w, height: vp.h },
    locale: geo.locale,
    timezoneId: geo.tz,
    platform,
    deviceScaleFactor: vp.dsf,
    chromeMajor,
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    hardwareConcurrency,
    deviceMemory,
    canvasMode: "noise",
    audioMode: "noise",
    canvasSeed: fnv1a(workflowId + ":canvas"),
    audioSeed: fnv1a(workflowId + ":audio"),
    fonts,
  };
}
