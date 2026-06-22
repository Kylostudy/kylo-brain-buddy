// HumanProfile — emberi viselkedés (Brain).
//
// Poisson-eloszlású várakozás, görbe egérmozgás, alkalmi gépelési hibák.
// Csak szerver oldalon példányosítjuk (a böngészőben futó worker oldali kód
// használja). Nincsenek itt SDK függőségek — tiszta TS, könnyen tesztelhető.

import type {
  BehaviorProfile,
  BehaviorProfileFactory,
  MouseMoveDescriptor,
  Point,
} from "./types";

/** Egyszerű seedelhető PRNG (mulberry32). */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Poisson-mintavétel Knuth-algoritmussal — kicsi mean-ekre elég. */
function poisson(rng: () => number, mean: number): number {
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

class HumanProfile implements BehaviorProfile {
  readonly name = "human" as const;
  readonly module = "brain" as const;
  private rng: () => number;

  constructor(seed: number) {
    this.rng = makeRng(seed);
  }

  async wait(meanMs: number): Promise<void> {
    // Poisson(mean/50)*50ms + kis fix overhead, hogy reálisabb legyen.
    const samples = poisson(this.rng, Math.max(1, meanMs / 50));
    const ms = samples * 50 + 20;
    await new Promise((r) => setTimeout(r, ms));
  }

  async typeText(text: string): Promise<string> {
    // ~2% eséllyel betoldunk egy hibát, amit utána "javítunk" — csak a végső
    // szöveget adjuk vissza, a runner dolga ténylegesen leütni a karaktereket
    // gépelési intervallumokkal.
    let typed = "";
    for (const ch of text) {
      if (this.rng() < 0.02) {
        // Hibás karakter, majd backspace — itt csak modellezzük.
        typed += pickNeighborKey(ch, this.rng);
        typed = typed.slice(0, -1);
      }
      typed += ch;
    }
    return typed;
  }

  describeMouseMove(from: Point, to: Point): MouseMoveDescriptor {
    // Egyszerű 3 pontos Bézier-szerű görbe, kis jitterrel.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const stepCount = Math.max(8, Math.min(40, Math.round(dist / 25)));
    const ctrl: Point = {
      x: from.x + dx * 0.5 + (this.rng() - 0.5) * 60,
      y: from.y + dy * 0.5 + (this.rng() - 0.5) * 60,
    };
    const steps: Point[] = [];
    for (let i = 0; i <= stepCount; i++) {
      const t = i / stepCount;
      const mt = 1 - t;
      const x = mt * mt * from.x + 2 * mt * t * ctrl.x + t * t * to.x;
      const y = mt * mt * from.y + 2 * mt * t * ctrl.y + t * t * to.y;
      steps.push({
        x: x + (this.rng() - 0.5) * 2,
        y: y + (this.rng() - 0.5) * 2,
      });
    }
    return { steps, durationMs: Math.max(180, dist * 2.5) };
  }

  async preClickDelay(): Promise<void> {
    const ms = 180 + Math.floor(this.rng() * 220);
    await new Promise((r) => setTimeout(r, ms));
  }
}

function pickNeighborKey(ch: string, rng: () => number): string {
  // QWERTY-szomszéd hibák — kis választék, nem kell tökéletes.
  const map: Record<string, string> = {
    a: "s", s: "a", d: "f", f: "d", g: "h", h: "g",
    j: "k", k: "j", l: "k", q: "w", w: "q", e: "r",
    r: "e", t: "y", y: "t", u: "i", i: "u", o: "p",
    p: "o", z: "x", x: "z", c: "v", v: "c", b: "n",
    n: "b", m: "n",
  };
  const lower = ch.toLowerCase();
  const sub = map[lower];
  if (!sub) return ch;
  return ch === lower ? sub : sub.toUpperCase();
}

export const humanProfileFactory: BehaviorProfileFactory = {
  create(seed = Date.now()) {
    return new HumanProfile(seed);
  },
};
