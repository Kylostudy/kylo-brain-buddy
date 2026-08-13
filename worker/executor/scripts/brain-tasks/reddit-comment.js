// worker/executor/scripts/brain-tasks/reddit-comment.js
//
// JÓVÁHAGYOTT REDDIT VÁLASZ KITEVÉSE.
// Csak olyan szöveget tesz ki, amit Telegramon jóváhagytál.
//
// brain_task mezők:
//   permalink (kötelező) — a poszt vagy komment linkje
//   body      (kötelező) — az angol válasz szövege
//   ref_table, ref_id    — visszajelzéshez (lead_alerts | reddit_comments)
//   dry_run              — ha igaz, csak begépeli, nem küldi el

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
import { resolveTarget } from "./resolve-selector.js";

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

function absolute(url) {
  const u = (url || "").trim();
  if (!u) return "";
  return u.startsWith("http") ? u : `https://www.reddit.com${u.startsWith("/") ? "" : "/"}${u}`;
}

export async function runRedditComment(args) {
  const { page, brainTask, log } = args;
  reseedHuman();

  const url = absolute(brainTask?.permalink);
  const body = (brainTask?.body || "").trim();
  if (!url || !body) throw new Error("Hiányzik a poszt linkje vagy a válasz szövege.");

  const subreddit = (brainTask?.subreddit || "").replace(/^\/?r\//i, "").trim();

  // Emberi körítés: előbb a subreddit / kezdőlap, aztán a konkrét poszt.
  const warmUrl = subreddit
    ? `https://www.reddit.com/r/${subreddit}/`
    : "https://www.reddit.com/";
  await page.goto(warmUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await humanWait(page, 2500);
  await humanCasualScroll(page, { steps: 3, rounds: 2 }).catch(() => {});
  await humanBrowseMoment(page).catch(() => {});

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await humanWait(page, 3500);

  if (/\/login|\/register/i.test(page.url())) {
    throw new Error("A Reddit kijelentkeztetett — friss sütik kellenek.");
  }

  // „Elolvassuk” a posztot, mielőtt válaszolunk.
  await humanCasualScroll(page, { steps: 4, rounds: 2 }).catch(() => {});
  await humanThink(page, 5000);

  const wfId = args.spec?.workflow_id || null;
  const runId = args.spec?.run_id || null;

  const OPENER_FALLBACKS = [
    'button:has-text("Add a comment")',
    'faceplate-tracker[noun="comment_composer"] button',
    '[data-testid="trigger-button"]',
    'shreddit-async-loader[bundlename="comment_composer"] button',
    'comment-composer-host button',
    'div[slot="comment-composer"] button',
    'button[aria-label*="comment" i]',
    'button:has-text("Hozzászólás")',
    'button:has-text("Comentar")',
    'button:has-text("Añadir un comentario")',
  ];
  const EDITOR_FALLBACKS = [
    'shreddit-composer div[contenteditable="true"]',
    'comment-composer-host div[contenteditable="true"]',
    'div[contenteditable="true"][name="body"]',
    'div[role="textbox"][contenteditable="true"]',
    'textarea[name="text"]',
    'textarea[placeholder*="thoughts" i]',
    'textarea[placeholder*="comment" i]',
    'textarea[placeholder*="comentario" i]',
  ];

  // A válaszmező néha csak akkor jelenik meg, ha rákattintunk a „Add a comment” dobozra.
  const openEditor = async () => {
    const opener = await firstVisible(page, OPENER_FALLBACKS, 6000);
    if (opener) {
      await humanClick(page, opener).catch(() => {});
      await humanWait(page, 1800);
    }
    return await resolveTarget({
      page,
      log,
      platform: "reddit",
      pageType: "post_comments",
      field: "comment_editor",
      description: "A poszt alatti válaszíró mező (komment szerkesztő)",
      fallbacks: EDITOR_FALLBACKS,
      workflowId: wfId,
      runId,
      timeoutMs: 15000,
    });
  };

  let editor = await openEditor();

  // Tartalék: ha az új felületen nem találjuk, próbáljuk a régi Redditet,
  // ahol a válaszmező egyszerű <textarea>.
  if (!editor) {
    const oldUrl = url.replace("://www.reddit.com", "://old.reddit.com");
    log("warn", "Az új felületen nincs válaszmező — átváltok a régi Reddit nézetre.");
    await page.goto(oldUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await humanWait(page, 3000);
    editor = await firstVisible(
      page,
      ['div.usertext-edit textarea', 'textarea[name="text"]'],
      12000,
    );
  }

  if (!editor) throw new Error("Nem találom a válasz mezőt a poszt alatt.");

  await humanClick(page, editor).catch(() => {});
  await humanThink(page, 2200);

  const paragraphs = body.split(/\n{2,}/);
  for (let i = 0; i < paragraphs.length; i++) {
    await humanType(page, paragraphs[i], { meanCharMs: 62 });
    if (i < paragraphs.length - 1) {
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await humanThink(page, 1600);
    }
  }
  await humanThink(page, 3000); // átolvassuk küldés előtt

  if (brainTask?.dry_run) {
    log("info", "Próbamenet: a választ begépeltem, de NEM küldtem el.");
    return { reddit_comment: { posted: false, dry_run: true, chars: body.length } };
  }

  const submit = await firstVisible(
    page,
    [
      'button[slot="submit-button"]',
      'shreddit-composer button[type="submit"]',
      'button:has-text("Comment")',
      'button:has-text("Reply")',
      'button:has-text("Küldés")',
    ],
    10000,
  );
  if (!submit) throw new Error("Nem találom a válasz elküldése gombot.");
  await humanClick(page, submit);
  await humanWait(page, 6000);

  log("info", "Válasz kiküldve.");

  // Utána még nézelődünk kicsit — nem tűnünk el azonnal.
  await humanCasualScroll(page, { steps: 3, rounds: 2 }).catch(() => {});
  await humanBrowseMoment(page).catch(() => {});

  let ack = null;
  if (brainTask?.ref_table && brainTask?.ref_id) {
    ack = await brainFetch("/api/public/worker/reddit-reply-posted", {
      method: "POST",
      body: {
        ref_table: brainTask.ref_table,
        ref_id: brainTask.ref_id,
        permalink: page.url(),
      },
      timeoutMs: 30000,
    }).catch((e) => ({ error: e.message }));
  }

  return { reddit_comment: { posted: true, permalink: page.url(), chars: body.length, ack } };
}
