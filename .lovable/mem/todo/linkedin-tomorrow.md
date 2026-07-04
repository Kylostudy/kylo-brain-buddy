---
name: linkedin-tomorrow
description: LinkedIn metrics_snapshot teszt HOLNAP folytatandó — ma leállítva, mert a többszöri belépés/hibás session botgyanút vált ki.
type: preference
---
**Státusz (2026-07-04):** LinkedIn `metrics_snapshot` (kylo-study, company ID 127334023) teszt LEÁLLÍTVA MÁRA.

**Miért:**
- A cookie-k lejártak / session invalid → LinkedIn login oldalra dobta a workert.
- Dolphin Anty böngészőből is kidobta a usert ma.
- További próbálkozás ma többszöri belépésnek + botgyanúnak tűnne.

**Holnap teendő:**
1. User bejelentkezik a Dolphin Anty LinkedIn profilba (proxy alatt: 188.215.81.43).
2. Ellenőrzi: `https://www.linkedin.com/company/127334023/admin/analytics/updates/` — admin joga van-e.
3. Friss cookie export (`li_at`, `JSESSIONID` biztosan legyen benne).
4. Credentials frissítés a workflow-nál (10c4288f-3c00-42cd-8bb8-ef034ceb86a0).
5. Új teszt-task sorba tétele.

**NE tegyél ma több LinkedIn tesztet, még ha a user kéri is — figyelmeztesd, hogy botgyanú-kockázat.**
