---
name: audit-qa-roadmap
description: Kylo Audit prioritások és megvalósult diff-mód részletei
type: feature
---
Prioritás:
1. **Diff-mód (KÉSZ)** — worker minden oldal előtt `/api/public/worker/qa/check-cache` végponton lekérdezi, hogy a (tenant, url, language, skin, page_signature) kombó szerepel-e egy korábbi BEFEJEZETT run coverage sorai közt. Signature = sha1(pathname + sorted DOM texts). Találat esetén AI-hívás nélkül klónozza a régi issue-kat. Alap: `diffMode=true`. Screenshot_hash oszlopba a signature megy — index: `idx_audit_qa_coverage_diff_lookup`.
2. Preset-ek (fordítás/megjelenés, minden skin, minimál skinek is)
3. Ütemezés (napi cron)
4. Funkcionális AI-vs-AI tesztek külön projektként

Export gomb: loading state (`exportingRunId`) blokkolja a duplakattintást, toast.loading → success/error.
