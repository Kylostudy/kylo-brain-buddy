---
name: Reddit olvasás csak workeren át
description: A Reddit blokkolja a felhő-szerver (Cloudflare) IP-ket — minden Reddit JSON-olvasást a VPS workeren, lakossági proxy mögül kell futtatni
type: constraint
---

- A Brain szerveréről (Cloudflare Worker) indított `reddit.com/*.json` kérés HTML „Blocked" oldalt kap, nem JSON-t. Ezért a régi Reddit Scout és a diskurzus-elemző **soha nem gyűjtött adatot** (0 találat).
- **Szabály:** minden Reddit-olvasás a VPS workeren fut, lakossági (IPRoyal) proxy mögül, `brain_task` feladatként. A szerver csak pontoz, ment és értesít.
- Minta: `reddit_lead_scan` feladattípus → `worker/executor/scripts/brain-tasks/reddit-lead-scan.js` → beküldés a `/api/public/worker/lead-radar-ingest` végpontra.
- Ha egy Reddit-figyelő „0 találat"-ot jelent, előbb blokkolásra kell gyanakodni, nem arra, hogy nincs releváns poszt.
