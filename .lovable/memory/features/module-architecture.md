---
name: Module architecture
description: Hogyan dől el futás közben, hogy az app Brain vagy Audit módban fut, és hogyan vált az UI / DB hozzáférés ennek megfelelően
type: feature
---

# Modul-felismerés (src/lib/module/detect.ts)

Prioritás:
1. Aldomain (éles): `brain.kylosystems.com` → brain, `audit.kylosystems.com` → audit
2. `?module=brain|audit` query param — explicit override, localStorage-ba is menti
3. localStorage `kylo.module` — preview-n a dev kapcsoló ide ír
4. Fallback: brain

A `ModuleProvider` (src/lib/module/provider.tsx) kontextusként szétküldi az értéket, és a `<html>`-re ráteszi `data-module="brain|audit"` attribútumot. A CSS `[data-module="audit"]` selector írja át a primary/ring/success tokeneket kékre. Egy CSS fájl, két téma — `src/styles.css` alján.

`useModule()` hook ad vissza: `{ module, meta, setModule, isLockedByDomain }`. `isLockedByDomain` true éles aldomainen — ekkor a dev kapcsoló rejtve.

# DB-szintű elválasztás

- `workflows.module` enum (`brain|audit`), RLS csak akkor enged, ha a tenant_has_module(tenant, module) igaz.
- `brain_workflow_runs` és `audit_workflow_runs` fizikailag külön tábla, mindkettőn CHECK constraint a module oszlopon (belt-and-suspenders).
- `tenant_module_access` SOC 2 audit nyomvonal — kik mikor kaptak / vesztettek modul-hozzáférést.

# Kódbeli pontok, ahol a modul számít

- `src/components/app-sidebar.tsx` — workflow lista szűrése `module`-ra, új workflow `module` mezővel kerül beszúrásra.
- `src/routes/_authenticated.index.tsx` — auto-open utolsó workflow modul szerint, branding (`meta.fullName`, `meta.tagline`).
- `src/routes/_authenticated.tsx` — header címe `meta.fullName`, mellette `ModuleSwitcher`.
- `src/lib/runs.functions.ts` — TODO: ha workflow.module === 'audit', `audit_workflow_runs`-ba kell írni és RobotProfile-t használni. Jelenleg csak Brain runnerek vannak.
