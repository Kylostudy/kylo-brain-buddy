// worker/executor/scripts/brain-tasks/ui-recon.js
//
// FELDERÍTŐ JÁRAT — nézelődés + képernyőfotó + tanulás.
//   - Nem posztol, nem kommentel, nem küld semmit.
//   - Emberi tempóban görget, megáll, olvas, közben fotóz.
//   - A fotókat a Brain elemzi Gemini Visionnel, és megtanulja a fogódzókat.
//
// brain_task mezők:
//   platform (alap "linkedin"), stops (opcionális egyedi lista),
//   open_composer (alap true) — megnyitja-e a poszt-szerkesztőt (elküldés nélkül)

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanThink,
  humanWait,
  reseedHuman,
} from "../humanize.js";
import { sendRecon } from "./resolve-selector.js";

const PRESETS = {
  linkedin: {
    home: "https://www.linkedin.com/feed/",
    stops: [
      {
        page_type: "feed_composer",
        url: "https://www.linkedin.com/feed/",
        fields: [
          {
            name: "start_post_button",
            description: "A poszt írását indító gomb a hírfolyam tetején (Start a post)",
          },
          { name: "search_box", description: "A felső keresőmező" },
        ],
      },
      {
        page_type: "notifications",
        url: "https://www.linkedin.com/notifications/",
        fields: [{ name: "notification_item", description: "Egy értesítés-elem a listában" }],
      },
      {
        page_type: "profile",
        url: "https://www.linkedin.com/in/me/",
        fields: [
          {
            name: "intro_edit_button",
            description:
              "A profil felső intro szakaszának ceruza gombja (Edit intro) — headline szerkesztése",
          },
          {
            name: "about_edit_button",
            description: "A bemutatkozás (About) szakasz szerkesztőgombja vagy 'Add about' gomb",
          },
          {
            name: "experience_add_button",
            description: "A munkatapasztalat (Experience) szakasz '+' vagy 'Add experience' gombja",
          },
          {
            name: "education_add_button",
            description: "A végzettség (Education) szakasz '+' vagy 'Add education' gombja",
          },
          {
            name: "skills_add_button",
            description: "A készségek (Skills) szakasz '+' vagy 'Add skill' gombja",
          },
          {
            name: "profile_photo_button",
            description:
              "A profilképet szerkesztő gomb (avatar körül ceruza vagy 'Add photo' gomb)",
          },
        ],
      },
    ],
    composer: {
      page_type: "post_editor",
      openUrl: "https://www.linkedin.com/feed/?shareActive=true",
      fields: [
        { name: "editor_box", description: "A poszt szövegének beírására szolgáló mező" },
        { name: "post_button", description: "A közzétételt indító gomb (Post)" },
        { name: "add_media_button", description: "Kép/videó csatolása gomb" },
        { name: "close_button", description: "A szerkesztő bezárása gomb" },
      ],
    },
  },
};

export async function runUiRecon({ page, spec, brainTask, log }) {
  reseedHuman([spec?.workflow_id || "", "ui-recon", Date.now()]);

  const platform = (brainTask?.platform || spec?.platform || "linkedin").toLowerCase();
  const preset = PRESETS[platform];
  if (!preset) throw new Error(`Felderítő járat: a(z) "${platform}" platform még nincs beállítva.`);

  const workflowId = spec?.workflow_id || null;
  const taskId = brainTask?.task_id || null;
  const runId = spec?.run_id || null;
  const stops = Array.isArray(brainTask?.stops) && brainTask.stops.length
    ? brainTask.stops
    : preset.stops;
  const openComposer = brainTask?.open_composer !== false;

  log("info", `Felderítő járat indul — ${platform}, ${stops.length} megálló.`);

  await page.goto(preset.home, { waitUntil: "domcontentloaded", timeout: 60000 });
  await humanWait(page, 3000);

  if (/\/(login|checkpoint|uas|authwall)/i.test(page.url())) {
    throw new Error("Nem vagyunk bejelentkezve — friss sütik kellenek a felderítéshez.");
  }

  const results = [];
  let changedAnywhere = false;

  for (const stop of stops) {
    try {
      if (stop.url && page.url() !== stop.url) {
        await page.goto(stop.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await humanWait(page, 2500);
      }
      // Előbb ember módjára nézelődünk, csak utána fotózunk.
      await humanCasualScroll(page, { steps: 3, rounds: 2 });
      await humanBrowseMoment(page);
      await humanThink(page, 2500);
      // Vissza a lap tetejére, hogy a fejléc is látszódjon a fotón.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })).catch(() => {});
      await humanWait(page, 1500);

      const res = await sendRecon({
        page,
        platform,
        pageType: stop.page_type,
        fields: stop.fields || [],
        workflowId,
        runId,
        taskId,
        log,
      });
      changedAnywhere = changedAnywhere || !!res?.changed;
      results.push({
        page_type: stop.page_type,
        learned: (res?.learned || []).map((l) => l.field),
        changed: !!res?.changed,
      });
    } catch (e) {
      log("warn", `Megálló hiba (${stop.page_type}): ${e.message}`);
      results.push({ page_type: stop.page_type, error: e.message });
    }
    await humanThink(page, 3000 + Math.random() * 5000);
  }

  // A poszt-szerkesztő megnyitása — beírás és elküldés NÉLKÜL.
  if (openComposer && preset.composer) {
    try {
      await page.goto(preset.composer.openUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await humanWait(page, 4000);
      const res = await sendRecon({
        page,
        platform,
        pageType: preset.composer.page_type,
        fields: preset.composer.fields,
        workflowId,
        runId,
        taskId,
        log,
      });
      changedAnywhere = changedAnywhere || !!res?.changed;
      results.push({
        page_type: preset.composer.page_type,
        learned: (res?.learned || []).map((l) => l.field),
        changed: !!res?.changed,
      });

      // Bezárjuk a szerkesztőt (Escape) — semmit nem küldünk el.
      await page.keyboard.press("Escape").catch(() => {});
      await humanWait(page, 1500);
      const discard = page
        .locator('button:has-text("Discard"), button:has-text("Elvetés")')
        .first();
      if (await discard.isVisible({ timeout: 2000 }).catch(() => false)) {
        await humanClick(page, discard);
      }
    } catch (e) {
      log("warn", `A poszt-szerkesztő felderítése nem sikerült: ${e.message}`);
      results.push({ page_type: "post_editor", error: e.message });
    }
  }

  // Zárásként még nézelődünk egy kicsit, mint egy valódi ember.
  await page.goto(preset.home, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await humanCasualScroll(page, { steps: 3 });
  await humanBrowseMoment(page);

  log(
    "info",
    `Felderítő járat kész — ${results.length} megálló, ${changedAnywhere ? "felület-változás észlelve" : "nincs érdemi változás"}.`,
  );

  return { ui_recon: { platform, stops: results, changed: changedAnywhere } };
}
