# Brain ↔ VPS Worker ↔ Kylogic — Taszk szerződés

Ez a dokumentum a **véglegesített szerződés**. Amíg itt írásban módosítás nincs, addig ez érvényes minden oldalon (Kylogic hívó, Brain, VPS worker).

Alapelv: **egy taszkot végig kell vinni**. Ha valami félbeszakad, az elveszik. Ezért minden lépésnek (queue → dispatch → claim → execute → complete → callback) van explicit státusza és nyoma az adatbázisban.

---

## 1. Lánc áttekintés

```
Kylogic  ──POST /api/public/cross/kylogic/task──►  Brain
                                                    │
                                                    ▼
                                        brain_task_queue (status=queued, scheduled_utc)
                                                    │
                                        pg_cron 1 percenként:
                                        POST /api/public/cron/dispatch-brain-tasks
                                                    │
                                                    ▼
                                        brain_workflow_runs (status=queued, spec_snapshot.brain_task)
                                                    │
                                        VPS worker POST /api/public/worker/claim
                                                    │
                                                    ▼
                                        worker végrehajtja → POST /api/public/worker/complete
                                                    │
                                                    ▼
                                        Brain frissíti brain_task_queue-t + Kylogic callback
```

---

## 2. Támogatott taszktípusok

| task_type            | Cél                                                | Fanout?              | Jitter        |
| -------------------- | -------------------------------------------------- | -------------------- | ------------- |
| `ping`               | Smoke teszt, semmi valódi művelet                  | nem                  | 0             |
| `publish_video`      | Videó feltöltés minden nyelvi variánsra            | igen (workflow/nyelv)| ±jitter/wf    |
| `metrics_snapshot`   | Egy poszt megtekintések / like / komment számai    | nem                  | 0 (ASAP)      |
| `comments_snapshot`  | Egy poszt kommentjeinek listázása                  | nem                  | 0 (ASAP)      |
| `post_comment_reply` | Konkrét kommentre válasz                           | nem                  | ±7 perc Poisson |

Minden más task_type → 400.

---

## 3. Kylogic → Brain (bejövő)

`POST https://kylo-brain-buddy.lovable.app/api/public/cross/kylogic/task`

Fej: `apikey: <BRAIN_TO_KYLOGIC shared secret>` + Kylogic aláírás (már implementálva).

Body:
```json
{
  "task_id": "kylo_xxxxxx",
  "tenant_id": "<uuid>",
  "callback_url": "https://kylogic.example/webhooks/brain",
  "task_type": "metrics_snapshot",
  "platform": "tiktok",
  "region": "HU",
  "language": "hu",
  "payload": { ... task_type-specifikus ... }
}
```

### Payload sémák

`metrics_snapshot` / `comments_snapshot`:
```json
{
  "platform": "tiktok",
  "region": "HU",
  "account_ref": "kylo_hu_main",   // opcionális, workflow névre matcheli
  "post_url": "https://www.tiktok.com/@kylo/video/123",
  "since_ts": "2026-07-01T00:00:00Z"  // csak comments_snapshot-nál, opcionális
}
```

`post_comment_reply`:
```json
{
  "platform": "tiktok",
  "region": "HU",
  "account_ref": "kylo_hu_main",
  "post_url": "https://www.tiktok.com/@kylo/video/123",
  "parent_comment_id": "7123...",
  "reply_text": "Köszi!",
  "reply_draft_id": "draft_xyz",
  "scheduled_at": "2026-07-04T18:30:00Z"  // opcionális, ASAP ha hiányzik
}
```

`publish_video`: (meglévő, változatlan) — külön dokumentum.

`ping`: `payload: {}` — Brain szinkron OK + audit, worker nem érinti.

---

## 4. Worker claim válasz (Brain → worker)

`POST /api/public/worker/claim` → `200` esetén:

```json
{
  "run": {
    "id": "<run_uuid>",
    "workflowId": "<workflow_uuid>",
    "spec": {
      "platform": "tiktok",
      "region": "HU",
      "fingerprint": { "ua": "...", "viewport": {...}, "locale": "...", "timezone": "..." },
      "run_fingerprint_audit": true,
      "brain_task": {
        "task_id": "<brain_task_queue.id>",
        "kylogic_task_id": "kylo_xxxxxx",
        "task_type": "metrics_snapshot",
        "payload": { ... eredeti payload ... },
        "platform": "tiktok",
        "language": "hu",
        "region": "HU"
      }
    },
    "credentials": { "platform": "...", "username": "...", "password": "...", "cookies": "...", "totpSecret": "...", "proxy": "..." },
    "proxy": { "url": "http://...", "label": "...", "expectedCountry": "HU", "provider": "iproyal" }
  }
}
```

