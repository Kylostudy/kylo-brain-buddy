---
name: Behavior profiles
description: HumanProfile (Brain, Poisson, hibázik) vs RobotProfile (Audit, determinisztikus) absztrakció a workflow futtatóhoz
type: feature
---

# Cél

A workflow futtató (Steel / docker runner) ne tudjon véletlenül "rossz" viselkedéssel futtatni egy workflow-t. A `BehaviorProfile` interfész fixálja a viselkedést a futtatás indításakor.

# Hol van

- `src/lib/behavior/types.ts` — `BehaviorProfile` interfész (wait, typeText, describeMouseMove, preClickDelay)
- `src/lib/behavior/human.server.ts` — Poisson várakozás, ~2% gépelési hiba, Bézier-görbe egér jitterrel, 180-400ms reakcióidő
- `src/lib/behavior/robot.server.ts` — fix gyors várakozás, hibamentes gépelés, egyenes egér, 0 reakcióidő
- `src/lib/behavior/index.server.ts` — `createBehaviorProfile(module, seed)` — EZ AZ EGYETLEN HELY, ahol a modul-fogalom és a viselkedés összekötődik

# Használat (jövő)

A runner indításakor: `const profile = createBehaviorProfile(workflow.module, runId.hashCode())` — ezután minden böngészős akció a profilon keresztül megy.

# Szabály

Soha ne példányosíts közvetlenül HumanProfile-t vagy RobotProfile-t — mindig a factory függvényen át, a workflow `module` mezőjével. Így a két viselkedés strukturálisan nem keveredhet.
