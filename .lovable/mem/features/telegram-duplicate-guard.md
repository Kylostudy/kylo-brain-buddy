---
name: Telegram duplikáció-szűrő
description: Ugyanarra az értesítésre adott többszöri "oké" nem hoz létre újabb választ — a rendszer csak emlékeztet a már jóváhagyott szövegre
type: feature
---

A Telegram webhook minden ágban (Reddit komment, érdeklődés-radar / lead_alerts, LinkedIn) ellenőrzi,
hogy az adott tétel már jóváhagyott (`approved_at` / `status`/`reply_status` = approved) vagy kihagyott-e.

- Már jóváhagyott + újabb „oké/mehet” → nem ment semmit, csak visszaküldi a már érvényben lévő választ `♻️` jelzéssel.
- Már kihagyott + újabb „nem” → csak visszajelzés, nincs művelet.
- Felülbírálás: ha a válasz „válasz:” előtaggal jön, akkor MÓDOSÍTJA a korábbi jóváhagyást.

Indok: a user szándékosan válaszol többször is; a rendszernek kell kiszűrnie a duplikátumot.
