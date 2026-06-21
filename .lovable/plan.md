## Cél

Egyetlen Hetzner szerveren (95.216.224.103, Ubuntu 24.04 LTS) futtatjuk a **KyloBrain**-t (AI agent / chat backend) és a **KyloKit**-et (Playwright-alapú böngésző-automatizáció, "Dolphin"-szerű izolált profilokkal). A két rendszer **osztozik a szerver erőforrásain** (CPU, RAM, disk, hálózat), de **logikailag és biztonságilag el van választva** egymástól.

---

## Architektúra dióhéjban

```text
                  ┌─────────────────────────────────────┐
                  │     Hetzner szerver (Ubuntu 24)     │
                  │                                     │
   Internet ──►   │  Caddy (reverse proxy, HTTPS)       │
                  │    │                                │
                  │    ├─► brain.kylosystems.com  ──►  KyloBrain konténer
                  │    └─► kit.kylosystems.com    ──►  KyloKit konténer
                  │                                     │
                  │  Docker (közös motor)               │
                  │   ├── kylobrain      (Node/Bun API) │
                  │   ├── kylokit-api    (vezérlő API)  │
                  │   ├── kylokit-worker (Playwright)   │
                  │   │     └── profil-1, profil-2, ... │
                  │   ├── postgres       (közös DB)     │
                  │   └── redis          (közös cache)  │
                  │                                     │
                  │  /opt/kylo/                         │
                  │   ├── brain/   (kód + adat)         │
                  │   ├── kit/     (kód + profilok)     │
                  │   └── shared/  (postgres, redis)    │
                  └─────────────────────────────────────┘
```

**Erőforrás-megosztás** úgy működik, hogy a Docker minden konténernek limitet adunk (pl. KyloBrain max 8 GB RAM, KyloKit worker max 2 GB/böngésző), és a Linux kernel osztja el a maradékot dinamikusan. Ha az egyik pihen, a másik kap többet.

---

## Lépések (sorrendben, ahogy haladunk)

### 1. Szerver alapbeállítás (biztonság először)
- Bejelentkezés SSH-val, root jelszó cseréje
- Új felhasználó (`kylo`) sudo joggal — root SSH letiltása
- SSH-kulcs feltöltése (jelszavas login kikapcsolása)
- Tűzfal (UFW): csak 22, 80, 443 port nyitva
- Fail2ban (brute-force védelem)
- Automatikus biztonsági frissítések

### 2. Alaprendszer (közös platform)
- Docker + Docker Compose telepítés
- Caddy reverse proxy (automatikus Let's Encrypt HTTPS)
- DNS beállítás: `brain.kylosystems.com` és `kit.kylosystems.com` mutasson a szerver IP-jére

### 3. Megosztott szolgáltatások (mindkét app használja)
- **PostgreSQL** konténer — közös adatbázis, két külön sémával/DB-vel (`kylobrain`, `kylokit`)
- **Redis** konténer — közös cache és job queue

### 4. KyloBrain telepítés
- Git repo klónozása `/opt/kylo/brain/`
- `.env` fájl beállítása (DB connection, API kulcsok, Lovable AI Gateway)
- Docker image build + indítás
- Caddy route: `brain.kylosystems.com` → konténer

### 5. KyloKit telepítés (Playwright + izolált profilok)
- Git repo klónozása `/opt/kylo/kit/`
- Playwright Docker image (hivatalos `mcr.microsoft.com/playwright`)
- **Profil-izoláció**: minden böngésző-session külön Docker konténerben fut, saját:
  - user data dir (cookie, localStorage, history)
  - hálózati namespace (opcionálisan proxy-val)
  - fingerprint (user-agent, viewport, timezone, locale)
- Vezérlő API: REST/WebSocket, ami profilonként indít/leállít workert
- Caddy route: `kit.kylosystems.com` → API konténer

### 6. Erőforrás-szabályozás
- Docker `--memory` és `--cpus` limit minden konténerre
- KyloBrain: garantált 4 GB RAM, max 8 GB
- KyloKit worker: 1 GB RAM/böngésző, max 6 párhuzamos worker
- PostgreSQL: 2 GB RAM
- Redis: 512 MB RAM
- Marad ~4 GB rendszerre + burst-re

### 7. Monitoring és backup
- **Uptime Kuma** (egyszerű uptime monitor, saját konténer)
- **Automatikus napi backup**: PostgreSQL dump + KyloKit profilok → külön Hetzner Storage Box (olcsó, ~3 EUR/hó, később)
- Log rotáció (Docker beépített)

---

## Sorrend a mai munkára

**Most rögtön (1. lépés):** szerver biztonságossá tétele. Ez 15-20 perc, utána nyugodtan alhatsz a tudattal, hogy senki nem fog betörni.

Utána lépésenként haladunk, és minden lépés után megmutatom mit csinálunk és miért — nem kell egyszerre mindent megérteni.

---

## Technikai megjegyzések (haladóknak, neked nem kell érteni)

- **Miért Docker és nem natív telepítés?** Mert így a KyloBrain és KyloKit nem zavarja egymást (külön Node verzió, külön függőségek), és egy paranccsal újra lehet rakni az egészet.
- **Miért Caddy és nem Nginx?** Mert automatikusan kezeli a HTTPS tanúsítványokat (Let's Encrypt), nincs külön certbot bohóckodás.
- **Miért közös Postgres és nem két külön?** Erőforrás-takarékosság — egy Postgres instance bőven elbírja mindkét appot, és könnyebb backupolni.
- **Playwright izoláció:** minden session külön konténerben → ha egy oldal megtámadja a böngészőt, nem éri el a többi profilt. Ez a "Dolphin Anty" / "Multilogin" modell, csak nálunk nyílt forrású alapokon.

---

## Mehet?

Ha rábólintasz, kezdjük az **1. lépéssel** (szerver biztonság). Először SSH-zz be (`ssh root@95.216.224.103`), és írd meg, hogy bent vagy — onnan vezetlek lépésről lépésre.
