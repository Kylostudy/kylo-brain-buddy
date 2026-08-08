# Kylo Vault — fájlkiszolgáló a megosztó linkekhez

Ez a kis szolgáltatás a VPS-en fut, és **csak olvasni** tud a széfből.
Kizárólag a Brain hívhatja (a worker tokenjével); a látogatók soha nem érik el
közvetlenül — ők mindig a `https://brain.kylosystems.com/s/<token>` címet látják,
és a Brain folyatja át a fájlt.

## 1. DNS

A Cloudflare-ben vegyél fel egy **A rekordot**:

```
vault.kylosystems.com  →  95.216.224.103   (Proxy: bekapcsolva)
```

## 2. Telepítés a VPS-en

```bash
sudo apt-get update && sudo apt-get install -y zip nodejs
sudo mkdir -p /opt/kylo-vault/fileserver
sudo cp ~/kylo-worker/infra/vault/fileserver/server.js /opt/kylo-vault/fileserver/
sudo cp ~/kylo-worker/infra/vault/fileserver/kylo-vault-fileserver.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kylo-vault-fileserver
```

A token a már meglévő `/etc/kylo-vault/agent.env` fájlból jön
(`WORKER_API_TOKEN`), külön beállítás nem kell.

Ellenőrzés:

```bash
curl -s http://127.0.0.1:8079/health
```

## 3. Nginx (HTTPS a vault aldomainen)

```bash
sudo cp ~/kylo-worker/infra/vault/fileserver/nginx-vault.conf /etc/nginx/sites-available/vault
sudo ln -sf /etc/nginx/sites-available/vault /etc/nginx/sites-enabled/vault
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d vault.kylosystems.com
```

## Biztonság

- Token nélkül minden kérés 401.
- A széf gyökerén kívülre mutató útvonal (`..`) elutasítva.
- Csak `GET`; írás, törlés, feltöltés nincs.
- A systemd egység `ReadOnlyPaths=/srv/kylo-vault` beállítással fut.
