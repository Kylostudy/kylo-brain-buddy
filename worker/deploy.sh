#!/usr/bin/env bash
# =============================================================================
# worker/deploy.sh — Zéró leállású (blue-green) frissítés a VPS-en
# =============================================================================
# Mit csinál, sorban:
#   1. Lehúzza a legfrissebb kódot GitHubról (git pull).
#   2. Megnézi, melyik szín aktív most (blue vagy green) → a MÁSIKAT építi fel.
#   3. Felépíti az executor + recorder image-eket az új kóddal.
#   4. Elindítja az új színt, és megvárja, míg a health végpontja zöld lesz.
#   5. Csak ekkor küldi a régi színt szabályos leállásra (drain): az nem vesz
#      fel új munkát, de a már futókat végigcsinálja (max. 45 perc).
#   6. Elmenti az új aktív színt a .active-color fájlba.
#
# A futó munkák NEM szakadnak félbe. Kézzel:  ./deploy.sh
# =============================================================================

set -euo pipefail

WORKER_DIR="${WORKER_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cd "$WORKER_DIR"

REPO_DIR="${REPO_DIR:-$(cd "$WORKER_DIR/.." && pwd)}"
STATE_FILE="$WORKER_DIR/.active-color"
DRAIN_TIMEOUT_S="${DEPLOY_DRAIN_TIMEOUT_S:-2700}"   # 45 perc a régi színnek
HEALTH_TIMEOUT_S="${DEPLOY_HEALTH_TIMEOUT_S:-300}"  # 5 perc az újnak felállni

log() { echo "[deploy $(date -u +%FT%TZ)] $*"; }

