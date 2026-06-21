# Kylo Systems — Szerver telepítési útmutató

## Röviden: mit kell tenned

1. **Kapcsolódj a szerverhez SSH-val**
2. **Futtasd az installáló scriptet** — ez mindent telepít (Docker, tűzfal, stb.)
3. **Másold át az `infra/` mappát** a szerverre
4. **Indítsd el a rendszert** egy paranccsal

---

## Részletes lépések

### 1. SSH kapcsolódás

Nyiss egy terminált a gépeden (Windows-on PowerShell, Mac/Linux-on Terminal), és írd be:

```bash
ssh root@TE_IP_CIM
```

A `TE_IP_CIM` helyére írd a Hetzner szervered IP címét. A jelszót a Bitwardenben találod.

### 2. Szerver felkészítése

Miután bejelentkeztél, futtasd ezt a parancsot:

```bash
# Töltsd le a telepítő scriptet
curl -fsSL https://raw.githubusercontent.com/kylosystems/infra/main/install.sh | bash
```

**Ha nincs internetkapcsolat a szerveren**, akkor másold át az `install.sh` fájlt a gépedről:

```bash
# A TE gépeden (saját laptopodon), az infra/ mappában:
scp install.sh root@TE_IP_CIM:/tmp/

# Aztán a szerveren:
ssh root@TE_IP_CIM
bash /tmp/install.sh
```

A script **automatikusan**:
- Frissíti az Ubuntut
- Telepíti a Docker-t
- Beállítja a tűzfalat (csak SSH, HTTP, HTTPS engedélyezett)
- Beállítja a Fail2ban-t (támadások ellen)
- Létrehozza a `kylo` felhasználót
- Létrehozza a szükséges mappákat

### 3. Az infra mappa átmásolása

A **saját gépeden** (ahol ez a projekt van), menj az `infra/` mappába, és másold át:

```bash
cd /ahol/a/projekt/van/infra

# Másold át az egész infra mappát a szerverre
scp -r . root@TE_IP_CIM:/opt/kylo/infra/
```

### 4. Környezeti változók beállítása

A szerveren:

```bash
ssh root@TE_IP_CIM
cd /opt/kylo/infra

# Másold a minta fájlt
cp .env.example .env

# Szerkeszd a jelszavakat
nano .env
```

A nano szerkesztőben:
- `POSTGRES_PASSWORD=` **írj be egy erős jelszót**
- `GEMINI_API_KEY=` **írd be a Gemini API kulcsod**
- `SESSION_SECRET=` **generálj egy véletlenszerű kulcsot** (lásd alább)

A `SESSION_SECRET`-hez generálj egy kulcsot:

```bash
openssl rand -hex 32
```

Ezt az értéket másold be a `.env` fájlba.

Mentés a nano-ban: `Ctrl+O`, majd Enter, aztán `Ctrl+X`.

### 5. Rendszer indítása

```bash
cd /opt/kylo/infra
docker compose up -d --build
```

Ez felépíti a konténereket és elindítja őket a háttérben.

### 6. Ellenőrzés

```bash
# Lásd, hogy futnak-e a konténerek
docker compose ps

# Nézd meg a logokat
docker compose logs -f

# Ha csak egy szolgáltatás logját szeretnéd:
docker compose logs -f kylo-brain
```

Ha minden zöld (`healthy` vagy `Up`), akkor kész!

### 7. Elérés

- **KyloBrain**: `http://TE_IP_CIM:3000`
- **KyloKit**: `http://TE_IP_CIM:3001`

---

## Hasznos parancsok

| Parancs | Mit csinál |
|---------|-----------|
| `docker compose ps` | Látod, melyik konténer fut |
| `docker compose logs -f` | Élő logok |
| `docker compose stop` | Leállítja a rendszert |
| `docker compose start` | Elindítja újra |
| `docker compose down` | Teljesen törli a konténereket |
| `docker compose up -d --build` | Újraépít és elindít |
| `docker system prune -a` | Kitakarítja a régi image-eket (óvatosan!) |

---

## Biztonság

- A PostgreSQL és Redis **csak a szerveren belülről** érhető el (nem nyilvános portok)
- A cookie-k tárolója (`/opt/kylo/cookies`) **csak a tulajdonos** számára olvasható
- A tűzfal (UFW) csak a szükséges portokat engedélyezi
- A Fail2ban automatikusan tiltja a gyanús IP címeket

---

## SSL / HTTPS (későbbi lépés)

Amikor készen állsz, telepíthetsz ingyenes SSL tanúsítványt a Let's Encrypt-tel. Ezt később beállítjuk, ha szükséges.

---

## Ha bármi nem működik

1. Nézd meg a logokat: `docker compose logs -f`
2. Ellenőrizd, hogy a `.env` fájlban jó jelszavak vannak-e
3. Győződj meg róla, hogy a 3000 és 3001 portok nincsenek foglalva: `ss -tlnp`
