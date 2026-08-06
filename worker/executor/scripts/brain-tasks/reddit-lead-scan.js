// worker/executor/scripts/brain-tasks/reddit-lead-scan.js
//
// ÉRDEKLŐDÉS-RADAR beolvasó — a Reddit blokkolja a felhő-szerverek IP-jét,
// ezért a friss posztokat innen, a VPS-ről (lakossági proxy mögül) olvassuk be.
//
// Csak OLVAS. Nem lép be, nem kommentel, nem posztol. A publikus JSON-t kéri
// le a böngészővel, majd a nyers listát elküldi a Brainnek, ami pontozza és
// Telegramon szól.

import { humanWait } from "../humanize.js";
import { brainFetch } from "./brain-api.js";

const MAX_AGE_MINUTES = 120;

async function fetchListing(page, subreddit) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?limit=25&raw_json=1`;
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!res || !res.ok()) return null;
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  const trimmed = (text || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export async function runRedditLeadScan(args) {
  const { page, log } = args;

  // 1) Melyik subredditeket figyeljük? A Brain mondja meg.
  let subreddits = [];
  try {
    const resp = await brainFetch("/api/public/worker/lead-radar-ingest", { method: "GET" });
    subreddits = Array.isArray(resp?.subreddits) ? resp.subreddits : [];
  } catch (e) {
    log("warn", `Nem sikerült lekérni a subreddit-listát: ${e.message}`);
  }
  if (!subreddits.length) {
    subreddits = ["IELTS", "TOEFL", "EnglishLearning", "learnenglish", "CambridgeExams"];
  }

  const nowSec = Date.now() / 1000;
  const items = [];
  let blocked = 0;

  for (const sub of subreddits) {
    const listing = await fetchListing(page, sub);
    if (!listing) {
      blocked++;
      log("warn", `r/${sub}: nem kaptunk JSON-t (blokkolás?)`);
      await humanWait(page, 4000);
      continue;
    }
    for (const child of listing?.data?.children ?? []) {
      const d = child?.data ?? {};
      if (d.stickied || d.over_18) continue;
      const created = Number(d.created_utc || 0);
      if (!created || nowSec - created > MAX_AGE_MINUTES * 60) continue;
      items.push({
        id: String(d.id || ""),
        subreddit: String(d.subreddit || sub),
        title: String(d.title || "").slice(0, 500),
        body: String(d.selftext || "").slice(0, 4000),
        permalink: `https://www.reddit.com${d.permalink || ""}`,
        author: String(d.author || "").slice(0, 64),
        created_utc: created,
      });
    }
    // Emberi tempó a lekérdezések között.
    await humanWait(page, 5000 + Math.floor(Math.random() * 6000));
  }

  log("info", `Érdeklődés-radar: ${items.length} friss poszt, ${blocked} blokkolt subreddit`);

  let ingest = null;
  if (items.length) {
    ingest = await brainFetch("/api/public/worker/lead-radar-ingest", {
      method: "POST",
      body: { items: items.slice(0, 200) },
    });
  }

  return {
    lead_scan: {
      subreddits: subreddits.length,
      blocked,
      collected: items.length,
      alerted: ingest?.alerted ?? 0,
    },
  };
}
