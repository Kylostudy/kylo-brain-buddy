# Project Memory

## Core
Brain = Kylo Brain modul, része a Kylo Systems multi-modul ökoszisztémának (Core Hub, Kit, Logic, Audit, Browser, Flow).
Brain + Audit ugyanaz a kódbázis, két subdomain (brain.kylosystems.com + audit.kylosystems.com). Egyetlen különbség: Brain emberi viselkedés (Poisson kurzor, hibázik), Audit bot-szerű (gyors, determinisztikus). Szétválasztást később csináljuk, de NE legyen elfelejtve.
Core Hub a központi kapu (tenant, login, fizetés, SOC 2 audit log gyűjtés GCS-be). Brain → Core Hub: csak audit log push 24 óránként. Core Hub → Brain: tenant irányítás (user belépés után).
Kit ↔ Brain: privát hátsó csatorna, Core Hub erről NEM tud. Kit átadja a tenant_id-t minden Chromium-igényes feladathoz, hogy Brain a saját SOC 2 log-ját az adott tenant nevén tudja vezetni.
Logic ↔ Brain: később bekötendő — Brain ütemezi Logic videó feltöltéseit a social media csatornákra.
SOC 2 a legfontosabb — a 0. perctől kompatibilis kell legyen minden modul.
Felhasználó nem technikai, magyarul kommunikálunk, kerüljük a zsargont.
A user a promptokat Ctrl+C / Ctrl+V-vel viszi át a többi modul chat ablakába (Core Hub, Kit, Logic) — nincs külön gép-gép chat csatorna.

## Memóriák
- Aktuális teendők lent a "Következő lépések" szekcióban.

## Következő lépések (mikor a user visszajön)
1. Megvárjuk a Core Hub válaszát a kiküldött 4 kérdésre (audit ingestion endpoint, tenant ID formátum, modul regisztráció, tenant irányítás).
2. Megvárjuk a Kit válaszát az auth + endpoint + callback + SOC 2 egyezésre.
3. Utána implementáció:
   - SOC 2 audit log tábla a Brain DB-ben (már a 0. perctől)
   - 24 óránkénti push a Core Hub audit ingestion endpoint-jára
   - Kit hátsó csatorna endpoint (`POST /api/kit/submit-task`) megosztott bearer + X-Tenant-ID
   - Core Hub tenant token validáció a Brain belépéskor
4. Később: Brain/Audit szétválasztás flag-gel, Logic integráció (videó ütemezés).
