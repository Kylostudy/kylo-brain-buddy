// worker/executor/scripts/humanize.js
// Emberi viselkedés modul a Brain worker-hez.
//
// Alapelvek:
//  - Semmilyen fix `sleep`. Minden várakozás eloszlásból húz (Poisson /
//    exponenciális / lognormális), így nincs ismétlődő időzítés-minta.
//  - Kurzor nem egyenes vonalon megy — Bezier-görbe + overshoot + jitter,
//    változó lépésszámmal és sebességgel.
//  - Kattintás előtt hover-el, néha félreklikkel (~7%) és visszakorrigál.
//  - Gépelés karakterenként lognormális késleltetéssel, ~4% elgépelés
//    (rossz karakter → backspace → helyes), néha rövid gondolkodó szünet
//    egy szó után.
//  - Alkalmi mikro-scroll és kurzor-elkalandozás a "gondolkodó" hatásért.
//
// Sebesség szándékosan lassabb, mint a botok — cserébe nem vadásznak le.

// -------- Determinisztikus, run-specifikus véletlen (seed) --------
// Ha ugyanaz a seed jönne ismét, jó tudni hogy a keverés más lesz — ezért
// mindig kombinálunk process.hrtime-mal.
let _rng = mulberry32(mixSeed(Date.now(), process.pid, Math.floor(Math.random() * 1e9)));

function mixSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function reseedHuman(seedParts = []) {
  _rng = mulberry32(mixSeed(Date.now(), process.pid, ...seedParts, Math.floor(Math.random() * 1e9)));
}

function rand() { return _rng(); }
function randRange(min, max) { return min + rand() * (max - min); }
function randInt(min, max) { return Math.floor(randRange(min, max + 1)); }

// Exponenciális eloszlás — Poisson-folyamat közötti idők ilyenek.
// meanMs = várható érték. Levágjuk min/max-szal, hogy ne fussunk el.
function expWait(meanMs, minMs = 40, maxMs = meanMs * 6) {
  const u = Math.max(1e-6, rand());
  const v = -Math.log(u) * meanMs;
  return Math.min(maxMs, Math.max(minMs, v));
}

// Lognormál — karakterenkénti gépelési késleltetés jellegzetes eloszlása.
function lognormalMs(medianMs, sigma = 0.5) {
  const u1 = Math.max(1e-6, rand());
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return medianMs * Math.exp(sigma * z);
}

// -------- Várakozások --------

/**
 * Emberi várakozás Poisson-jelleggel.
 * @param {number} meanMs várható érték ms-ben
 */
export async function humanWait(page, meanMs = 500) {
  const ms = expWait(meanMs, Math.min(60, meanMs * 0.15), meanMs * 5);
  await page.waitForTimeout(ms);
}

/** Rövid "olvasó/gondolkodó" szünet — hosszabb farokkal. */
export async function humanThink(page, meanMs = 1400) {
  // 15% eséllyel elgondolkodik hosszabban
  const mean = rand() < 0.15 ? meanMs * 2.5 : meanMs;
  await humanWait(page, mean);
}

// -------- Kurzor pálya --------

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

// Az aktuális kurzorpozíciót nem tudjuk lekérdezni Playwright-ból —
// magunk követjük.
const _cursor = { x: 200, y: 300, known: false };

async function moveCursor(page, toX, toY, opts = {}) {
  const startX = _cursor.known ? _cursor.x : randRange(150, 600);
  const startY = _cursor.known ? _cursor.y : randRange(150, 500);
  const dx = toX - startX;
  const dy = toY - startY;
  const dist = Math.hypot(dx, dy) || 1;

  // Kontrollpontok — enyhén oldalra hajlik a pálya.
  const perpX = -dy / dist;
  const perpY = dx / dist;
  const curve1 = (rand() - 0.5) * dist * 0.35;
  const curve2 = (rand() - 0.5) * dist * 0.35;
  const c1 = {
    x: startX + dx * 0.3 + perpX * curve1,
    y: startY + dy * 0.3 + perpY * curve1,
  };
  const c2 = {
    x: startX + dx * 0.7 + perpX * curve2,
    y: startY + dy * 0.7 + perpY * curve2,
  };

  const steps = Math.max(18, Math.min(80, Math.round(dist / randRange(6, 14))));
  const totalMs = opts.durationMs ?? Math.max(180, Math.min(1600, dist * randRange(1.4, 2.6)));

  for (let i = 1; i <= steps; i++) {
    // Ease-in-out: a bot egyenletes, az ember gyorsul-lassul.
    const raw = i / steps;
    const t = 0.5 - 0.5 * Math.cos(Math.PI * raw);
    const p = bezier({ x: startX, y: startY }, c1, c2, { x: toX, y: toY }, t);
    // Jitter — remegő kéz
    const jx = (rand() - 0.5) * 1.2;
    const jy = (rand() - 0.5) * 1.2;
    await page.mouse.move(p.x + jx, p.y + jy);
    _cursor.x = p.x; _cursor.y = p.y; _cursor.known = true;

    // Nem egyenletes időzítés a lépések között
    const stepMs = (totalMs / steps) * randRange(0.6, 1.4);
    await page.waitForTimeout(Math.max(4, stepMs));
  }

  // Overshoot — ~35% eséllyel túlmegy és visszakorrigál
  if (rand() < 0.35 && dist > 60) {
    const overX = toX + (dx / dist) * randRange(6, 22);
    const overY = toY + (dy / dist) * randRange(6, 22);
    await page.mouse.move(overX, overY);
    await page.waitForTimeout(randInt(40, 120));
    await page.mouse.move(toX + (rand() - 0.5), toY + (rand() - 0.5));
    _cursor.x = toX; _cursor.y = toY;
  } else {
    _cursor.x = toX; _cursor.y = toY;
  }
}

