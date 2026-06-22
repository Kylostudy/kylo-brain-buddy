// Viselkedési profil absztrakció.
//
// A workflow futtató (Steel API / docker runner) ezen az interfészen keresztül
// hajt végre minden böngészős akciót. Két konkrét implementáció:
//   - HumanProfile (Brain)  — Poisson-eloszlású egér, gépelési hibák, gondolkodási szünetek
//   - RobotProfile (Audit)  — determinisztikus, gyors, hibamentes
//
// A workflow `module` mezője dönti el, melyik profilt példányosítjuk. A két
// viselkedés soha nem keveredhet, mert a profil a futtatás indításakor egyszer
// fixálódik.

export interface BehaviorProfile {
  readonly name: "human" | "robot";
  readonly module: "brain" | "audit";

  /** Várakozás két akció között — humán: Poisson(mean), robot: pontos érték. */
  wait(meanMs: number): Promise<void>;

  /** Karakter-szintű gépelés (humán hibákkal vagy hibamentesen). */
  typeText(text: string, opts?: { fieldKind?: "text" | "password" | "email" }): Promise<string>;

  /** Egérmozgás A pontból B pontba (humán: görbe + jitter, robot: egyenes). */
  describeMouseMove(from: Point, to: Point): MouseMoveDescriptor;

  /** Kattintás előtti reakcióidő — humán: ~250ms ± szórás, robot: 0. */
  preClickDelay(): Promise<void>;
}

export type Point = { x: number; y: number };

export type MouseMoveDescriptor = {
  /** Köztes pontok a görbén (vagy egyenesen). */
  steps: ReadonlyArray<Point>;
  /** Becsült teljes idő ms-ben. */
  durationMs: number;
};

export interface BehaviorProfileFactory {
  create(seed?: number): BehaviorProfile;
}
