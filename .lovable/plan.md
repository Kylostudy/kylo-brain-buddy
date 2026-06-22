
# Brain + Audit moduláris architektúra

**Alapelv:** Egy kódbázis, két termék. A különbséget a tenant jogosultsága, az aldomain és a viselkedési profil határozza meg — soha nem keveredhetnek.

## 1. Adatbázis változások

### Új tábla: `tenant_module_access` (SOC 2 audit nyomvonal)
Ki, mikor, melyik modulhoz kapott / vesztett hozzáférést.
```
tenant_id (uuid)
module ('brain' | 'audit')
granted_at (timestamptz)
granted_by (uuid | null)        -- Hub user id, ha tőle jött
revoked_at (timestamptz | null)
revoked_by (uuid | null)
source ('hub' | 'manual_dev')   -- honnan jött a jogosultság
```
- RLS: tenant csak a saját sorait olvashatja, írni csak service_role (a Hub szinkron + dev).
- Helper függvény: `public.tenant_has_module(_tenant_id uuid, _module text) returns boolean` (security definer) — ezt használja minden RLS policy.

### Workflow-k modul szerinti szétválasztása
- A `workflows` tábla kap egy `module text not null default 'brain'` oszlopot (`'brain'` vagy `'audit'`).
- Új RLS: csak az a tenant lát workflow-t, akinek van joga az adott modulhoz (`tenant_has_module(tenant_id, module)`).
- Mivel a rendszer üres, nincs migrálandó adat.

### Két fizikailag külön log tábla (SOC 2)
A jelenlegi `workflow_runs` táblát **átnevezzük** `brain_workflow_runs`-ra, és létrehozunk egy **strukturálisan azonos** `audit_workflow_runs` táblát.
- Saját RLS, saját GRANT, saját indexek.
- Soha egy queryben nem JOIN-oltatjuk őket.
- Mindkettőhöz tartozik egy `module` constraint (`check (module = 'brain')` / `check (module = 'audit')`) belt-and-suspenders védelemnek.

## 2. Viselkedési profilok (a futtatómotorban)

Új absztrakció a kódban (`src/lib/behavior/`):
- `BehaviorProfile` interfész — közös API: `moveMouse()`, `type()`, `wait()`, `click()`, stb.
- `HumanProfile` — Poisson egérmozgás, gépelési hibák, gondolkodási szünetek (Brain).
- `RobotProfile` — determinisztikus, gyors, hibamentes (Audit).

A workflow futtatáskor a profil **a workflow `module` mezőjéből** dől el (nem külön user beállítás), így soha nem keveredhet.

## 3. Modul-felismerés és UI

### Modul forrásai (prioritási sorrendben)
1. **Aldomain** (éles): `brain.kylosystems.com` → Brain mód, `audit.kylosystems.com` → Audit mód.
2. **Query param** (preview/dev): `?module=brain` vagy `?module=audit`.
3. **Dev modul-kapcsoló** (preview-n felül egy kis gomb): Brain ↔ Audit váltás, localStorage-ba menti.
4. **Fallback**: Brain.

Egy `useModule()` hook + `ModuleProvider` context — minden komponens innen kérdezi le, melyik módban van.

### Teljes téma (branding)
A `src/styles.css`-ben két téma-blokk:
- **Brain** (alap, már megvan): Kylo zöld primary, success, ring, sidebar.
- **Audit**: kék primary (`oklch(...)`), kék ring, kék success accent — minden Tailwind token átvált.

Aktiválás: `<html data-module="brain">` vagy `data-module="audit"` attribútum, és CSS `[data-module="audit"]` selectorral felülírjuk a tokeneket. Egy CSS fájl, két téma, automatikus váltás.

### UI különbségek modulonként
- Header logó és cím: "Kylo Brain" / "Kylo Audit"
- Ikon: human (Brain) / robot (Audit)
- Szókincs: "human-like automation" vs "automated testing"
- Workflow lista csak az aktuális modul workflow-it mutatja.

## 4. Bejelentkezés

- **Éles**: a Hub kezeli a bejelentkezést, és aldomain alapján irányít. A Hub a tenant létrehozásakor / módosításakor egy webhookkal frissíti a `tenant_module_access` táblát (push szinkron).
- **Dev**: az `/auth` oldal megmarad **PIN-es fejlesztői hátsóajtónak**, csak neked. Ezzel be tudsz jönni Brain és Audit módban is, hogy a UI-t fejleszteni tudd.

## 5. Logolás (Hub-felé 24 óránként)

A Hub-szinkron job naponta egyszer fut (`pg_cron` + szerver route `/api/public/hooks/sync-logs-to-hub`).
- **Két külön payload**, két külön HTTP hívás:
  - `POST {hub}/api/logs/brain` — `brain_workflow_runs` adatai
  - `POST {hub}/api/logs/audit` — `audit_workflow_runs` adatai
- Egyik sem tartalmazza a másik adatait. Soha.
- Sikeres átvitel után `synced_to_hub_at` timestampet írunk a sorra (de nem töröljük — SOC 2 retention).

## 6. Lépések sorrendben

```text
1. Migration: tenant_module_access + tenant_has_module() függvény
2. Migration: workflows.module oszlop + új RLS policy
3. Migration: workflow_runs → brain_workflow_runs átnevezés
                + új audit_workflow_runs tábla
4. Audit téma: src/styles.css [data-module="audit"] blokk
5. ModuleProvider + useModule() hook
6. Aldomain / query param / dev kapcsoló felismerés
7. UI: header branding, ikonok, szókincs modul szerint
8. Workflow lista szűrése modul alapján
9. BehaviorProfile absztrakció (Human + Robot)
10. Dev modul-kapcsoló a preview-n
11. PIN-es /auth bejárat megerősítése (már megvan)
12. (Később) Hub-szinkron szerver route + pg_cron job
13. (Később) audit.kylosystems.com DNS beállítása
```

## 7. Amit ez NEM tartalmaz (külön kör)

- A Hub oldali kód (az a másik projekt — onnan külön kérlek majd push szinkronra).
- A `audit.kylosystems.com` DNS beállítása — ezt akkor csináljuk, ha a modul-szétválasztás kész és teszteltük.
- Mobil alkalmazás (egyelőre nem kell).
- A Hub → Brain webhook implementáció — addig manuálisan állítjuk a `tenant_module_access` táblát dev-ben.

## Technikai részletek

- **`tenant_has_module`** SECURITY DEFINER funkcióként hívható minden RLS-ből, nincs rekurzió.
- **GRANT** minden új táblán: `SELECT, INSERT, UPDATE, DELETE TO authenticated; ALL TO service_role`. Anon nincs (minden tenant-scoped).
- **`data-module`** attribútumot a `ModuleProvider` rakja a `<html>` elemre `useEffect`-ben — server-rendered fallback Brain.
- **Két log tábla = két RLS policy set**, plusz CHECK constraint a `module` oszlopon, hogy DB szinten se kerülhessen rossz sor a rossz táblába.
- **Worker viselkedés**: a workflow futtató (Steel API hívó) a `workflow.module` alapján példányosítja a megfelelő `BehaviorProfile`-t — egyetlen helyen kapcsolja össze a modul-fogalmat a viselkedéssel.