# ---- 0/a. Élő szkript mód: az .env-be bekerül az executor valódi útvonala ----
# Erre azért van szükség, mert az orchestrator a HOST fájlrendszeréről csatolja
# be a szkripteket az executor konténerbe.
ENV_FILE="$WORKER_DIR/.env"
# A LIVE_* beállítások a worker/.env-ből jönnek (kézi futtatásnál is).
# FONTOS: NEM "source"-oljuk a fájlt, mert a jelszavakban lévő speciális
# karakterek (pl. $, !, ^) miatt a shell hibára futna. Soronként olvassuk be.
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r __line || [ -n "$__line" ]; do
    case "$__line" in
      ''|'#'*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    __key="${__line%%=*}"
    __val="${__line#*=}"
    case "$__key" in
      *[!A-Za-z0-9_]*|'') continue ;;
    esac
    # Idézőjelek levágása, ha a teljes értéket körbeveszik
    case "$__val" in
      \"*\") __val="${__val#\"}"; __val="${__val%\"}" ;;
      \'*\') __val="${__val#\'}"; __val="${__val%\'}" ;;
    esac
    export "$__key=$__val"
  done < "$ENV_FILE"
  unset __line __key __val
fi

if [ -f "$ENV_FILE" ] && ! grep -q '^LIVE_EXECUTOR_HOST_DIR=' "$ENV_FILE"; then
  printf '\n# Élő szkript mód: az executor forrásának valódi útvonala a VPS-en\nLIVE_EXECUTOR_HOST_DIR=%s\n' \
    "$WORKER_DIR/executor" >> "$ENV_FILE"
  log "LIVE_EXECUTOR_HOST_DIR beírva a worker/.env fájlba ($WORKER_DIR/executor)"
fi

# ---- 0/b. Gyors útvonal: ha CSAK a becsatolt szkriptek változtak ------------
# Ilyenkor nincs build és nincs színváltás — a következő futás már az új
# kóddal indul. Minden más esetben megy a teljes, zéró leállású blue-green.
live_enabled() {
  [ -f "$WORKER_DIR/executor/.live-off" ] && return 1
  [ -f "$WORKER_DIR/executor/.live-on" ] && return 0
  local mode="${LIVE_MODE:-auto}"
  [ "$mode" = "off" ] && return 1
  [ "$mode" = "on" ] && return 0
  local now start end
  now=$(TZ="${LIVE_TZ:-Europe/Budapest}" date +%H%M)
  start="$(printf '%s' "${LIVE_WINDOW:-17:00-08:00}" | cut -d- -f1 | tr -d ':')"
  end="$(printf '%s' "${LIVE_WINDOW:-17:00-08:00}" | cut -d- -f2 | tr -d ':')"
  if [ "$start" -le "$end" ]; then
    [ "$now" -ge "$start" ] && [ "$now" -lt "$end" ]
  else
    [ "$now" -ge "$start" ] || [ "$now" -lt "$end" ]
  fi
}

if [ "${DEPLOY_FORCE_FULL:-0}" != "1" ] && [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin main --quiet || true
  CHANGED="$(git -C "$REPO_DIR" diff --name-only HEAD origin/main 2>/dev/null || echo "__unknown__")"
  if [ -n "$CHANGED" ] && [ "$CHANGED" != "__unknown__" ]; then
    ONLY_SCRIPTS=1
    while IFS= read -r f; do
      case "$f" in
        worker/executor/run.js|worker/executor/scripts/*) ;;
        *) ONLY_SCRIPTS=0 ;;
      esac
    done <<< "$CHANGED"
    if [ "$ONLY_SCRIPTS" = "1" ] && live_enabled; then
      log "Csak executor szkriptek változtak és az élő mód aktív → gyors frissítés build nélkül."
      exec bash "$WORKER_DIR/sync-scripts.sh"
    fi
    if [ "$ONLY_SCRIPTS" = "1" ]; then
      log "Csak szkriptek változtak, de az élő mód most nincs bekapcsolva → teljes blue-green frissítés."
    fi
  fi
fi


# ---- 1. Melyik szín aktív? --------------------------------------------------
OLD="$(cat "$STATE_FILE" 2>/dev/null || echo "")"
if [ "$OLD" != "blue" ] && [ "$OLD" != "green" ]; then
  # Nincs állapotfájl: kitaláljuk a futó konténerekből.
  if docker ps --format '{{.Names}}' | grep -q 'orchestrator-green'; then
    OLD="green"
  elif docker ps --format '{{.Names}}' | grep -q 'orchestrator-blue'; then
    OLD="blue"
  else
    OLD=""
  fi
fi

if [ -z "$OLD" ]; then
  NEW="blue"
  log "Nincs aktív készlet — első indítás BLUE színnel."
else
  NEW=$([ "$OLD" = "blue" ] && echo "green" || echo "blue")
  log "Aktív most: $OLD → új készlet: $NEW"
fi

# ---- 2. Friss kód -----------------------------------------------------------
log "Kód frissítése GitHubról ($REPO_DIR)…"
git -C "$REPO_DIR" pull --ff-only
# A bash menet közben olvassa a szkriptet: ha a pull épp ezt a fájlt írta át,
# a futó példány összekeveri a régit és az újat. Ezért egyszer újraindítjuk
# magunkat a friss változattal. (Ez a blokk szándékosan közvetlenül a pull után
# áll, hogy a régi változat is ide ugorjon.)
if [ "${DEPLOY_REEXEC:-0}" != "1" ]; then
  export DEPLOY_REEXEC=1 DEPLOY_FORCE_FULL=1
  log "Friss deploy.sh betöltése…"
  exec bash "$WORKER_DIR/deploy.sh"
fi
log "Verzió: $(git -C "$REPO_DIR" rev-parse --short HEAD) — $(git -C "$REPO_DIR" log -1 --pretty=%s)"

# ---- 2b. Széf-fájlkiszolgáló frissítése (archívum olvasás is) -------------
# A deploy a "kylo" userként fut (nincs root), ezért a rendszerfájlokat egy
# rövid életű, a docker-csoporton át indított segédkonténer írja a host
# névterében (nsenter). Ez a lépés SOHA nem buktathatja el a deployt.
FS_SRC="$REPO_DIR/infra/vault/fileserver/server.js"
if [ -f "$FS_SRC" ]; then
  ARCH_DIR="$(grep -E '^ARCHIVE_HOST_DIR=' "$WORKER_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  ARCH_DIR="${ARCH_DIR:-/var/brain/archive}"
  FS_SCRIPT="
set -e
FS_DST=/opt/kylo-vault/fileserver/server.js
DROPIN=/etc/systemd/system/kylo-vault-fileserver.service.d/archive.conf
WANT='[Service]
Environment=ARCHIVE_ROOT=$ARCH_DIR
ReadOnlyPaths=$ARCH_DIR'
mkdir -p /opt/kylo-vault/fileserver /etc/systemd/system/kylo-vault-fileserver.service.d '$ARCH_DIR'
echo \"ARCH: \$(ls -ld '$ARCH_DIR' 2>&1)\"
echo \"ARCH: mp4 fájlok száma: \$(find '$ARCH_DIR' -name '*.mp4' 2>/dev/null | wc -l)\"
echo \"ARCH: \$(ls -la '$ARCH_DIR/videos/remotion-szakmai/de/kozgaz-18.mp4' 2>&1)\"
echo \"ARCH: \$(ls '$ARCH_DIR/videos/remotion-szakmai/de/' 2>&1 | head -5 | tr '\n' ' ')\"
CHG=0
if ! cmp -s '$FS_SRC' \$FS_DST; then cp '$FS_SRC' \$FS_DST; CHG=1; fi
if [ \"\$(cat \$DROPIN 2>/dev/null)\" != \"\$WANT\" ]; then printf '%s\n' \"\$WANT\" > \$DROPIN; CHG=1; fi
if [ \$CHG = 1 ]; then systemctl daemon-reload; systemctl restart kylo-vault-fileserver; echo RESTARTED; else echo UNCHANGED; fi
"
  if [ "$(id -u)" = "0" ]; then
    FS_OUT="$(sh -c "$FS_SCRIPT" 2>&1)" || true
  else
    FS_IMG="$(docker image inspect kylo-executor:latest >/dev/null 2>&1 && echo kylo-executor:latest || echo ubuntu:24.04)"
    FS_OUT="$(timeout 120 docker run --rm --privileged --pid=host --net=host --entrypoint nsenter "$FS_IMG" \
      -t 1 -m -u -i -n -p -- sh -c "$FS_SCRIPT" 2>&1)" || true
  fi
  case "$FS_OUT" in
    *RESTARTED*) log "Fájlkiszolgáló frissítve (archívum: $ARCH_DIR)." ;;
    *UNCHANGED*) log "Fájlkiszolgáló naprakész (archívum: $ARCH_DIR)." ;;
    *) log "FIGYELEM: fájlkiszolgáló frissítése nem sikerült: $(printf '%s' "$FS_OUT" | tail -3)" ;;
  esac
  printf '%s\n' "$FS_OUT" | grep '^ARCH:' | while IFS= read -r l; do log "$l"; done || true
fi

# ---- 2c. Kylo élő frissítés (updates.kylo.study) — sosem buktatja a deployt --
UP_SRC="$REPO_DIR/infra/kylo-updates"
if [ -d "$UP_SRC" ]; then
  UP_SCRIPT="
set -e
mkdir -p /opt/kylo-updates /var/www/updates/kylo/bundles
cp '$UP_SRC/publish.sh' /opt/kylo-updates/publish.sh
cp '$UP_SRC/kylo-live-update.service' '$UP_SRC/kylo-live-update.timer' /etc/systemd/system/
if [ -d /etc/nginx/sites-available ]; then
  cp '$UP_SRC/nginx-updates.conf' /etc/nginx/sites-available/kylo-updates
  ln -sf /etc/nginx/sites-available/kylo-updates /etc/nginx/sites-enabled/kylo-updates
  nginx -t && systemctl reload nginx && echo UP: nginx OK
else echo UP: nincs host nginx; fi
systemctl daemon-reload
systemctl enable --now kylo-live-update.timer
echo UP: timer \$(systemctl is-active kylo-live-update.timer)
echo UP: utolsó napló: \$(tail -2 /var/log/kylo-live-update.log 2>/dev/null | tr '\n' ' ')
"
  if [ "$(id -u)" = "0" ]; then
    UP_OUT="$(sh -c "$UP_SCRIPT" 2>&1)" || true
  else
    UP_IMG="$(docker image inspect kylo-executor:latest >/dev/null 2>&1 && echo kylo-executor:latest || echo ubuntu:24.04)"
    UP_OUT="$(timeout 120 docker run --rm --privileged --pid=host --net=host --entrypoint nsenter "$UP_IMG" \
      -t 1 -m -u -i -n -p -- sh -c "$UP_SCRIPT" 2>&1)" || true
  fi
  printf '%s\n' "$UP_OUT" | tail -8 | while IFS= read -r l; do log "UPDATES: $l"; done || true
fi


# ---- 2d. Szakmai videógyártó: ellenőrzött telepítés (tulajdonosi engedéllyel) --
# A csomag install.sh-ját nem futtatja; a Brain safe-install.sh-ja fut a háttérben,
# külön systemd egységben, hogy a hosszú docker build ne tartsa fel a deployt.
SF_SRC="$REPO_DIR/infra/subject-factory"
if [ -f "$SF_SRC/APPROVED_MANIFEST" ]; then
  SF_SHA="$(tr -dc 'a-f0-9' < "$SF_SRC/APPROVED_MANIFEST" | head -c 64)"
  SF_SCRIPT="
mkdir -p /opt/kylo-subject-factory
cp '$SF_SRC/safe-install.sh' /opt/kylo-subject-factory/safe-install.sh
cp '$SF_SRC/kylo-subject-factory.service.reviewed' /opt/kylo-subject-factory/kylo-subject-factory.service.reviewed
cp '$SF_SRC/report-status.py' /opt/kylo-subject-factory/report-status.py
cp '$SF_SRC/runtime-worker.py' /opt/kylo-subject-factory/runtime-worker.py
cp '$SF_SRC/completion-state.py' /opt/kylo-subject-factory/completion-state.py
cp '$SF_SRC/stop-container.py' /opt/kylo-subject-factory/stop-container.py
cp '$SF_SRC/kylo-subject-factory-report.service' '$SF_SRC/kylo-subject-factory-report.timer' /etc/systemd/system/
mkdir -p /etc/systemd/system/kylo-subject-factory-report.service.d
printf '[Service]\nEnvironment=WORKER_ENV_FILE=$WORKER_DIR/.env\n' > /etc/systemd/system/kylo-subject-factory-report.service.d/worker.conf
systemctl daemon-reload
systemctl enable --now kylo-subject-factory-report.timer
systemctl start --no-block kylo-subject-factory-report.service
echo SF: védett diagnosztikai naplójelentés bekapcsolva
if systemctl is-active --quiet kylo-subject-factory; then echo SF: gyártás fut
elif systemctl is-active --quiet kylo-subject-factory-install; then echo SF: telepítés folyamatban
elif [ ! -f /opt/kylo-subject-factory/releases/${SF_SHA:0:12}/.installed ]; then
  systemctl reset-failed kylo-subject-factory-install 2>/dev/null || true
  systemd-run --unit=kylo-subject-factory-install --collect bash /opt/kylo-subject-factory/safe-install.sh '$SF_SHA' && echo SF: telepítés elindítva
elif python3 /opt/kylo-subject-factory/completion-state.py; then
  # Completed receipts are not permission to restart or regenerate the series.
  install -m 644 '$SF_SRC/kylo-subject-factory.service.reviewed' /etc/systemd/system/kylo-subject-factory.service
  systemctl daemon-reload
  systemctl reset-failed kylo-subject-factory 2>/dev/null || true
  echo SF: gyártási sor befejezve, nincs újraindítás vagy újragyártás
else
  # v3: Chromium crashpad írható HOME/XDG könyvtárat kap a meglévő /tmp-ben.
  # A kész videók és a folytatáshoz használt nyilvántartás változatlan marad.
  SF_FIX=/opt/kylo-subject-factory/.chromium-home-correction-v3-resumed
  if [ ! -e \$SF_FIX ] && systemctl is-failed --quiet kylo-subject-factory; then
    install -m 644 '$SF_SRC/kylo-subject-factory.service.reviewed' /etc/systemd/system/kylo-subject-factory.service
    systemctl daemon-reload
    systemctl reset-failed kylo-subject-factory
    if systemctl start kylo-subject-factory; then
      touch \$SF_FIX
      echo SF: mentési javítással újraindítás kérve, meglévő állapotból folytatva
    else echo SF: újraindítás sikertelen; fi
  else echo SF: telepítve, a gyártó áll: \$(systemctl is-active kylo-subject-factory); fi
fi
echo SF: napló: \$(tail -4 /var/log/kylo-subject-factory-install.log 2>/dev/null | tr '\n' ' ')
echo SF: status: \$(head -c 600 /opt/kylo-subject-factory/work/status.json 2>/dev/null | tr '\n' ' ')
"
  if [ "$(id -u)" = "0" ]; then
    SF_OUT="$(sh -c "$SF_SCRIPT" 2>&1)" || true
  else
    SF_IMG="$(docker image inspect kylo-executor:latest >/dev/null 2>&1 && echo kylo-executor:latest || echo ubuntu:24.04)"
    SF_OUT="$(timeout 120 docker run --rm --privileged --pid=host --net=host --entrypoint nsenter "$SF_IMG" \
      -t 1 -m -u -i -n -p -- sh -c "$SF_SCRIPT" 2>&1)" || true
  fi
  printf '%s\n' "$SF_OUT" | tail -6 | while IFS= read -r l; do log "FACTORY: $l"; done || true
fi

# ---- 2e. Önálló videógyár: csak előkészített (staging) telepítés ------------
# Az install.sh ellenőrzi az ellenőrzőösszegeket és verziózott könyvtárba másol,
# de NEM aktiválja és NEM indítja el a kezelőt — az külön, ellenőrzött lépés.
VF_SRC="$REPO_DIR/infra/video-factory"
if [ -f "$VF_SRC/install.sh" ] && [ -f "$VF_SRC/SHA256SUMS" ]; then
  VF_VER="$(sha256sum "$VF_SRC/SHA256SUMS" | cut -c1-16)"
  VF_SCRIPT="
set -e
mkdir -p /opt/kylo-video-factory
for f in '$VF_SRC'/*; do [ -f \"\$f\" ] || continue; cp \"\$f\" /opt/kylo-video-factory/; done
if [ -d /opt/kylo-video-factory/releases/$VF_VER ]; then
  echo VF: a $VF_VER változat már elő van készítve
else
  if bash /opt/kylo-video-factory/install.sh; then
    echo VF: $VF_VER előkészítve
  else
    echo VF: ELŐKÉSZÍTÉS SIKERTELEN
    exit 1
  fi
fi
echo VF: állapot: \$(ls /opt/kylo-video-factory/releases/ 2>/dev/null | tr '\n' ' ')
python3 /opt/kylo-video-factory/provision-host.py '$WORKER_DIR/.env'
echo VF: szolgáltatás: \$(systemctl is-active kylo-video-factory 2>&1 || true)
"
  if [ "$(id -u)" = "0" ]; then
    VF_OUT="$(sh -c "$VF_SCRIPT" 2>&1)" || true
  else
    VF_IMG="$(docker image inspect kylo-executor:latest >/dev/null 2>&1 && echo kylo-executor:latest || echo ubuntu:24.04)"
    VF_OUT="$(timeout 120 docker run --rm --privileged --pid=host --net=host --entrypoint nsenter "$VF_IMG" \
      -t 1 -m -u -i -n -p -- sh -c "$VF_SCRIPT" 2>&1)" || true
  fi
  printf '%s\n' "$VF_OUT" | tail -40 | while IFS= read -r l; do log "VIDEOFACTORY: $l"; done || true
fi

# ---- 3. Építés (a futó színt ez nem érinti) --------------------------------
log "Executor image építése…"
docker compose build executor-image
log "$NEW készlet építése…"
docker compose --profile "$NEW" build

# ---- 4. Új szín indítása ----------------------------------------------------
# FONTOS: nincs --remove-orphans, különben lelőné a másik színt!
log "$NEW készlet indítása…"
docker compose --profile "$NEW" up -d --no-deps shots
docker compose --profile "$NEW" up -d "orchestrator-$NEW" "recorder-$NEW"

log "Várom, hogy a $NEW készlet egészséges legyen (max ${HEALTH_TIMEOUT_S}s)…"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
ok=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if docker compose exec -T "orchestrator-$NEW" wget -qO- http://127.0.0.1:9090/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 5
done

if [ "$ok" -ne 1 ]; then
  log "HIBA: a $NEW készlet nem lett egészséges. Visszalépés — a régi ($OLD) fut tovább."
  docker compose --profile "$NEW" stop "orchestrator-$NEW" "recorder-$NEW" || true
  docker compose --profile "$NEW" rm -f "orchestrator-$NEW" "recorder-$NEW" || true
  exit 1
fi
log "$NEW készlet egészséges, átveszi a munkát."

# ---- 5. Régi szín szabályos leállítása (drain) ------------------------------
if [ -n "$OLD" ]; then
  log "$OLD készlet szabályos leállítása — a futó munkákat kivárom (max $((DRAIN_TIMEOUT_S/60)) perc)…"
  docker compose --profile "$OLD" stop -t "$DRAIN_TIMEOUT_S" "orchestrator-$OLD" "recorder-$OLD" || true
  docker compose --profile "$OLD" rm -f "orchestrator-$OLD" "recorder-$OLD" || true
  log "$OLD készlet leállt."
fi

# ---- 6. Állapot mentése -----------------------------------------------------
echo "$NEW" > "$STATE_FILE"
log "KÉSZ. Aktív készlet: $NEW"
