# Kylo Vault — ügynök telepítése a VPS-re

Az ügynök 15 percenként bejelenti a széf állapotát a Brainbe, és letölti,
hogy melyik könyvtárak legyenek szinkronban (amit a Kit felületén állítasz be).

## 1. Beállítófájl

```bash
sudo mkdir -p /etc/kylo-vault /opt/kylo-vault
TOKEN="$(grep -m1 '^WORKER_API_TOKEN=' ~/kylo-worker/worker/.env | cut -d= -f2- | sed 's/^"//;s/"$//')"
[ -n "$TOKEN" ] || { echo "HIBA: a worker token nem található"; exit 1; }
printf 'BRAIN_URL=https://brain.kylosystems.com\nWORKER_API_TOKEN=%s\nVAULT_TENANT_ID=c13c29af-b546-41e3-a4d5-9b3bb3a71326\n' "$TOKEN" | sudo tee /etc/kylo-vault/agent.env >/dev/null
unset TOKEN
sudo chmod 600 /etc/kylo-vault/agent.env
```

## 2. Szkript és időzítő

```bash
sudo cp infra/vault/agent.sh /opt/kylo-vault/agent.sh
sudo chmod +x /opt/kylo-vault/agent.sh
sudo cp infra/vault/kylo-vault-agent.service /etc/systemd/system/
sudo cp infra/vault/kylo-vault-agent.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kylo-vault-agent.timer
```

## 3. Első futás kézzel

```bash
sudo /opt/kylo-vault/agent.sh
cat /etc/kylo-vault/sync-paths.txt
```

Ha a fájl üres, az azt jelenti, hogy még egy könyvtárat sem kapcsoltál be a
Kit felületén — ilyenkor a tükrözés a teljes széfet másolja.

## Hogyan kapcsolódik össze

```text
VPS ügynök  --(15 percenként)-->  Brain  <--(HMAC)--  Kit dashboard
   |  bejelenti: hely, könyvtárak        |  te pipálod: mi legyen szinkronban
   <--(visszakapja a listát)-------------|
   |
   v
mirror.sh  →  csak a kijelölt könyvtárakat tükrözi a 2. lemezre
```
