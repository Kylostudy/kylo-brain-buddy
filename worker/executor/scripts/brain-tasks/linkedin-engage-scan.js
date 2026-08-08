// worker/executor/scripts/brain-tasks/linkedin-engage-scan.js
//
// LINKEDIN "IDEGEN POSZT" RADAR — bejelentkezve végignéz néhány szakmai
// kulcsszót és a hírfolyamot, összeszedi MÁSOK posztjait, és beküldi a
// Brainnek. A Brain dönti el (Gemini), érdemes-e hozzászólni, és Telegramon
// javasol magyar hozzászólást.
//
// CSAK OLVAS. Nem kommentel, nem lájkol.
//
// brain_task mezők: keywords (tömb), max_items (alap 20), positioning (szöveg)

import { humanCasualScroll, humanThink, humanWait, reseedHuman } from "../humanize.js";
import { brainFetch } from "./brain-api.js";

const DEFAULT_KEYWORDS = ["IELTS", "TOEFL", "English learning", "EdTech", "language learning"];

function hashId(...parts) {
  const s = parts.join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `lie_${Math.abs(h).toString(36)}_${s.length}`;
}

async function collectPosts(page, limit) {
  return await page
    .evaluate((max) => {
      const out = [];
      const cards = document.querySelectorAll(
        "div.feed-shared-update-v2, div.update-components-actor__container, li.reusable-search__result-container",
      );
      for (const card of cards) {
        const root = card.closest("div.feed-shared-update-v2") || card;
        const nameEl = root.querySelector(
          ".update-components-actor__title, .update-components-actor__name",
        );
        const headEl = root.querySelector(".update-components-actor__description");
        const bodyEl = root.querySelector(
          ".update-components-text, .feed-shared-update-v2__description",
        );
        const body = ((bodyEl && bodyEl.innerText) || "").replace(/\s+/g, " ").trim();
        if (body.length < 120) continue;
        const linkEl = root.querySelector('a[href*="/feed/update/"], a[href*="/posts/"]');
        out.push({
          author: ((nameEl && nameEl.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 160),
          author_headline: ((headEl && headEl.innerText) || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300),
          permalink: linkEl ? linkEl.href : window.location.href,
          body: body.slice(0, 3000),
        });
        if (out.length >= max) break;
      }
      return out;
    }, limit)
    .catch(() => []);
}

export async function runLinkedInEngageScan({ page, spec, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "linkedin-engage-scan", Date.now()]);

  const max = Math.max(5, Math.min(40, Number(brainTask?.max_items) || 20));
  const keywords =
    Array.isArray(brainTask?.keywords) && brainTask.keywords.length
      ? brainTask.keywords.slice(0, 6)
      : DEFAULT_KEYWORDS;

  // Először a saját hírfolyam — természetes belépés.
  await page
    .goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch(() => {});
  await humanWait(page, 3500);
  if (/\/(login|checkpoint|uas|authwall)/i.test(page.url())) {
    throw new Error("A LinkedIn kijelentkeztetett — Live Browse módban lépj be és mentsd a sütiket.");
  }
  await humanCasualScroll(page, { rounds: 4 }).catch(() => {});
  await humanThink(page, 3000);

  const seen = new Set();
  const posts = [];

  const feedPosts = await collectPosts(page, max);
  for (const p of feedPosts) {
    const id = hashId("feed", p.author, p.body.slice(0, 160));
    if (seen.has(id)) continue;
    seen.add(id);
    posts.push({ external_id: id, ...p });
  }
  log("info", `Hírfolyam: ${posts.length} poszt.`);

  for (const kw of keywords) {
    if (posts.length >= max) break;
    const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(kw)}&sortBy=%22date_posted%22`;
    const ok = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) continue;
    await humanWait(page, 3000);
    await humanCasualScroll(page, { rounds: 3 }).catch(() => {});
    await humanThink(page, 2500);

    const found = await collectPosts(page, max);
    let added = 0;
    for (const p of found) {
      const id = hashId("kw", p.author, p.body.slice(0, 160));
      if (seen.has(id)) continue;
      seen.add(id);
      posts.push({ external_id: id, ...p });
      added += 1;
      if (posts.length >= max) break;
    }
    log("info", `„${kw}”: ${added} új poszt.`);
  }

  let ingest = null;
  if (posts.length) {
    ingest = await brainFetch("/api/public/worker/linkedin-engage-ingest", {
      method: "POST",
      body: { posts, positioning: brainTask?.positioning || null },
      timeoutMs: 180000,
    });
    log("info", `Beküldve a Brainnek: ${posts.length} jelölt poszt.`);
  } else {
    log("info", "Nem találtunk értékelhető idegen posztot.");
  }

  return { linkedin_engage_scan: { collected: posts.length, keywords, ingest } };
}
