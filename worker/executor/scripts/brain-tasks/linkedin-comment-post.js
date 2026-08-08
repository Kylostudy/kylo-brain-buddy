// worker/executor/scripts/brain-tasks/linkedin-comment-post.js
//
// JÓVÁHAGYOTT LINKEDIN HOZZÁSZÓLÁS KITEVÉSE.
// Csak olyan szöveget tesz ki, amit te Telegramon jóváhagytál.
//
// brain_task mezők: comment_id, permalink (kötelező), body (angol szöveg)

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanThink,
  humanType,
  humanWait,
  reseedHuman,
} from "../humanize.js";
import { brainFetch } from "./brain-api.js";

async function firstVisible(page, selectors, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.isVisible({ timeout: 400 })) return loc;
      } catch {}
    }
    await page.waitForTimeout(300);
  }
  return null;
}

export async function runLinkedInCommentPost({ page, brainTask, log }) {
  reseedHuman();

  const url = (brainTask?.permalink || "").trim();
  const body = (brainTask?.body || "").trim();
  const commentId = brainTask?.comment_id || null;
  if (!url || !body) throw new Error("Hiányzik a poszt linkje vagy a hozzászólás szövege.");

  // Emberi körítés: előbb a hírfolyam, aztán a konkrét poszt.
  await page
    .goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch(() => {});
  await humanWait(page, 3000);
  if (/\/(login|checkpoint|uas|authwall)/i.test(page.url())) {
    throw new Error("A LinkedIn kijelentkeztetett — friss sütik kellenek.");
  }
  await humanCasualScroll(page, { rounds: 2 }).catch(() => {});
  await humanBrowseMoment(page).catch(() => {});

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await humanWait(page, 3500);
  await humanCasualScroll(page, { rounds: 2 }).catch(() => {});
  await humanThink(page, 4000); // "elolvassuk" a posztot

  const commentBtn = await firstVisible(page, [
    'button[aria-label*="Comment"]',
    'button[aria-label*="omment"]',
    'button[aria-label*="ozzászól"]',
  ]);
  if (commentBtn) {
    await humanClick(page, commentBtn).catch(() => {});
    await humanWait(page, 1500);
  }

  const editor = await firstVisible(page, [
    'div.ql-editor[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    ".comments-comment-box__form div[contenteditable='true']",
  ]);
  if (!editor) throw new Error("Nem találom a hozzászólás mezőt.");

  await humanClick(page, editor).catch(() => {});
  await humanThink(page, 2000);
  await humanType(page, body);
  await humanThink(page, 2500); // átolvassuk, mielőtt elküldjük

  if (brainTask?.dry_run) {
    log("info", "Próbamenet: a hozzászólást NEM küldtem el.");
    return { linkedin_comment_post: { posted: false, dry_run: true } };
  }

  const submit = await firstVisible(page, [
    'button.comments-comment-box__submit-button--cr',
    'button[class*="comments-comment-box__submit"]',
    'button:has-text("Post")',
    'button:has-text("Küldés")',
  ]);
  if (!submit) throw new Error("Nem találom a hozzászólás elküldése gombot.");
  await humanClick(page, submit);
  await humanWait(page, 4000);
  log("info", "Hozzászólás kiküldve.");

  await humanCasualScroll(page, { rounds: 2 }).catch(() => {});
  await humanBrowseMoment(page).catch(() => {});

  let ack = null;
  if (commentId) {
    ack = await brainFetch("/api/public/worker/linkedin-comment-posted", {
      method: "POST",
      body: { comment_id: commentId, permalink: page.url() },
      timeoutMs: 30000,
    }).catch((e) => ({ error: e.message }));
  }

  return { linkedin_comment_post: { posted: true, permalink: page.url(), ack } };
}
