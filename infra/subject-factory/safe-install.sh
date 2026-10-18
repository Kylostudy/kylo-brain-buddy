#!/usr/bin/env bash
# Brain-féle ellenőrzött telepítő a KyLogic szakmai videógyártójához.
# A csomag saját install.sh-ját SOHA nem futtatja. Helyette:
#  - csak a jóváhagyott manifest-ujjlenyomatú, átvett (receipt.json) csomagot fogadja el,
#  - újraellenőrzi a 16 fájl ujjlenyomatát,
#  - a tar-tartalmat kibontás előtt átvizsgálja (csak sima fájl/mappa, nincs
#    abszolút út, "..", symlink, hardlink, eszközfájl; méret- és darabkorlát),
#  - mindig ÚJ, verziózott mappába bont ki; régit nem ír felül, nem töröl,
#  - az archívumhoz nem nyúl; a Brain által átnézett service-fájlt telepíti.
set -euo pipefail
APPROVED="${1:?approved manifest sha256 kell}"
LOG=/var/log/kylo-subject-factory-install.log
exec >>"$LOG" 2>&1
say() { echo "[safe-install $(date -u +%FT%TZ)] $*"; }
fail() { say "HIBA: $*"; exit 1; }

PKG=/var/brain/factory-packages/subject-20261018-v1
BASE=/opt/kylo-subject-factory
SHORT="${APPROVED:0:12}"
REL="$BASE/releases/$SHORT"
UNIT_SRC="$BASE/kylo-subject-factory.service.reviewed"
IMAGE=kylo-subject-factory:20261018

say "Indul (manifest $SHORT)"
if systemctl is-active --quiet kylo-subject-factory; then say "A gyártás már fut — nincs teendő."; exit 0; fi
if [ -f "$REL/.installed" ]; then say "Már telepítve; nem telepítem újra."; exit 0; fi

command -v docker >/dev/null || fail "nincs docker"
command -v python3 >/dev/null || fail "nincs python3 a hoston"
[ -d /var/brain/archive/videos/remotion-szakmai ] || fail "nincs meglévő szakmai archívum"
[ -f "$PKG/receipt.json" ] || fail "nincs ellenőrzött átvétel (receipt.json)"
grep -q "\"manifest_sha256\":\"$APPROVED\"" "$PKG/receipt.json" || fail "az átvett csomag nem a jóváhagyott"
[ "$(sha256sum "$PKG/SHA256SUMS" | cut -d' ' -f1)" = "$APPROVED" ] || fail "SHA256SUMS eltér a jóváhagyottól"
(cd "$PKG" && sha256sum --quiet -c SHA256SUMS) || fail "fájl-ujjlenyomat eltérés"

mkdir -p "$BASE/releases"
for d in "$BASE" /var/brain; do
  free=$(df -Pk "$d" | awk 'NR==2{print $4}')
  [ "$free" -ge $((5*1024*1024)) ] || fail "kevés szabad hely: $d"
done

if [ -e "$REL" ]; then
  aside="$BASE/releases/.failed-$SHORT-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$REL" "$aside"; say "Félbemaradt korábbi kibontás félretéve: $aside"
fi
mkdir -p "$REL/source"
cat "$PKG"/payload.part-* > "$REL/payload.tar.gz"

python3 - "$REL/payload.tar.gz" "$REL/source" <<'PY' || fail "a csomag tartalma nem biztonságos"
import os, sys, tarfile, posixpath
src, dest = sys.argv[1], os.path.realpath(sys.argv[2])
MAX_TOTAL, MAX_COUNT = 3 * 1024**3, 50000
total = count = 0
with tarfile.open(src, "r:gz") as t:
    members = t.getmembers()
    for m in members:
        count += 1
        n = posixpath.normpath(m.name)
        if m.name.startswith("/") or n == ".." or n.startswith("../") or "\0" in m.name:
            sys.exit(f"tiltott útvonal: {m.name!r}")
        if not (m.isreg() or m.isdir()):
            sys.exit(f"tiltott bejegyzéstípus: {m.name!r}")
        total += m.size
        if total > MAX_TOTAL or count > MAX_COUNT:
            sys.exit("túl nagy kibontott méret vagy túl sok fájl")
    for m in members:
        p = os.path.join(dest, posixpath.normpath(m.name))
        if os.path.commonpath([dest, os.path.realpath(os.path.dirname(p)) if not m.isdir() else os.path.realpath(p)]) != dest:
            sys.exit(f"kilépő útvonal: {m.name!r}")
        if m.isdir():
            os.makedirs(p, mode=0o755, exist_ok=True); continue
        os.makedirs(os.path.dirname(p), mode=0o755, exist_ok=True)
        with t.extractfile(m) as r, open(p, "xb") as w:
            while chunk := r.read(1 << 20): w.write(chunk)
        os.chmod(p, 0o755 if m.mode & 0o111 else 0o644)
print(f"OK: {count} bejegyzés, {total} bájt")
PY
say "Tartalom átvizsgálva és kibontva: $REL/source"
[ -f "$REL/source/infra/subject-factory/Dockerfile" ] || fail "hiányzó Dockerfile"

say "Docker-kép építése…"
docker build -t "$IMAGE" -f "$REL/source/infra/subject-factory/Dockerfile" "$REL/source" || fail "docker build"

mkdir -p "$BASE/work" /var/brain/factory-staging
install -m 644 "$UNIT_SRC" /etc/systemd/system/kylo-subject-factory.service
systemctl daemon-reload
touch "$REL/.installed"
systemctl enable --now kylo-subject-factory
say "TELEPÍTVE, gyártás elindítva: $(systemctl is-active kylo-subject-factory)"
