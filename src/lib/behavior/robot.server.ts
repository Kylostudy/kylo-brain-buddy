// RobotProfile — determinisztikus tesztelő (Audit).
//
// Nincs hiba, nincs jitter, gyors. Az audit-futtatás célja, hogy az
// automatizmus a valóságban is reprodukálható legyen, ezért minden időzítés
// fix, minden mozgás egyenes vonal.

import type {
  BehaviorProfile,
  BehaviorProfileFactory,
  MouseMoveDescriptor,
  Point,
} from "./types";

class RobotProfile implements BehaviorProfile {
  readonly name = "robot" as const;
  readonly module = "audit" as const;

  async wait(meanMs: number): Promise<void> {
    // Fix, gyors várakozás — a felére csökkentve, de soha nem 0.
    const ms = Math.max(10, Math.floor(meanMs / 2));
    await new Promise((r) => setTimeout(r, ms));
  }

  async typeText(text: string): Promise<string> {
    return text;
  }

  describeMouseMove(from: Point, to: Point): MouseMoveDescriptor {
    // Egyenes vonal, 4 lépés — elég a kattintáshoz, gyors.
    const steps: Point[] = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      steps.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
    return { steps, durationMs: 40 };
  }

  async preClickDelay(): Promise<void> {
    // Nincs reakcióidő — gép.
  }
}

export const robotProfileFactory: BehaviorProfileFactory = {
  create() {
    return new RobotProfile();
  },
};
