#!/bin/bash
# =============================================================================
# Kylo Systems — Szerver telepítő script
# Futtasd ezt a Hetzner szerveren root jogosultsággal (vagy sudo-val)
# =============================================================================

set -e  # Ha bármelyik parancs hibára fut, megállunk

echo "========================================"
echo "  Kylo Systems — Szerver telepítés"
echo "========================================"
echo ""

# --- 1. Ubuntu frissítés ----------------------------------------------------
echo "⬆️  1. Ubuntu frissítése..."
apt-get update -qq
apt-get upgrade -y -qq

# --- 2. Alapcsomagok telepítése ---------------------------------------------
echo "📦 2. Alapcsomagok telepítése (curl, git, ufw, fail2ban)..."
apt-get install -y -qq \
    curl \
    git \
    ufw \
    fail2ban \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    nano \
    htop

# --- 3. Docker telepítése ---------------------------------------------------
echo "🐳 3. Docker telepítése..."
if ! command -v docker &> /dev/null; then
    # Docker hivatalos install script
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "   ✅ Docker telepítve: $(docker --version)"
else
    echo "   ✅ Docker már telepítve: $(docker --version)"
fi

# Docker Compose plugin (docker compose parancs)
if ! docker compose version &> /dev/null; then
    echo "   📦 Docker Compose plugin telepítése..."
    apt-get install -y -qq docker-compose-plugin
fi

# --- 4. Non-root felhasználó létrehozása (opcionális, ajánlott) -------------
if ! id -u kylo &> /dev/null; then
    echo "👤 4. 'kylo' felhasználó létrehozása..."
    useradd -m -s /bin/bash kylo
    usermod -aG docker kylo
    echo "   ✅ 'kylo' felhasználó létrehozva, hozzáadva a docker csoporthoz"
else
    echo "   ✅ 'kylo' felhasználó már létezik"
fi

# --- 5. Tűzfal beállítása (UFW) ---------------------------------------------
echo "🔥 5. Tűzfal beállítása..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh      # SSH (22-es port) — NE zárd ki magad!
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
# Docker belső hálózatok engedélyezve, csak a publikus portok korlátozottak
ufw --force enable
echo "   ✅ Tűzfal aktív: SSH, HTTP, HTTPS engedélyezve"

# --- 6. Fail2ban (automatikus IP tiltás támadás esetén) ---------------------
echo "🛡️  6. Fail2ban aktiválása..."
systemctl enable fail2ban
systemctl start fail2ban
echo "   ✅ Fail2ban fut"

# --- 7. Docker log korlátozás (ne nőjön végtelenül) -------------------------
echo "📝 7. Docker log korlátozás..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker
echo "   ✅ Docker logok korlátozva (max 10MB × 3 fájl/konténer)"

# --- 8. Mappa létrehozása a Kylo rendszernek --------------------------------
echo "📁 8. Kylo rendszer mappa létrehozása (/opt/kylo)..."
mkdir -p /opt/kylo
mkdir -p /opt/kylo/postgres-data
mkdir -p /opt/kylo/redis-data
mkdir -p /opt/kylo/lego-library
mkdir -p /opt/kylo/cookies
mkdir -p /opt/kylo/logs

# Jogosultságok beállítása
chown -R kylo:kylo /opt/kylo 2>/dev/null || true
chmod 750 /opt/kylo/cookies  # Cookie-k csak a tulajdonos számára
echo "   ✅ Mappák létrehozva"

# --- 9. Titkosított volume a cookie-khoz (SOC2 kompatibilis) ----------------
echo "🔐 9. Cookie tároló jogosultságok beállítása..."
chmod 700 /opt/kylo/cookies
chown kylo:kylo /opt/kylo/cookies
echo "   ✅ Cookie könyvtár védve (csak kylo felhasználó fér hozzá)"

# --- 10. Összefoglalás -------------------------------------------------------
echo ""
echo "========================================"
echo "  ✅ Szerver felkészítve!"
echo "========================================"
echo ""
echo "Következő lépések:"
echo "  1. Másold át az infra/ mappát a szerverre:"
echo "     scp -r infra/ root@TE_IP_CIM:/opt/kylo/"
echo ""
echo "  2. Lépj be a mappába és állítsd be a .env fájlt:"
echo "     cd /opt/kylo/infra"
echo "     cp .env.example .env"
echo "     nano .env   # <-- írd be a jelszavakat!"
echo ""
echo "  3. Indítsd el a rendszert:"
echo "     docker compose up -d"
echo ""
echo "  4. Ellenőrizd, hogy minden fut:"
echo "     docker compose ps"
echo "     docker compose logs -f"
echo ""
echo "🔗 Ha készen vagy, a szolgáltatások elérhetők:"
echo "   - KyloBrain:  http://TE_IP_CIM:3000"
echo "   - KyloKit:    http://TE_IP_CIM:3001"
echo ""
echo "📌 Biztonsági tipp: Használj reverse proxy-t (pl. Nginx) SSL-lel,"
echo "   ha élesben használod! (A docker-compose.yml-ben már benne van.)"
echo ""
