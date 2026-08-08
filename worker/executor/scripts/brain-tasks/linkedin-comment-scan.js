// worker/executor/scripts/brain-tasks/linkedin-comment-scan.js
//
// LINKEDIN RADAR — bejelentkezve (mentett sütikkel) beolvassa az új
// értesítéseket és a saját posztjaink alatti hozzászólásokat, majd elküldi a
// Brainnek. A Brain fordít magyarra, javasol választ, és Telegramon szól.
//
// CSAK OLVAS. Nem posztol, nem kommentel, nem reagál.
//
// brain_task mezők: max_items (alap 25)

import { humanCasualScroll, humanThink, humanWait, reseedHuman } from "../humanize.js";
import { brainFetch } from "./brain-api.js";

const NOTIFICATIONS = "https://www.linkedin.com/notifications/";
const ACTIVITY = "https://www.linkedin.com/in/me/recent-activity/all/";

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hashId(...parts) {
  const s = parts.join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `li_${Math.abs(h).toString(36)}_${s.length}`;
}

async function ensureLoggedIn(page, log) {
  await page.goto(NOTIFICATIONS, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await humanWait(page, 3000);
  if (/\/(login|checkpoint|uas|authwall)/i.test(page.url())) {
    throw new Error(
      "A LinkedIn kijelentkeztetett — nyisd meg Live Browse módban, lépj be, és mentsd a sütiket.",
    );
  }
  log("info", "Bejelentkezve — értesítések betöltve.");
}

async function readNotifications(page, max, log) {
  await humanCasualScroll(page, { rounds: 3 }).catch(() => {});
  await humanThink(page, 2500);

  const items = await page
    .evaluate((limit) => {
      const out = [];
      const cards = document.querySelectorAll(
        "article.nt-card, .nt-card, li.nt-card-list__item, div[data-finite-scroll-hotkey-item]",
      );
      for (const card of cards) {
        const text = (card.innerText || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const link = card.querySelector("a[href]");
        out.push({
          text: text.slice(0, 1200),
          href: link ? link.href : null,
        });
        if (out.length >= limit) break;
      }
      return out;
    }, max)
    .catch(() => []);

  log("info", `Értesítések beolvasva: ${items.length} db`);

  // Zaj: nem hozzászólás, nem kell róla Telegram (profilmegtekintés, ajánlott
  // hírek, "ismerheted", álláshirdetés, saját poszt statisztika).
  const NOISE =
    /(viewed your profile|megnézte a profilod|you may know|ismerheted|powered by premium|see all views|impressions so far|megjelenítés|view more analytics|is hiring|jobs? you|trending|top news|celebrat|work anniversary|munkaévfordul)/i;

  const metrics = [];
  const out = [];

  for (const n of items) {
    const t = clean(n.text);

    // Saját poszt statisztika kinyerése: ebből metrika lesz, nem üzenet.
    const imp = t.match(/([\d\s.,]+)\s*(impressions|megjelenítés)/i);
    if (imp) {
      const value = Number(String(imp[1]).replace(/[^\d]/g, ""));
      if (Number.isFinite(value) && value > 0) {
        metrics.push({ impressions: value, post_url: n.href || null });
      }
      continue;
    }

    if (NOISE.test(t)) continue;

    const isComment = /commented|hozzászól|replied|válaszolt|reply/i.test(t);
    const isMention = /mentioned you|megemlített/i.test(t);
    if (!isComment && !isMention) continue; // csak igazi beszélgetés érdekel

    const author = t.split(/\s+(commented|mentioned|hozzászólt|említett)/i)[0] || "";
    // Az időbélyeg ("16h") és a számok kihagyása az azonosítóból, hogy
    // ugyanaz az értesítés óránként ne induljon újra.
    const stable = t.replace(/\b\d+\s*(h|d|w|ó|n|hét)\b/gi, "").slice(0, 160);
    out.push({
      external_id: hashId("notif", stable),
      kind: isMention ? "mention" : "comment",
      author: clean(author).slice(0, 160),
      context_title: null,
      permalink: n.href || NOTIFICATIONS,
      body: t,
    });
  }

  log("info", `Ebből valódi beszélgetés: ${out.length} db, statisztika: ${metrics.length} db`);
  return { items: out, metrics };
}

async function readPostComments(page, max, log) {
  const ok = await page
    .goto(ACTIVITY, { waitUntil: "domcontentloaded", timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return [];
  await humanWait(page, 3000);
  await humanCasualScroll(page, { rounds: 4 }).catch(() => {});
  await humanThink(page, 2500);

  const items = await page
    .evaluate((limit) => {
      const out = [];
      const posts = document.querySelectorAll("div.feed-shared-update-v2, article");
      for (const post of posts) {
        const titleEl = post.querySelector(
          ".feed-shared-update-v2__description, .update-components-text",
        );
        const title = ((titleEl && titleEl.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 300);
        const comments = post.querySelectorAll("article.comments-comment-entity, .comments-comment-item");
        for (const c of comments) {
          const who = c.querySelector(
            ".comments-comment-meta__description-title, .comments-post-meta__name-text",
          );
          const headline = c.querySelector(".comments-comment-meta__description-subtitle");
          const bodyEl = c.querySelector(
            ".comments-comment-item__main-content, .update-components-text",
          );
          const body = ((bodyEl && bodyEl.innerText) || "").replace(/\s+/g, " ").trim();
          if (!body) continue;
          out.push({
            author: ((who && who.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 160),
            author_headline: ((headline && headline.innerText) || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 300),
            context_title: title,
            body: body.slice(0, 3000),
            href: window.location.href,
          });
          if (out.length >= limit) return out;
        }
      }
      return out;
    }, max)
    .catch(() => []);

  log("info", `Saját posztok alatti hozzászólások: ${items.length} db`);

  return items.map((c) => ({
    external_id: hashId("comment", c.author, c.body.slice(0, 160)),
    kind: "comment",
    author: c.author,
    author_headline: c.author_headline,
    context_title: c.context_title,
    permalink: c.href,
    body: c.body,
  }));
}

export async function runLinkedInCommentScan({ page, spec, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "linkedin-comment-scan", Date.now()]);
  const max = Math.max(5, Math.min(50, Number(brainTask?.max_items) || 25));

  await ensureLoggedIn(page, log);

  const notif = await readNotifications(page, max, log);
  const comments = await readPostComments(page, max, log);

  const seen = new Set();
  const items = [];
  for (const it of [...comments, ...notif.items]) {
    if (!it.body || seen.has(it.external_id)) continue;
    seen.add(it.external_id);
    items.push(it);
    if (items.length >= max) break;
  }

  let ingest = null;
  if (items.length || notif.metrics.length) {
    ingest = await brainFetch("/api/public/worker/linkedin-comment-ingest", {
      method: "POST",
      body: { items, metrics: notif.metrics },
      timeoutMs: 120000,
    });
    log("info", `Beküldve a Brainnek: ${items.length} beszélgetés, ${notif.metrics.length} metrika.`);
  } else {
    log("info", "Nem találtunk új hozzászólást.");
  }

  return {
    linkedin_comment_scan: {
      collected: items.length,
      notifications: notif.items.length,
      metrics: notif.metrics.length,
      comments: comments.length,
      ingest,
    },
  };
}
