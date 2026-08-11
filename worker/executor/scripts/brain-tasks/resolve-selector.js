// worker/executor/scripts/brain-tasks/resolve-selector.js
//
// Közös fogódzó-kereső: először a TANULT szelektorral próbálkozik, aztán a
// beépített tartaléklistával, végül — ha semmi sem talál — menet közben
// Gemini Visionnel felderít és megtanul egy újat.
//
// Használat:
//   const btn = await resolveTarget({ page, log, platform:"linkedin",
//     pageType:"feed_composer", field:"start_post_button",
//     description:"A poszt írását indító gomb a hírfolyam tetején",
//     fallbacks:[...], workflowId, runId });

import { brainFetch, lookupLearnedSelectors, upsertLearnedSelector } from "./brain-api.js";
import { collectDomDigest } from "./dom-digest.js";

async function firstVisible(page, selectors, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      if (!sel) continue;
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 350 })) return { loc, sel };
      } catch {}
    }
    await page.waitForTimeout(250);
  }
  return null;
}

/** Egy felderítő adag beküldése a Brainnek (tanulással együtt). */
export async function sendRecon({
  page,
  platform,
  pageType,
  fields,
  workflowId,
  runId,
  log = () => {},
}) {
  const domDigest = await collectDomDigest(page);
  const shot = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
  if (!shot) throw new Error("Nem sikerült képernyőfotót készíteni.");
  const res = await brainFetch("/api/public/worker/ui-recon-ingest", {
    method: "POST",
    body: {
      platform,
      page_type: pageType,
      url: page.url(),
      screenshot_b64: shot.toString("base64"),
      mime_type: "image/jpeg",
      dom_digest: domDigest,
      fields,
      workflow_id: workflowId ?? null,
      run_id: runId ?? null,
    },
    timeoutMs: 90000,
  });
  log(
    "info",
    `Felderítés: ${pageType} — ${(res?.learned || []).length} új fogódzó tanulva${res?.changed ? " (a felület megváltozott)" : ""}.`,
  );
  return res;
}

export async function resolveTarget({
  page,
  log = () => {},
  platform,
  pageType,
  field,
  description,
  fallbacks = [],
  workflowId = null,
  runId = null,
  timeoutMs = 10000,
  selfHeal = true,
}) {
  // 1. Tanult szelektor
  let learned = null;
  try {
    const map = await lookupLearnedSelectors(platform, pageType);
    learned = map?.[field]?.selector || null;
  } catch (e) {
    log("warn", `Tanult fogódzók lekérése nem sikerült: ${e.message}`);
  }

  const candidates = learned ? [learned, ...fallbacks] : [...fallbacks];
  let hit = await firstVisible(page, candidates, timeoutMs);

  if (hit) {
    if (learned) {
      // Visszajelzés: működött-e a tanult szelektor
      upsertLearnedSelector({
        platform,
        pageType,
        field,
        selector: hit.sel,
        success: hit.sel === learned,
      }).catch(() => {});
      if (hit.sel !== learned) {
        log("warn", `A tanult fogódzó nem talált (${field}), a tartalék működött.`);
      }
    } else {
      upsertLearnedSelector({
        platform,
        pageType,
        field,
        selector: hit.sel,
        learnedFrom: "dom_heuristic",
        success: true,
      }).catch(() => {});
    }
    return hit.loc;
  }

  if (!selfHeal) return null;

  // 2. Önjavítás: fotó + Vision, majd újrapróba az új szelektorral
  log("warn", `Nem találom: ${field} — menet közbeni felderítés indul.`);
  try {
    const res = await sendRecon({
      page,
      platform,
      pageType,
      fields: [{ name: field, description: description || field }],
      workflowId,
      runId,
      log,
    });
    const prop = (res?.proposals || []).find((p) => p.field === field && p.selector);
    if (prop?.selector) {
      hit = await firstVisible(page, [prop.selector], 8000);
      if (hit) {
        log("info", `Önjavítás sikerült: ${field} → ${prop.selector}`);
        upsertLearnedSelector({
          platform,
          pageType,
          field,
          selector: hit.sel,
          success: true,
        }).catch(() => {});
        return hit.loc;
      }
    }
  } catch (e) {
    log("warn", `Önjavítás nem sikerült: ${e.message}`);
  }

  upsertLearnedSelector({
    platform,
    pageType,
    field,
    selector: learned || fallbacks[0] || "n/a",
    success: false,
    notes: "nem található a felületen",
  }).catch(() => {});

  return null;
}