async function boundingCenter(target) {
  const box = await target.boundingBox();
  if (!box) return null;
  // Nem pontosan középre — véletlen offset az elemen belül
  const cx = box.x + box.width * randRange(0.3, 0.7);
  const cy = box.y + box.height * randRange(0.3, 0.7);
  return { x: cx, y: cy, box };
}

// -------- Kattintás --------

/**
 * Emberi kattintás elemre. Selector vagy Locator/Handle egyaránt jó.
 * ~7% eséllyel elkövet egy kis félreklikket (mellé kattint), visszalép, majd
 * ténylegesen a célra kattint. Előtte hover + mikroszünet.
 */
export async function humanClick(page, target, opts = {}) {
  const el = typeof target === "string" ? await page.waitForSelector(target, { state: "visible", timeout: opts.timeout ?? 15000 }) : target;
  const center = await boundingCenter(el);
  if (!center) throw new Error("humanClick: nem található a cél elem doboza");

  // Alkalmi elkalandozás menet közben
  if (rand() < 0.18) {
    const wanderX = randRange(200, 900);
    const wanderY = randRange(150, 600);
    await moveCursor(page, wanderX, wanderY, { durationMs: randInt(240, 500) });
    await humanWait(page, 220);
  }

  // Néha félrekattint
  const misclick = !opts.noMisclick && rand() < 0.07;
  if (misclick) {
    const offX = center.x + randRange(-140, 140);
    const offY = center.y + randRange(-90, 90);
    await moveCursor(page, offX, offY);
    await page.waitForTimeout(randInt(50, 180));
    // "Ó, nem ezt akartam" — nem kattint, csak visszamegy
    await humanWait(page, 320);
  }

  await moveCursor(page, center.x, center.y);
  // Hover-szünet — az ember ránéz mielőtt kattint
  await page.waitForTimeout(randInt(80, 260));

  // Kattintás — down/up közti késleltetés is variál
  await page.mouse.down();
  await page.waitForTimeout(randInt(35, 110));
  await page.mouse.up();

  // Utólagos rövid szünet
  await humanWait(page, 380);
}

// -------- Gépelés --------

const NEIGHBOR = {
  a:"qsz", b:"vn", c:"xv", d:"sf", e:"wr", f:"dg", g:"fh", h:"gj",
  i:"uo", j:"hk", k:"jl", l:"k", m:"n", n:"bm", o:"ip", p:"o",
  q:"wa", r:"et", s:"ad", t:"ry", u:"yi", v:"cb", w:"qe", x:"zc",
  y:"tu", z:"xa",
};

function typoFor(ch) {
  const low = ch.toLowerCase();
  const opts = NEIGHBOR[low];
  if (!opts) return null;
  const pick = opts[Math.floor(rand() * opts.length)];
  return ch === low ? pick : pick.toUpperCase();
}

/**
 * Emberi gépelés. Minden karakter előtt lognormális szünet, ~4%
 * elgépelés (leüti a helytelen billentyűt → backspace → helyes).
 * Szóközök után néha "gondolkodó" szünet.
 */
export async function humanType(page, text, opts = {}) {
  const meanCharMs = opts.meanCharMs ?? 95;   // átlag ~95ms/char
  const typoRate = opts.typoRate ?? 0.04;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Gondolkodó szünet szó után
    if (i > 0 && text[i - 1] === " " && rand() < 0.18) {
      await page.waitForTimeout(randInt(200, 700));
    }

    // Elgépelés csak betűkre
    if (/[a-zA-Z]/.test(ch) && rand() < typoRate) {
      const bad = typoFor(ch);
      if (bad) {
        await page.keyboard.type(bad);
        await page.waitForTimeout(Math.max(35, lognormalMs(meanCharMs, 0.55)));
        // észreveszi
        await page.waitForTimeout(randInt(90, 240));
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(randInt(60, 160));
      }
    }

    await page.keyboard.type(ch);
    const delay = Math.max(20, lognormalMs(meanCharMs, 0.5));
    await page.waitForTimeout(delay);
  }
}

// -------- Egyéb szokások --------

/** Kis scroll, mintha a felhasználó körbenézne. */
export async function humanCasualScroll(page, opts = {}) {
  const rounds = opts.rounds ?? randInt(1, 3);
  for (let i = 0; i < rounds; i++) {
    const delta = randInt(120, 480) * (rand() < 0.85 ? 1 : -1);
    await page.mouse.wheel(0, delta);
    await humanWait(page, 700);
  }
}

/** Alkalmi kurzor-drift — a "kéz nem áll teljesen mozdulatlanul". */
export async function humanIdleDrift(page) {
  if (!_cursor.known) return;
  const dx = (rand() - 0.5) * 40;
  const dy = (rand() - 0.5) * 30;
  await moveCursor(page, _cursor.x + dx, _cursor.y + dy, { durationMs: randInt(200, 500) });
  await humanWait(page, 400);
}

/** Rövid "böngészős" viselkedés egy oldalon: kis scroll + drift + várakozás. */
export async function humanBrowseMoment(page) {
  if (rand() < 0.7) await humanCasualScroll(page, { rounds: randInt(1, 2) });
  if (rand() < 0.5) await humanIdleDrift(page);
  await humanThink(page, 900);
}

export const _internals = { randRange, randInt, expWait, lognormalMs };
