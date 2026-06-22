# Worker Contract — Live Recording (1. szakasz)

Ez a dokumentum a saját VPS-en futó Brain workernek mondja meg, hogyan kell
kiszolgálnia a felhasználói **élő böngésző-felvétel** funkciót.

Az architektúra szándékosan úgy van összerakva, hogy **a VPS-en SEMMILYEN
inbound portot ne kelljen kinyitni**:

- A worker **outbound HTTPS-en** poll-ozza a Lovable Cloud (Supabase + TanStack)
  oldalt új felvétel-kérésekért.
- A live screencast és a felhasználói kattintások **Supabase Realtime
  broadcast** csatornán mennek (szintén outbound websocket a worker felől).

---

## 1. Új session lekérése (claim)

A worker rendszeres időközönként (pl. 2 mp-enként) hívja:

```
POST https://kylo-brain-buddy.lovable.app/api/public/worker/record-claim
Authorization: Bearer <WORKER_API_TOKEN>
Content-Type: application/json

{ "workerId": "vps-01" }
```

Válasz:

- `204 No Content` — nincs várakozó session, próbáld újra később.
- `200 OK`:
  ```json
  {
    "session": {
      "id": "uuid",
      "workflowId": "uuid",
      "startUrl": "https://decathlon.hu/...",   // lehet null
      "channel": "record:<sessionId>",
      "startedAt": "2026-06-22T08:30:00Z"
    }
  }
  ```

Amikor `200`-at kapsz, a session DB-ben már `status='active'`.

---

## 2. Supabase Realtime broadcast csatlakozás

A worker `SUPABASE_SERVICE_ROLE_KEY`-vel csatlakozik (azt a secretet a
projekt env-jéből másolod át). A csatorna neve **pontosan ugyanaz, amit a
claim válasz ad**: `record:<sessionId>`.

Node.js példa (`@supabase/supabase-js`):

```js
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { params: { eventsPerSecond: 20 } },
});

const channel = sb.channel(session.channel, {
  config: { broadcast: { self: false, ack: false } },
});

// 1) Fogadd a felhasználói akciókat:
channel.on("broadcast", { event: "click" }, ({ payload }) => {
  // payload = { x, y } normalizált 0..1
  const vw = page.viewportSize().width;
  const vh = page.viewportSize().height;
  page.mouse.click(payload.x * vw, payload.y * vh);
});

channel.on("broadcast", { event: "type" }, ({ payload }) => {
  page.keyboard.type(payload.text);
});

channel.on("broadcast", { event: "key" }, ({ payload }) => {
  page.keyboard.press(payload.key);
});

channel.on("broadcast", { event: "goto" }, ({ payload }) => {
  page.goto(payload.url);
});

channel.on("broadcast", { event: "back" }, () => page.goBack());
channel.on("broadcast", { event: "forward" }, () => page.goForward());
channel.on("broadcast", { event: "reload" }, () => page.reload());

channel.on("broadcast", { event: "stop" }, async ({ payload }) => {
  // payload.save === true → user pipa, false → user X
  await teardown(payload.save);
});

await channel.subscribe();
```

---

## 3. Headed (vagy headless) Playwright + screencast

Indíts el egy Playwright böngészőt (Chromium ajánlott, headless: true bőven
elég, mert a UI a TE oldaladon van — a felhasználó képkockaként látja).

```js
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: undefined,   // szándékosan nincs videó
});
const page = await context.newPage();
if (session.startUrl) await page.goto(session.startUrl);
```

### Screencast (kb. 5 fps)

```js
async function frameLoop() {
  while (!stopped) {
    const buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
    const dataUrl = "data:image/jpeg;base64," + buf.toString("base64");
    await channel.send({
      type: "broadcast",
      event: "frame",
      payload: {
        dataUrl,
        w: 1280,
        h: 800,
        ts: Date.now(),
      },
    });
    await sleep(200);   // 5 fps
  }
}
```

### Navigáció követése

```js
page.on("framenavigated", async (f) => {
  if (f === page.mainFrame()) {
    await channel.send({
      type: "broadcast",
      event: "nav",
      payload: { url: f.url() },
    });
    pushAction({ type: "navigate", url: f.url(), t: Date.now() });
  }
});
```

---

## 4. Akciók rögzítése

A workered minden olyan eseményt, amit visszajátszáskor reprodukálni akarunk,
naplózzon egy lokális `actions[]` tömbbe **AZ AKCIÓ VÉGREHAJTÁSA UTÁN**.

Az akció-séma (a `WorkflowSpec.recorded_actions` mező típusa, lásd
`src/lib/chat.functions.ts`):

```ts
type RecordedAction =
  | { type: "navigate"; url: string; t: number }
  | { type: "click"; selector: string; x?: number; y?: number; text?: string; t: number }
  | { type: "type"; selector: string; value: string; t: number }
  | { type: "key"; key: string; t: number }
  | { type: "scroll"; x: number; y: number; t: number }
  | { type: "wait"; ms: number; t: number };
```

**Selector képzés tipp**: amikor egy kattintás érkezik (x,y), futtass
`page.evaluate`-ot, ami az elemet a koordinátáknál visszafejti és előállít egy
robosztus CSS selectort (preferenciasorrend: `data-testid` → stabil `id` →
egyedi `aria-label` → CSS path 3 mélységig). Ezt küldd vissza a kliensnek
broadcast `action` eseményként is, hogy a sávban látszódjon mit vettél fel:

```js
await channel.send({
  type: "broadcast",
  event: "action",
  payload: { action: { type: "click", selector, x, y, t: Date.now() } },
});
```

---

## 5. Leállás

Amikor megkapod a `stop` broadcast eseményt, vagy a session DB sorát `cancelled`
státuszra állítják:

1. Állítsd le a frame loopot.
2. Zárd be a böngészőt + context-et.
3. **Ne** írj a DB-be (a kliens már elmenti a `saveRecording` szerverfüggvénnyel
   az actions listát). Csak takaríts.
4. Ha hiba történt, frissítsd a session sort `status='failed'`-re és töltsd ki
   az `error` mezőt:
   ```js
   await sb.from("recording_sessions")
     .update({ status: "failed", error: e.message, ended_at: new Date().toISOString() })
     .eq("id", session.id);
   ```

---

## 6. Biztonság

- **A `WORKER_API_TOKEN`-t csak a workered ismerheti.** Bárki azt birtokló
  szervezet képes új `record-claim`-et hívni — de nem tud session-eket
  létrehozni, és a Realtime csatornához külön kell `SUPABASE_SERVICE_ROLE_KEY`.
- **A `SUPABASE_SERVICE_ROLE_KEY`-t soha ne küldd kifelé**, és ne logold.
- A felvett képkockák **sose maradnak** a DB-ben — csak a broadcast
  csatornán mennek át, ami efemer.
- A `recording_sessions.action_log` és a `workflows.spec.recorded_actions`
  marad meg perzisztens. Ne tegyél bele jelszót, csak a felhasználó által
  látható szöveget — gépelésnél a `value` mező a felhasználó beírt szövege,
  bele tartozhat email cím is.

---

## 7. Skálázás

Egynél több worker-példányt is futtathatsz párhuzamosan, mind ugyanazt a
`/record-claim` endpointot hívja. A `status='requested' → 'active'` átállást
atomikus CAS-szel (WHERE status='requested') végzik, így nincs race condition.
Egy session-t egyszerre csak egy worker fog felvenni.
