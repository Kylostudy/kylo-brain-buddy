---
name: vps-worker-repo
description: A VPS worker (Finnország) ugyanebben a repóban él a worker/ mappában — innen módosítunk, majd git pull + docker compose build a VPS-en.
type: preference
---
Szabály: a VPS worker kódja NEM külön repóban van. A worker/ mappa része ennek a projektnek.
- Módosítás Lovable-ben történik (worker/executor/**, worker/orchestrator/**, worker/recorder/**, worker/Dockerfile stb.).
- Deploy a VPS-en: `git pull` → `docker compose build` → `docker compose up -d`.
- A chatben mindig lépésről lépésre le kell írni a Linux parancsokat, amit a user bemásol.
- SOHA nem hagyunk félbe workflow-t: Brain oldal + worker oldal + end-to-end teszt egy menetben.
