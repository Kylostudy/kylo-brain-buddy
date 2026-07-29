---
name: futási időablakok
description: Esti 17:00–23:00 budapesti idő = teljes worker-tilalom; bemelegítés csak a fiók/proxy helyi ideje szerint 09:00–21:00 között
type: feature
---

## Gazdi-ablak (abszolút tilalom)
Budapesti idő szerint **17:00–23:00** között SEMMILYEN worker futás nem indulhat:
se bemelegítés, se monitor, se brain task. Ilyenkor a felhasználó a gépen dolgozik.
Az összes cron ütemező (`schedule-reddit-warmups`, `schedule-warmups`,
`enqueue-monitors`, `dispatch-brain-tasks`) az elején ellenőrzi ezt.

## Helyi nappal
Minden bemelegítés a fiók/proxy **saját országa szerinti** 09:00–21:00 között fut.
A szingapúri fiókot szingapúri nappal melegítjük, nem éjjel.

Közös segédmodul: `src/lib/scheduling/quiet-windows.ts`
(`isOwnerBlackout`, `resolveTimezone`, `isLocalDaytime`).
