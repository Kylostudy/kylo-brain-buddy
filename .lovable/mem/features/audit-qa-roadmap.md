---
name: audit-qa-roadmap
description: Kylo Audit prioritások és megvalósult diff-mód részletei
type: feature
---
Prioritás:
1. **Diff-mód (KÉSZ)** — worker minden oldal előtt `/api/public/worker/qa/check-cache` végponton lekérdezi, hogy a (tenant, url, language, skin, page_signature) kombó szerepel-e egy korábbi BEFEJEZETT run coverage sorai közt. Signature = sha1(pathname + sorted DOM texts). Találat esetén AI-hívás nélkül klónozza a régi issue-kat. Alap: `diffMode=true`. Screenshot_hash oszlopba a signature megy — index: `idx_audit_qa_coverage_diff_lookup`.
2. **Preset-ek (KÉSZ)** — StartRunDialog + Schedule editor: "Fordítás-teszt" (sok nyelv × magic-school) és "Megjelenés-teszt" (en-GB × mind a skin) gombok. `audit_qa_schedules.preset` tárolja: translation/visual/custom.
3. **Ütemezés (KÉSZ)** — `audit_qa_schedules` tábla (tenant RLS), UI: SchedulesPanel + ScheduleEditor. pg_cron percenként hívja `/api/public/hooks/qa-scheduler`-t apikey headerrel (SUPABASE_PUBLISHABLE_KEY), az enumerálja az esedékes ütemezéseket és sorba teszi a QA runokat (supabaseAdmin + workflow újrahasználat). Next_run_at számítás: `croner` lib.
4. Funkcionális AI-vs-AI tesztek külön projektként

Export gomb: loading state (`exportingRunId`) blokkolja a duplakattintást, toast.loading → success/error.
