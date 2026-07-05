// worker/executor/scripts/bot-smoke-test.js
// "Bot smoke test" workflow — Sunnysoft (bot.sannysoft.com) és CreepJS
// ellenőrzőkön keresztül megnézi, mennyire látszunk botnak.
//
// Spec mezők (mind opcionális):
//   targets: ["sannysoft" | "creepjs" | "amiunique"]  (alap: mindhárom)
//   min_dwell_ms: legalább ennyi ideig az oldalon marad (alap: 6000)
//
// Az eredmény:
//   {
//     checks: [
//       { name: "sannysoft", url, ok: bool, red_flags: [..], screenshot_b64 },
//       { name: "creepjs",   url, ok: bool, trust_score: number|null, screenshot_b64 },
//     ]
//   }
//
// Fontos: ez csak SMOKE — nem garantálja, hogy TikTok/FB átenged.
// De ha itt piros a Sunnysoft, ott is baj lesz.

import {
  humanBrowseMoment,
  humanCasualScroll,
  humanIdleDrift,
  humanThink,
  humanWait,
  reseedHuman,
} from "./humanize.js";

const SITES = {
  sannysoft: "https://bot.sannysoft.com/",
  creepjs: "https://abrahamjuliot.github.io/creepjs/",
  amiunique: "https://amiunique.org/fingerprint",
};

async function shot(page) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: true });
    return buf.toString("base64");
  } catch {
    return null;
  }
}

async function runSannysoft(page, log) {
  log("info", "Sunnysoft: navigálás bot.sannysoft.com-ra…");
  await page.goto(SITES.sannysoft, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Nem rohanunk — böngészünk kicsit
  await humanBrowseMoment(page);
  await humanCasualScroll(page, { rounds: 3 });
  await humanIdleDrift(page);
  await humanThink(page, 1500);

  // A táblázat sorai: minden sor egy "test" — piros a "failed", zöld a "passed".
  const rows = await page.evaluate(() => {
    const out = [];
    const tables = document.querySelectorAll("table");
    tables.forEach((tbl) => {
      tbl.querySelectorAll("tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td");
        if (cells.length < 2) return;
        const name = (cells[0].textContent || "").trim();
        const result = (cells[1].textContent || "").trim();
        const bg = window.getComputedStyle(cells[1]).backgroundColor || "";
        const cls = cells[1].className || "";
        const failed = /failed|missing|present.*(?:webdriver)/i.test(result) ||
          /fail|red/i.test(cls) ||
          /rgb\(2[45]\d,\s*\d+,\s*\d+\)/.test(bg); // piros-ish
        out.push({ name, result, failed });
      });
    });
    return out;
  });

  const redFlags = rows.filter((r) => r.failed).map((r) => `${r.name}: ${r.result}`);
  const ok = redFlags.length === 0;
  log("info", `Sunnysoft: ${rows.length} teszt, piros: ${redFlags.length}`);
  return {
    name: "sannysoft",
    url: SITES.sannysoft,
    ok,
    total_tests: rows.length,
    red_flags: redFlags,
    screenshot_b64: await shot(page),
  };
}

async function runCreepJS(page, log) {
  log("info", "CreepJS: navigálás abrahamjuliot.github.io/creepjs…");
  await page.goto(SITES.creepjs, { waitUntil: "domcontentloaded", timeout: 60000 });
  // A CreepJS nagyon lassan számol — összes fingerprint teszt + trust score.
  // ~25-30 mp kell, mire a "Trust Score" szöveg megjelenik. Közben görgetünk
  // és várunk, hogy emberi legyen és az összes lazy-load tartalom betöltsön.
  await humanCasualScroll(page, { rounds: 3 });
  await humanWait(page, 10000);
  await humanCasualScroll(page, { rounds: 3 });
  await humanWait(page, 10000);
  // Végül várjuk meg konkrétan a "trust score" szöveget (max 20 mp).
  try {
    await page.waitForFunction(
      () => /trust\s*score/i.test(document.body?.innerText || ""),
      { timeout: 20000 },
    );
  } catch {
    log("warn", "CreepJS: 'trust score' szöveg nem jelent meg a várt időben — folytatjuk a kiolvasással.");
  }
  await humanWait(page, 2000);

  const data = await page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText : "";
    // "Trust Score: 72.5% (Good)" — több formátumot kereskedünk
    const scoreMatch = bodyText.match(/trust\s*score[^\d\-]*(-?\d+(?:\.\d+)?)/i);
    const label = bodyText.match(/trust\s*score[^\n]*/i)?.[0] || null;
    const lies = bodyText.match(/lies:?\s*(\d+)/i)?.[1] || null;
    return {
      trust_score: scoreMatch ? parseFloat(scoreMatch[1]) : null,
      label,
      lies: lies ? parseInt(lies, 10) : null,
    };
  });

  const ok = data.trust_score !== null && data.trust_score >= 60 && (data.lies ?? 0) < 3;
  log("info", `CreepJS: trust=${data.trust_score}, lies=${data.lies}`);
  return {
    name: "creepjs",
    url: SITES.creepjs,
    ok,
    trust_score: data.trust_score,
    trust_label: data.label,
    lies: data.lies,
    screenshot_b64: await shot(page),
  };
}

async function runAmIUnique(page, log) {
  log("info", "AmIUnique: navigálás…");
  await page.goto(SITES.amiunique, { waitUntil: "domcontentloaded", timeout: 30000 });
  await humanCasualScroll(page, { rounds: 3 });
  await humanWait(page, 5000);
  const data = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const uniq = text.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*observed/i)?.[1] || null;
    return { uniqueness_pct: uniq ? parseFloat(uniq) : null };
  });
  return {
    name: "amiunique",
    url: SITES.amiunique,
    ok: data.uniqueness_pct !== null,
    uniqueness_pct: data.uniqueness_pct,
    screenshot_b64: await shot(page),
  };
}

export async function runBotSmokeTest({ page, spec, log }) {
  reseedHuman([spec.workflow_id || "", "smoke", Date.now()]);
  const targets = Array.isArray(spec.targets) && spec.targets.length > 0
    ? spec.targets
    : ["sannysoft", "creepjs"];

  const checks = [];
  for (const t of targets) {
    try {
      if (t === "sannysoft") checks.push(await runSannysoft(page, log));
      else if (t === "creepjs") checks.push(await runCreepJS(page, log));
      else if (t === "amiunique") checks.push(await runAmIUnique(page, log));
      else log("warn", `Ismeretlen smoke target: ${t}`);
    } catch (e) {
      log("error", `${t} smoke hiba: ${e.message}`);
      checks.push({ name: t, ok: false, error: e.message });
    }
    // Emberi szünet a checkek között
    await humanWait(page, 2000);
  }

  const allOk = checks.every((c) => c.ok);
  log("info", `Smoke test összefoglaló: ${allOk ? "ZÖLD ✅" : "PIROS ❌"} — ${checks.map(c => `${c.name}:${c.ok?"ok":"❌"}`).join(", ")}`);
  return { checks, all_ok: allOk };
}
