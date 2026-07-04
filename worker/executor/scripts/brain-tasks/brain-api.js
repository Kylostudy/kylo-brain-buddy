// worker/executor/scripts/brain-tasks/brain-api.js
// HTTP kliens a Brain publikus worker-API-jához. A tanult szelektorokat és a
// Gemini vision hívásokat itt bonyolítjuk le. Ugyanaz a WORKER_API_TOKEN, mint
// a claim/complete végpontoknál.

const BRAIN_URL = (process.env.BRAIN_URL || "").replace(/\/$/, "");
const WORKER_API_TOKEN = process.env.WORKER_API_TOKEN || "";

function assertConfigured() {
  if (!BRAIN_URL || !WORKER_API_TOKEN) {
    throw new Error(
      "BRAIN_URL / WORKER_API_TOKEN nincs az executor konténer env-jében",
    );
  }
}

async function brainPost(path, body) {
  assertConfigured();
  const res = await fetch(`${BRAIN_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WORKER_API_TOKEN}`,
      "x-worker-token": WORKER_API_TOKEN,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || text || `HTTP ${res.status}`;
    throw new Error(`Brain API ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

/** Lekérjük a tanult szelektorokat egy adott platform+page_type-ra. */
export async function lookupLearnedSelectors(platform, pageType) {
  const data = await brainPost("/api/public/worker/learned-selectors", {
    action: "lookup",
    platform,
    page_type: pageType,
  });
  const map = {};
  for (const row of data.selectors || []) {
    map[row.field] = row;
  }
  return map;
}

/** Elmentjük vagy frissítjük a tanult szelektort. */
export async function upsertLearnedSelector({
  platform,
  pageType,
  field,
  selector,
  learnedFrom = "gemini_vision",
  success = true,
  notes,
}) {
  return brainPost("/api/public/worker/learned-selectors", {
    action: "upsert",
    platform,
    page_type: pageType,
    field,
    selector,
    learned_from: learnedFrom,
    success,
    notes,
  });
}

/**
 * Gemini képelemzés — a Brain hívja a Lovable AI gateway-t.
 * @param {object} args
 * @param {string} args.screenshotB64 – base64 (data URL prefix nélkül)
 * @param {string} args.prompt        – utasítás
 * @param {object=} args.schema       – JSON schema a strukturált válaszhoz
 * @param {"image/png"|"image/jpeg"=} args.mimeType
 * @param {string=} args.model
 */
export async function visionExtract({
  screenshotB64,
  prompt,
  schema,
  mimeType = "image/jpeg",
  model = "google/gemini-2.5-flash",
}) {
  return brainPost("/api/public/worker/vision-extract", {
    screenshot_b64: screenshotB64,
    prompt,
    schema,
    mime_type: mimeType,
    model,
  });
}