**Worker fontos szabály**: ha `spec.brain_task` létezik → nem a workflow default spec-jét fut, hanem a `brain_task.task_type` szerinti dedikált executor scriptet indítja el a `payload`-dal.

Ha `spec.brain_task` **nincs** → hagyományos scheduled recurring workflow futás (a workflow saját spec-je szerint).

---

## 5. Worker → Brain complete

`POST /api/public/worker/complete`

```json
{
  "runId": "<run_uuid>",
  "status": "succeeded" | "failed" | "cancelled",
  "logs": [{ "ts": "...", "level": "info", "message": "..." }],
  "result": { ... task_type-specifikus, lásd lent ... },
  "error": null,
  "preflight": { ... whoer/fingerprint audit ... }
}
```

### Result shape task_type szerint

`ping`:
```json
{ "pong": true, "worker_time": "2026-07-04T18:30:15Z" }
```

`metrics_snapshot`:
```json
{
  "post_url": "https://...",
  "captured_at": "2026-07-04T18:30:15Z",
  "metrics": {
    "views": 12345,
    "likes": 678,
    "comments": 42,
    "shares": 5,
    "saves": 12   // ha van
  },
  "raw_screenshot_url": null  // opcionális, később
}
```

`comments_snapshot`:
```json
{
  "post_url": "https://...",
  "captured_at": "...",
  "since_ts": "2026-07-01T00:00:00Z",
  "comments": [
    {
      "platform_comment_id": "7123...",
      "author": "@valaki",
      "text": "Szia!",
      "created_at": "2026-07-03T12:00:00Z",
      "like_count": 3,
      "parent_id": null,
      "reply_count": 0
    }
  ]
}
```

`post_comment_reply`:
```json
{
  "reply_draft_id": "draft_xyz",
  "parent_comment_id": "7123...",
  "posted_comment_id": "7124...",   // sikeres esetén
  "posted_at": "2026-07-04T18:30:20Z"
}
```

`publish_video`: meglévő, változatlan.

Hibánál `status: "failed"` + `error: "rövid emberi üzenet"` + `logs` a részletekkel.

---

## 6. Brain → Kylogic callback

Brain a `worker/complete` után automatikusan hívja a `callback_url`-t:

```json
{
  "task_id": "kylo_xxxxxx",
  "tenant_id": "<uuid>",
  "status": "completed" | "failed",
  "result": { ... a worker result-ja ... },
  "error": "..."   // csak ha failed
}
```

Kylogic oldala már fogadja (Phase A callback contract confirmed).

---

## 7. Adatbázis nyomvonalak (idempotencia + audit)

- `brain_task_queue`: `UNIQUE (kylogic_task_id, workflow_id)` — ugyanaz a taszk nem kerül be kétszer.
- `brain_workflow_runs.brain_task_id` → `brain_task_queue.id` link a run oldaláról.
- `kylogic_incoming_task_log`: minden Kylogic-érintő eseményt logol (received/queued/callback.sent/callback.failed).
- Kylogic audit push: `sendKylogicAudit` a Kylogic hub felé (nem blokkoló).

---

## 8. VPS worker oldali TODO (következő fázis)

Ez a lista a worker repóban végzendő munka — **a szerződés ezen felett már véglegesnek tekintendő, nem változik menet közben**.

1. Router: `if (spec.brain_task) → dispatch(brain_task.task_type)` executor.
2. `metrics_snapshot` executor: bejelentkezés cookie-val → post_url megnyitás → DOM/API leolvasás → result összeállítás.
3. `comments_snapshot` executor: bejelentkezés → post_url megnyitás → görgetés a `since_ts`-ig → comments listázás.
4. `post_comment_reply` executor: bejelentkezés → post_url megnyitás → `parent_comment_id` megkeresése → válasz beírás emberi jitterrel → `posted_comment_id` visszaadás.
5. `ping` executor: sync return `{ pong: true }`.
6. Preflight (whoer + fingerprint audit) minden futás előtt (már működik a videó feltöltésnél, ugyanaz).

Sorrend: **1 → 5 → 2 → 3 → 4**. Egyet befejezünk, teszteljük end-to-end, csak utána a következő.
