---
name: pinterest-google-translate
description: Pinterest Live Browse-ban hivatalos Google Fordító Chrome-kiegészítő van betöltve — idegen nyelvű Pinterest angolra fordításához
type: feature
---
# Pinterest + Google Fordító kiegészítő (2026-09-29)

- A Pinterest Live Browse munkamenetekbe be van töltve a HIVATALOS Google Fordító Chrome-kiegészítő (unpacked, worker/recorder/extensions/google-translate/).
- Cél: a felhasználó idegen nyelvű (pl. japán) Pinterestet angolra fordíthasson regisztráció közben — japánul nem beszél.
- A kiegészítő csak Pinterest sessioneknél aktiválódik (isPinterestSession); TRANSLATE_EXTENSION=off környezeti változóval kikapcsolható.
- Kiegészítő betöltéséhez a Pinterest session külön persistent-context böngészőt kap (launchPersistentContext + --load-extension), ugyanazzal a proxyval/UA-val/locale-lel/időzónával.
- A Fordító kiegészítője általában nem botjel — a Pinterest robotjai nem látják (felhasználói értesülés, elfogadva).
