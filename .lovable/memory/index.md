# Project Memory — KyloBrain

## Core
- Hungarian UI and chat responses. Non-technical user — plain language, no jargon.
- KyloBrain is one node in the Kylo ecosystem: Core Hub (tenant/auth/billing entry), Kit, Logic, Audit, Brain (this project), plus Browser/Flow.
- Core Hub is the only entry from outside. It routes tenants to the right module via tunnels. Brain never talks back to Core Hub through the same tunnel.
- Brain + Audit share one codebase, run on two subdomains (`brain.kylosystems.com`, `audit.kylosystems.com`), behavior toggled by `HUMAN_MODE` flag (Brain = human-like Poisson cursor; Audit = bot speed).
- Everything that can go through API goes through API. Browser/Chromium only when no API exists (Steel cost no longer a blocker).
- SOC 2 from day zero. Maximum achievable security is the priority.

## Logging architecture (locked)
- **Direct tenant work** (Core Hub → Brain only): Brain collects its own logs and pushes to Core Hub every 24h under its own tenant ID.
- **Cross-module work** (Kit/Logic/Audit → Brain): Brain logs locally for the duration of the task, returns the log bundle to the caller in the response. Caller appends to its tenant's log stream and pushes to Core Hub. Brain does NOT push these to Core Hub.
- **Two channels per cross-module link**: separate Task channel (work in/result out) and Log channel (only log bundles). Different endpoints, different rate limits, different shared secrets.
- **Bundle signing**: every log bundle is HMAC-SHA256 signed with the channel's shared secret. Idempotency keys on every call.
- **Tenant-scoped events** go back to the caller. **System-level ops events** (node OOM, Chromium crash without tenant context) stay in Brain's own ops log, never carry a tenant ID.
- **Log format**: agreed jointly with each module, not invented unilaterally by Brain. Kit already has a partial logging convention — must ask Kit before fixing format.
- **Retry/recovery**: Brain keeps task log bundles for 7 days under `task_id`, caller can re-fetch via `GET /tasks/{id}/log`.

## Integration order
1. **Kit ↔ Brain** — first, must be stable before moving on.
2. **Logic ↔ Brain** — second.
3. **Audit ↔ Brain** — later.

## Cross-module channel structure (template for all modules)
- Inbound Task endpoint: `POST /api/cross/{module}/task` — HMAC-signed, idempotency key, tenant ID in header.
- Outbound Task callback: caller-provided URL, HMAC-signed.
- Inbound Log re-fetch: `GET /api/cross/{module}/task/{id}/log` — HMAC-signed.
- Two separate shared secrets per module: `{MODULE}_TASK_SECRET`, `{MODULE}_LOG_SECRET`.

## Pending — waiting on user
- Core Hub API spec (URL, auth, audit ingest endpoint, tenant ID format) — user will provide.
- Kit responses on: existing log format/schema, shared secret exchange, callback URL, task schema.
- Logic and Audit prompts to be written only AFTER Kit integration is stable.
