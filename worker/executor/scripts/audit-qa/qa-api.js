// worker/executor/scripts/audit-qa/qa-api.js
// HTTP kliens a Brain QA endpointjaihoz (Bearer WORKER_API_TOKEN).

const BRAIN_URL = (process.env.BRAIN_URL || "").replace(/\/$/, "");
const TOKEN = process.env.WORKER_API_TOKEN || "";

async function post(path, body) {
  if (!BRAIN_URL || !TOKEN) throw new Error("BRAIN_URL / WORKER_API_TOKEN nincs beállítva");
  const res = await fetch(`${BRAIN_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`QA API ${path} → ${res.status}: ${data?.error || text.slice(0, 200)}`);
  return data;
}

export const qaApi = {
  analyze: (payload) => post("/api/public/worker/qa/analyze", payload),
  reportIssue: (payload) => post("/api/public/worker/qa/report-issue", payload),
  reportCoverage: (payload) => post("/api/public/worker/qa/report-coverage", payload),
  uploadScreenshot: (payload) => post("/api/public/worker/qa/upload-screenshot", payload),
  finishRun: (payload) => post("/api/public/worker/qa/finish-run", payload),
};
