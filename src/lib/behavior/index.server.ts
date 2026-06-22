// Egyetlen helyen kötjük össze a modul-fogalmat a viselkedési profillal.
// A workflow `module` mezője alapján a runner ezt a függvényt hívja.

import type { AppModule } from "@/lib/module/types";
import type { BehaviorProfile } from "./types";
import { humanProfileFactory } from "./human.server";
import { robotProfileFactory } from "./robot.server";

export function createBehaviorProfile(module: AppModule, seed?: number): BehaviorProfile {
  return module === "brain"
    ? humanProfileFactory.create(seed)
    : robotProfileFactory.create(seed);
}
