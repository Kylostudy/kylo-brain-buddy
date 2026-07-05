# Project Memory

## Core
Kylo Brain és Kylo Audit egy kódbázisban — modulváltó: aldomain (brain./audit.) éles, query param + dev kapcsoló preview-n.
Brain = zöld téma + emberi viselkedés (Poisson). Audit = kék téma + determinisztikus robot.
Két fizikailag külön log tábla: brain_workflow_runs és audit_workflow_runs. Soha ne keveredjenek (SOC 2).
A bejelentkezést éles módban a Core Hub kezeli; /auth csak fejlesztői PIN-es hátsóajtó a tulajdonosnak.
tenant_module_access tábla mondja meg, melyik tenant melyik modulhoz fér hozzá — service_role írja (Hub webhook + dev seed).
Dark theme, KyloKit dizájn tokenek (lásd src/styles.css). Sose használj hardcode színeket (text-white, bg-black, hex).

## Memories
- [Module architecture](mem://features/module-architecture) — Modul-felismerés rétegek, theme switching, run table routing
- [Behavior profiles](mem://features/behavior-profiles) — HumanProfile vs RobotProfile, mikor mit kell használni
- [Warmup system](mem://features/warmup-system) — 12 IP heti bemelegítés, 1 IP = 1 virtuális ember (fingerprint), 7 nyelvi sablon, óránkénti pg_cron ütemező
