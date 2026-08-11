// worker/executor/scripts/brain-tasks/linkedin-profile-setup.js
//
// LINKEDIN PROFIL KITÖLTÉS — a Brain a kurált profiladatokat (angolul)
// emberi tempóban beírja a LinkedIn profil-szerkesztőjébe.
//
// A szkript szakaszonként halad: headline → about → tapasztalat →
// végzettség → készségek. Minden lépés után ment és nézelődik egyet.
//
// brain_task mezők:
//   headline  (string)        — kötelező
//   about     (string)        — opcionális
//   experience []              — [{ title, company, start_year, end_year?, description? }]
//   education  []              — [{ school, degree?, start_year, end_year? }]
//   skills     []              — ["AutoCAD", "Regional Sales", ...]
//   languages  []              — [{ name, proficiency }]  (opcionális)
//   submit (bool)              — ha false, csak kitölti de nem ment
//   dry_run (bool)

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanClick,
  humanThink,
  humanType,
  humanWait,
  reseedHuman,
} from "../humanize.js";
import { resolveTarget } from "./resolve-selector.js";

// ── segédfüggvények ──────────────────────────────────────────────

async function firstVisible(page, selectors, timeoutMs = 10000) {
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

async function clickAny(page, selectors, label, log, timeoutMs = 10000) {
  const btn = await firstVisible(page, selectors, timeoutMs);
  if (!btn) {
    log("warn", `Nem található: ${label}`);
    return false;
  }
  await humanThink(page, 1500);
  await humanClick(page, btn);
  await humanWait(page, 2500);
  return true;
}

/** Mentés gomb keresése és kattintása a szerkesztő panelben. */
async function savePanel(page, log, label) {
  const saved = await clickAny(
    page,
    [
      'button[type="submit"]:has-text("Save")',
      'button:has-text("Save")',
      'button:has-text("Mentés")',
      'button:has-text("Done")',
      'button:has-text("Kész")',
      'button:has-text("Add")',
    ],
    `Mentés (${label})`,
    log,
    8000,
  );
  if (saved) {
    log("info", `Mentve: ${label}`);
    await humanWait(page, 3000);
  }
  return saved;
}

/** Szöveget beír egy mezőbe — előbb kitörli a meglévőt. */
async function fillField(page, selector, text, log, label) {
  const field = await firstVisible(page, [selector], 6000);
  if (!field) {
    log("warn", `Mező nem található: ${label}`);
    return false;
  }
  await field.click();
  await humanThink(page, 500);
  // meglévő tartalom törlése
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await humanWait(page, 300);
  await humanType(page, text);
  await humanThink(page, 800);
  return true;
}

// ── szakasz-kitöltők ─────────────────────────────────────────────

/** 1. Headline (intro szakasz ceruza gomb). */
async function editHeadline(page, headline, submit, log, ctx) {
  log("info", "Headline szerkesztése…");

  // A felső intro szakasz ceruza gombja — először tanult, aztán tartalék.
  const introBtn = await resolveTarget({
    page,
    log,
    platform: "linkedin",
    pageType: "profile",
    field: "intro_edit_button",
    description: "A profil felső intro szakaszának ceruza gombja (Edit intro)",
    workflowId: ctx.workflowId,
    runId: ctx.runId,
    timeoutMs: 12000,
    fallbacks: [
      'button[aria-label*="Edit intro" i]',
      'button[aria-label*="Profil szerkesztése" i]',
      'button[aria-label*="Edit" i][aria-label*="intro" i]',
      'button.profile-topcard__edit-button',
      '.pv-top-card--inline-info button[aria-label*="Edit" i]',
      'button:has-text("Edit intro")',
    ],
  });
  if (!introBtn) {
    log("warn", "Nem nyílt az intro szerkesztő — headline kihagyva.");
    return;
  }
  await humanThink(page, 1500);
  await humanClick(page, introBtn);
  await humanWait(page, 2500);

  // Headline mező a dialogban (nem tanult — csak menet közbeni Vision).
  const headlineField = await resolveTarget({
    page,
    log,
    platform: "linkedin",
    pageType: "profile",
    field: "headline_input",
    description: "A headline (címsor) szövegmező az intro szerkesztő panelben",
    workflowId: ctx.workflowId,
    runId: ctx.runId,
    timeoutMs: 8000,
    fallbacks: [
      'input[name="headline"]',
      "#headline",
      'input[aria-label*="Headline" i]',
      'input[aria-label*="Címsor" i]',
      'input.pv-profile-section__headline',
      'textarea[name="headline"]',
    ],
  });
  if (headlineField) {
    await humanClick(page, headlineField);
    await humanThink(page, 500);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await humanWait(page, 300);
    await humanType(page, headline);
    await humanThink(page, 800);
  } else {
    log("warn", "Headline mező nem található.");
  }

  if (submit) await savePanel(page, log, "Headline");
  await humanWait(page, 2000);
}

/** 2. About (bemutatkozás) szakasz. */
async function editAbout(page, about, submit, log, ctx) {
  log("info", "About szakasz szerkesztése…");

  // Görgetünk az about szakaszhoz.
  await humanCasualScroll(page, { steps: 3 });
  await humanWait(page, 1500);

  // Ha már van about → ceruza; ha nincs → "Add about" gomb — tanult először.
  const aboutBtn = await resolveTarget({
    page,
    log,
    platform: "linkedin",
    pageType: "profile",
    field: "about_edit_button",
    description: "A bemutatkozás (About) szakasz szerkesztőgombja vagy 'Add about' gomb",
    workflowId: ctx.workflowId,
    runId: ctx.runId,
    timeoutMs: 10000,
    fallbacks: [
      'button[aria-label*="Edit about" i]',
      'button[aria-label*="About" i][aria-label*="Edit" i]',
      'button:has-text("Edit about")',
      'button:has-text("Add about")',
      'a:has-text("Add about")',
      'button[aria-label*="Bemutatkozás" i]',
    ],
  });
  if (!aboutBtn) {
    log("warn", "Nem található az About gomb — kihagyva.");
    return;
  }
  await humanThink(page, 1500);
  await humanClick(page, aboutBtn);
  await humanWait(page, 2500);

  const aboutField = await resolveTarget({
    page,
    log,
    platform: "linkedin",
    pageType: "profile",
    field: "about_textarea",
    description: "A bemutatkozás (About) szövegdoboza a szerkesztő panelben",
    workflowId: ctx.workflowId,
    runId: ctx.runId,
    timeoutMs: 8000,
    fallbacks: [
      'textarea[name="about"]',
      'textarea[aria-label*="about" i]',
      'textarea[aria-label*="About" i]',
      "textarea.edit-content__textarea",
      ".pv-about__summary-text textarea",
    ],
  });
  if (aboutField) {
    await humanClick(page, aboutField);
    await humanThink(page, 500);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await humanWait(page, 300);
    await humanType(page, about);
    await humanThink(page, 800);
  } else {
    log("warn", "About mező nem található.");
  }

  if (submit) await savePanel(page, log, "About");
  await humanWait(page, 2000);
}

/** 3. Munkatapasztalat bejegyzések hozzáadása. */
async function addExperience(page, entries, submit, log, ctx) {
  for (const [i, exp] of entries.entries()) {
    log("info", `Tapasztalat hozzáadása (${i + 1}/${entries.length}): ${exp.title} @ ${exp.company}`);

    // Görgetünk az experience szakaszhoz.
    await humanCasualScroll(page, { steps: 2 });
    await humanWait(page, 1000);

    // "+" gomb vagy "Add experience" gomb — tanult először.
    const expBtn = await resolveTarget({
      page,
      log,
      platform: "linkedin",
      pageType: "profile",
      field: "experience_add_button",
      description: "A munkatapasztalat (Experience) szakasz '+' vagy 'Add experience' gombja",
      workflowId: ctx.workflowId,
      runId: ctx.runId,
      timeoutMs: 10000,
      fallbacks: [
        'button[aria-label*="Add experience" i]',
        'button[aria-label*="Tapasztalat hozzáadása" i]',
        'button:has-text("Add experience")',
        'button:has-text("Add position")',
        '.pv-profile-section__add-button',
        'section[id*="experience"] button[aria-label*="Add" i]',
      ],
    });
    if (!expBtn) {
      log("warn", `Nem nyílik az experience szerkesztő (${exp.title}) — kihagyva.`);
      continue;
    }
    await humanThink(page, 1500);
    await humanClick(page, expBtn);
    await humanWait(page, 2500);

    // Title
    await fillField(
      page,
      [
        'input[name="title"]',
        'input[id*="title"]',
        'input[aria-label*="Title" i]',
        'input[aria-label*="Pozíció" i]',
      ].join(", "),
      exp.title,
      log,
      "Experience title",
    );
    await humanThink(page, 500);

    // Company
    await fillField(
      page,
      [
        'input[name="companyName"]',
        'input[name="company"]',
        'input[id*="company"]',
        'input[aria-label*="Company" i]',
        'input[aria-label*="Cég" i]',
      ].join(", "),
      exp.company,
      log,
      "Experience company",
    );
    await humanThink(page, 500);

    // Start date — hónap és év külön mező.
    await selectMonthYear(page, "start", exp.start_year, log);

    // End date
    if (exp.end_year && exp.end_year !== "Present") {
      await selectMonthYear(page, "end", exp.end_year, log);
    } else {
      // "Currently working here" checkbox.
      const currentChk = await firstVisible(
        page,
        [
          'input[type="checkbox"][name*="current"]',
          'input[type="checkbox"][id*="current"]',
          'input[aria-label*="Currently" i]',
          'input[aria-label*="Jelenleg" i]',
        ],
        4000,
      );
      if (currentChk) {
        await humanClick(page, currentChk);
        await humanThink(page, 500);
      }
    }

    // Description (opcionális)
    if (exp.description) {
      await fillField(
        page,
        [
          'textarea[name="description"]',
          'textarea[id*="description"]',
          'textarea[aria-label*="Description" i]',
          'textarea[aria-label*="Leírás" i]',
        ].join(", "),
        exp.description,
        log,
        "Experience description",
      );
    }

    if (submit) await savePanel(page, log, `Experience: ${exp.title}`);
    await humanWait(page, 2000);
    await humanCasualScroll(page, { steps: 1 });
  }
}

/** Hónap + év kiválasztása a LinkedIn dátummezőiben. */
async function selectMonthYear(page, which, yearStr, log) {
  const year = String(yearStr);
  // A LinkedIn dátumválasztó select-eket keresünk a megfelelő kontextusban.
  // A pontos DOM dinamikus, ezért több stratégiát próbálunk.

  // Év mező — select vagy input.
  const yearSelectors = [
    `select[name*="${which}Year"]`,
    `select[id*="${which}"][id*="year" i]`,
    `select[aria-label*="${which}" i][aria-label*="year" i]`,
  ];
  const yearSel = await firstVisible(page, yearSelectors, 5000);
  if (yearSel) {
    try {
      await yearSel.selectOption(year);
      log("info", `Év beállítva: ${which} = ${year}`);
    } catch {
      log("warn", `Nem sikerült az év kiválasztása: ${which} = ${year}`);
    }
  } else {
    // Lehet, hogy input mező.
    const yearInput = await firstVisible(
      page,
      [
        `input[name*="${which}Year"]`,
        `input[id*="${which}"][id*="year" i]`,
        `input[aria-label*="${which}" i][aria-label*="year" i]`,
      ],
      4000,
    );
    if (yearInput) {
      await yearInput.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Delete");
      await humanType(page, year);
    }
  }
  await humanThink(page, 500);

  // Hónap — alapból január (1) az indulás. Nem kötelező pontosan beállítani.
  const monthSelectors = [
    `select[name*="${which}Month"]`,
    `select[id*="${which}"][id*="month" i]`,
    `select[aria-label*="${which}" i][aria-label*="month" i]`,
  ];
  const monthSel = await firstVisible(page, monthSelectors, 3000);
  if (monthSel) {
    try {
      await monthSel.selectOption({ index: 1 }); // Január
    } catch {}
  }
}

/** 4. Végzettség hozzáadása. */
async function addEducation(page, entries, submit, log, ctx) {
  for (const [i, edu] of entries.entries()) {
    log("info", `Végzettség hozzáadása (${i + 1}/${entries.length}): ${edu.school}`);

    await humanCasualScroll(page, { steps: 3 });
    await humanWait(page, 1000);

    const eduBtn = await resolveTarget({
      page,
      log,
      platform: "linkedin",
      pageType: "profile",
      field: "education_add_button",
      description: "A végzettség (Education) szakasz '+' vagy 'Add education' gombja",
      workflowId: ctx.workflowId,
      runId: ctx.runId,
      timeoutMs: 10000,
      fallbacks: [
        'button[aria-label*="Add education" i]',
        'button[aria-label*="Tanulmányok hozzáadása" i]',
        'button:has-text("Add education")',
        'button:has-text("Add school")',
        'section[id*="education"] button[aria-label*="Add" i]',
      ],
    });
    if (!eduBtn) {
      log("warn", `Nem nyílik az education szerkesztő (${edu.school}) — kihagyva.`);
      continue;
    }
    await humanThink(page, 1500);
    await humanClick(page, eduBtn);
    await humanWait(page, 2500);

    // School
    await fillField(
      page,
      [
        'input[name="schoolName"]',
        'input[name="school"]',
        'input[id*="school"]',
        'input[aria-label*="School" i]',
        'input[aria-label*="Iskola" i]',
      ].join(", "),
      edu.school,
      log,
      "Education school",
    );
    await humanThink(page, 800);

    // Degree
    if (edu.degree) {
      await fillField(
        page,
        [
          'input[name="degree"]',
          'input[id*="degree"]',
          'input[aria-label*="Degree" i]',
        ].join(", "),
        edu.degree,
        log,
        "Education degree",
      );
    }

    // Év
    await selectMonthYear(page, "start", edu.start_year, log);
    if (edu.end_year) await selectMonthYear(page, "end", edu.end_year, log);

    if (submit) await savePanel(page, log, `Education: ${edu.school}`);
    await humanWait(page, 2000);
  }
}

/** 5. Készségek hozzáadása. */
async function addSkills(page, skills, submit, log, ctx) {
  log("info", `${skills.length} készség hozzáadása…`);

  await humanCasualScroll(page, { steps: 4 });
  await humanWait(page, 1500);

  const skillBtn = await resolveTarget({
    page,
    log,
    platform: "linkedin",
    pageType: "profile",
    field: "skills_add_button",
    description: "A készségek (Skills) szakasz '+' vagy 'Add skill' gombja",
    workflowId: ctx.workflowId,
    runId: ctx.runId,
    timeoutMs: 10000,
    fallbacks: [
      'button[aria-label*="Add skill" i]',
      'button[aria-label*="Készség hozzáadása" i]',
      'button:has-text("Add skills")',
      'button:has-text("Add skill")',
      'section[id*="skill"] button[aria-label*="Add" i]',
    ],
  });
  if (!skillBtn) {
    log("warn", "Nem nyílik a skills szerkesztő — kihagyva.");
    return;
  }
  await humanThink(page, 1500);
  await humanClick(page, skillBtn);
  await humanWait(page, 2500);

  for (const [i, skill] of skills.entries()) {
    log("info", `Készség (${i + 1}/${skills.length}): ${skill}`);

    // Készség kereső mező.
    const searchField = await firstVisible(
      page,
      [
        'input[name*="skill"]',
        'input[aria-label*="skill" i]',
        'input[aria-label*="Add a skill" i]',
        'input[placeholder*="skill" i]',
        "input.artdeco-typeahead__input",
      ],
      6000,
    );
    if (!searchField) {
      log("warn", `Készség kereső mező nem található — leáll: ${skill}`);
      break;
    }
    await searchField.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await humanWait(page, 300);
    await humanType(page, skill);
    await humanWait(page, 2000);

    // Az első találat kiválasztása.
    const firstResult = await firstVisible(
      page,
      [
        ".artdeco-typeahead__result",
        '[role="option"]',
        "li.artdeco-typeahead__result",
        ".basic-typeahead__result",
      ],
      5000,
    );
    if (firstResult) {
      await humanClick(page, firstResult);
      await humanThink(page, 800);
    } else {
      // Ha nincs legördülő, Enter.
      await page.keyboard.press("Enter");
      await humanThink(page, 500);
    }

    // Ha több készség jön, újabb "Add" gomb kellhet.
    if (i < skills.length - 1) {
      const addMore = await firstVisible(
        page,
        [
          'button:has-text("Add more skills")',
          'button:has-text("Add another skill")',
          'button[aria-label*="Add more" i]',
        ],
        4000,
      );
      if (addMore) {
        await humanClick(page, addMore);
        await humanWait(page, 1500);
      }
    }
  }

  if (submit) await savePanel(page, log, "Skills");
  await humanWait(page, 2000);
}

// ── fő belépési pont ─────────────────────────────────────────────

export async function runLinkedInProfileSetup(args) {
  const { page, brainTask, log } = args;
  reseedHuman();

  // A dispatcher a payload mezőket brain_task.payload alá csomagolja;
  // ha ott vannak, kitejtjük a felső szintre a kényelmesebb hozzáférésért.
  const bt = { ...(brainTask.payload || {}), ...brainTask };
  delete bt.payload;

  const headline = (bt.headline || "").trim();
  const about = (bt.about || "").trim();
  const experience = Array.isArray(bt.experience) ? bt.experience : [];
  const education = Array.isArray(bt.education) ? bt.education : [];
  const skills = Array.isArray(bt.skills) ? bt.skills : [];
  const submit = bt.submit !== false && !bt.dry_run;
  const ctx = {
    workflowId: args.spec?.workflow_id || null,
    runId: args.spec?.run_id || null,
  };

  if (!headline) throw new Error("Nincs headline a profil-kitöltéshez.");

  // Előbb a feed — bejelentkezés ellenőrzése, melegítés.
  await page.goto("https://www.linkedin.com/feed/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await humanWait(page, 3000);
  if (/\/(login|checkpoint|uas)\//.test(page.url())) {
    throw new Error("A LinkedIn kijelentkeztetett — friss sütik kellenek.");
  }
  await humanBrowseMoment(page);
  await humanCasualScroll(page, { steps: 3 });
  await humanThink(page, 2500);

  // Saját profilra ugrás.
  log("info", "Saját profil megnyitása…");
  await page.goto("https://www.linkedin.com/in/me/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await humanWait(page, 4000);
  await humanCasualScroll(page, { steps: 2 });

  // 1. Headline
  if (headline) {
    await editHeadline(page, headline, submit, log, ctx);
    await humanCasualScroll(page, { steps: 1 });
    await humanWait(page, 1500);
  }

  // 2. About
  if (about) {
    await editAbout(page, about, submit, log, ctx);
    await humanWait(page, 1500);
  }

  // 3. Experience
  if (experience.length > 0) {
    await addExperience(page, experience, submit, log, ctx);
    await humanWait(page, 1500);
  }

  // 4. Education
  if (education.length > 0) {
    await addEducation(page, education, submit, log, ctx);
    await humanWait(page, 1500);
  }

  // 5. Skills
  if (skills.length > 0) {
    await addSkills(page, skills, submit, log, ctx);
  }

  // Utána még egy kicsit böngészünk.
  await humanCasualScroll(page, { steps: 2 });
  await humanBrowseMoment(page);

  log("info", "LinkedIn profil kitöltés befejezve.");
  return {
    linkedin_profile_setup: {
      headline: !!headline,
      about: !!about,
      experience: experience.length,
      education: education.length,
      skills: skills.length,
      submitted: submit,
    },
  };
}
