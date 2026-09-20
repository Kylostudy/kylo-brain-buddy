---
name: Facebook fiók-workflow-k
description: Facebook könyvtár — Facebook 1 (magyar IP/süti) és Facebook 2 (lengyel IP/süti, mert cseh proxy nincs); mindkettő 1-1 magyar telefonszámhoz tartozó Brain-only profil
type: feature
---

- Könyvtár: `workflow_folders` → „Facebook" (brain modul). Ide került a régi „HU Facebook" is.
- **Facebook 1 (HU)** — IPRoyal Magyarország proxy, hu-HU süticsomag.
- **Facebook 2 (PL)** — cseh proxy NINCS a készletben; a HU-hoz legközelebbi elérhető
  a lengyel (IPRoyal Lengyelország), pl-PL süticsomag. Ha később CZ proxyt veszünk,
  ezt át kell állítani.
- Mindkét fiók Brain-only (account-separation memória), magyar telefonszámmal regisztrálva.
- Viselkedés: csak mentett sütikkel belépés, soha nem posztol/kommentel, checkpointnál azonnal leáll
  (facebook-warmup memória).
