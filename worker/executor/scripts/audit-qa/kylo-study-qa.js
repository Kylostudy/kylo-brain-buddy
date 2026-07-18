// worker/executor/scripts/audit-qa/kylo-study-qa.js
//
// Kylo.study QA crawler — robot módban (nincs emberi késleltetés).
// spec.audit_qa: { run_id, base_url, languages[], skins[], max_pages_per_combo, cost_cap_usd }
// spec.credentials (a run.js már betölti CREDENTIALS_JSON-ba a creds objektumot):
//   { email, password }  (vagy cookies)
//
// Menete nyelv × skin kombinációnként:
//   1) főoldal → 7× kattintás a kutyás logóra (bal fent) → login form
//   2) email/jelszó megadás → belépés
//   3) nyelv + skin beállítása a UI-ban (best-effort — a robot próbálja megtalálni)
//   4) BFS a belső linkeken, minden oldal:
//        - screenshot + DOM szöveg kivonat
//        - upload storage-ba
//        - qaApi.analyze() → hibalista + cost
//        - minden hibát qaApi.reportIssue() dedupe-pal
//        - qaApi.reportCoverage()
//   5) run vége → qaApi.finishRun("completed")
//
// Költségplafon: a report-coverage válaszból figyeljük a cost_cap_reached-et.

import crypto from "node:crypto";
import { qaApi } from "./qa-api.js";

const DEFAULT_MAX_PAGES = 40;

// Kylo master nyelv: en-GB. A puszta "en" nem érvényes.
function normalizeLang(lang) {
  if (!lang) return "en-GB";
  const l = String(lang).trim();
  if (l.toLowerCase() === "en" || l.toLowerCase() === "en-us") return "en-GB";
  return l;
}

// URL-hez hozzáfűzi a ?lang=XX (vagy &lang=XX) paramétert.
function withLangParam(rawUrl, lang) {
  try {
    const u = new URL(rawUrl);
    u.searchParams.set("lang", lang);
    return u.toString();
  } catch { return rawUrl; }
}

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function safeUrl(u, base) {
  try { return new URL(u, base).toString(); } catch { return null; }
}

function samePath(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch { return a === b; }
}

async function shotJpegB64(page) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: true });
    return buf.toString("base64");
  } catch (e) { return null; }
}

async function extractDomTexts(page) {
  return await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const txt = (node.nodeValue || "").trim();
      if (!txt || txt.length < 2 || txt.length > 300) continue;
      const el = node.parentElement;
      if (!el) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) continue;
      // Egyszerű CSS path (tag > tag > tag), max 3 szint
      const path = [];
      let cur = el;
      for (let i = 0; i < 3 && cur && cur !== document.body; i++) {
        const id = cur.id ? `#${cur.id}` : "";
        const cls = (cur.className && typeof cur.className === "string")
          ? "." + cur.className.split(/\s+/).slice(0, 1).join(".")
          : "";
        path.unshift(`${cur.tagName.toLowerCase()}${id}${cls}`);
        cur = cur.parentElement;
      }
      const sel = path.join(" > ");
      const key = sel + "::" + txt;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ text: txt, selector: sel });
      if (results.length >= 120) break;
    }
    return results;
  });
}

async function collectInternalLinks(page, baseHost) {
  return await page.evaluate((baseHost) => {
    const links = new Set();
    document.querySelectorAll("a[href]").forEach((a) => {
      try {
        const u = new URL(a.getAttribute("href"), window.location.href);
        if (u.host === baseHost && (u.protocol === "http:" || u.protocol === "https:")) {
          u.hash = "";
          links.add(u.toString());
        }
      } catch {}
    });
    return Array.from(links);
  }, baseHost);
}

async function clickLogo7Times(page, log) {
  log("info", "Belépéshez: 7× kattintás a bal felső kutyás logóra…");
  // Best-effort szelektorok
  const candidates = [
    'header img[alt*="logo" i]',
    'header a[href="/"] img',
    'a[href="/"] img',
    'header svg',
    'a.logo',
    'img[alt*="kylo" i]',
  ];
  let target = null;
  for (const sel of candidates) {
    const el = await page.$(sel);
    if (el) { target = el; break; }
  }
  if (!target) {
    // fallback: bal felső sarok
    log("warn", "Nem találtam explicit logót, bal felső régióra kattintok.");
    for (let i = 0; i < 7; i++) {
      await page.mouse.click(60, 60, { delay: 40 });
      await page.waitForTimeout(200);
    }
    return;
  }
  for (let i = 0; i < 7; i++) {
    try { await target.click({ timeout: 3000 }); } catch { break; }
    await page.waitForTimeout(180);
  }
}

async function tryLogin(page, creds, log) {
  const email = creds?.email || creds?.username;
  const password = creds?.password;
  if (!email || !password) {
    log("warn", "Nincs email/password credential — átugorjuk a bejelentkezést.");
    return false;
  }
  // Várjuk hogy megjelenjen egy email input
  try {
    await page.waitForSelector('input[type="email"], input[name*="email" i], input[id*="email" i]', { timeout: 8000 });
  } catch {
    log("warn", "Email input nem jelent meg — próbáljuk anélkül.");
    return false;
  }
  const emailInp = await page.$('input[type="email"], input[name*="email" i], input[id*="email" i]');
  const passInp = await page.$('input[type="password"]');
  if (!emailInp || !passInp) { log("warn", "Login mezők nem találhatóak."); return false; }
  await emailInp.fill(email);
  await passInp.fill(password);
  const submit = await page.$('button[type="submit"], button:has-text("Bejelentkez"), button:has-text("Login"), button:has-text("Sign in")');
  if (submit) await submit.click();
  else await passInp.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  log("info", "Belépés megtörtént (vagy megkíséreltük).");
  return true;
}

async function trySetLanguage(page, lang, log) {
  // Best-effort: kereszthivatkozású közös patternek
  const tries = [
    async () => { const btn = await page.$(`[data-lang="${lang}"]`); if (btn) { await btn.click(); return true; } return false; },
    async () => {
      const btn = await page.$(`button:has-text("${lang.toUpperCase()}"), a:has-text("${lang.toUpperCase()}")`);
      if (btn) { await btn.click(); return true; } return false;
    },
  ];
  for (const fn of tries) {
    try { if (await fn()) { log("info", `Nyelv beállítva: ${lang}`); await page.waitForTimeout(500); return true; } } catch {}
  }
  log("warn", `Nyelv beállítása nem sikerült (${lang}) — folytatjuk a jelenlegi UI-val.`);
  return false;
}

async function trySetSkin(page, skin, log) {
  if (!skin || skin === "default") return true;
  const tries = [
    async () => { const el = await page.$(`[data-skin="${skin}"]`); if (el) { await el.click(); return true; } return false; },
    async () => { const el = await page.$(`button:has-text("${skin}"), a:has-text("${skin}")`); if (el) { await el.click(); return true; } return false; },
  ];
  for (const fn of tries) { try { if (await fn()) { log("info", `Skin beállítva: ${skin}`); await page.waitForTimeout(400); return true; } } catch {} }
  log("warn", `Skin beállítása nem sikerült (${skin}).`);
  return false;
}

export async function runKyloStudyQa({ page, context, spec, creds, log }) {
  const qa = spec.audit_qa || {};
  const runId = qa.run_id;
  const baseUrl = qa.base_url || "https://kylo.study";
  const rawLanguages = Array.isArray(qa.languages) && qa.languages.length > 0 ? qa.languages : ["hu"];
  const languages = rawLanguages.map(normalizeLang);
  const skins = Array.isArray(qa.skins) && qa.skins.length > 0 ? qa.skins : ["default"];
  const maxPagesPerCombo = Number(qa.max_pages_per_combo || DEFAULT_MAX_PAGES);
  if (!runId) throw new Error("audit_qa.run_id hiányzik a specből");

  const baseHost = new URL(baseUrl).host;
  let totalCost = 0;

  log("info", `Kylo.study QA indul — run=${runId}, langs=${languages.join(",")}, skins=${skins.join(",")}, max=${maxPagesPerCombo}`);

  try {
    // Konzol hibák gyűjtése globálisan
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        // best-effort: minden konzol hibát critical-ként jelentünk, dedupe majd összevonja
        qaApi.reportIssue({
          run_id: runId,
          severity: "minor",
          category: "console_error",
          language: null,
          skin: null,
          page_url: page.url(),
          page_title: null,
          problematic_text: msg.text().slice(0, 300),
          ai_diagnosis: "Böngésző konzol hiba a futás alatt.",
        }).catch(() => {});
      }
    });

    // 1) Belépés
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await clickLogo7Times(page, log);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await tryLogin(page, creds, log);

    // 2) Nyelv × skin ciklusok — a nyelvet ?lang=XX URL paraméterrel állítjuk (Kylo standard)
    for (const language of languages) {
      for (const skin of skins) {
        log("info", `--- Kombináció kezdés: ${language}/${skin} ---`);
        // Skin továbbra is UI-kattintással, mert nincs URL paramétere
        await trySetSkin(page, skin, log);

        const visited = new Set(); // pathname-alapú, hogy ne látogassuk többször ugyanazt más query-vel
        const queue = [baseUrl];
        let processed = 0;

        while (queue.length > 0 && processed < maxPagesPerCombo) {
          const rawUrl = queue.shift();
          let pathKey = rawUrl;
          try { const u = new URL(rawUrl); pathKey = u.origin + u.pathname; } catch {}
          if (visited.has(pathKey)) continue;
          visited.add(pathKey);

          const url = withLangParam(rawUrl, language);

          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
            await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
            const title = await page.title().catch(() => "");
            const isHome = samePath(url, baseUrl);

            // A landing (/) oldal szándékosan angol nyelvű minden nyelven — kihagyjuk a nyelvi elemzést
            if (isHome && language !== "en-GB") {
              log("info", `Landing oldal (${url}) — szándékosan angol, kihagyjuk a ${language} elemzést.`);
              // Csak linkgyűjtés
              const links = await collectInternalLinks(page, baseHost);
              for (const l of links) {
                let lk = l; try { const u = new URL(l); lk = u.origin + u.pathname; } catch {}
                if (!visited.has(lk) && !queue.includes(l)) queue.push(l);
              }
              processed++;
              continue;
            }

            // Screenshot + upload
            const b64 = await shotJpegB64(page);
            let screenshotPath = null;
            if (b64) {
              const fname = `${sha1(url + language + skin).slice(0, 12)}-${Date.now()}.jpg`;
              try {
                const up = await qaApi.uploadScreenshot({ run_id: runId, filename: fname, screenshot_b64: b64, content_type: "image/jpeg" });
                screenshotPath = up.path;
              } catch (e) { log("warn", `screenshot upload hiba: ${e.message}`); }
            }

            // DOM texts + analyze
            const domTexts = await extractDomTexts(page);
            let analyzeRes = null;
            if (b64) {
              try {
                analyzeRes = await qaApi.analyze({
                  screenshot_b64: b64,
                  page_url: url,
                  page_title: title,
                  expected_language: language,
                  skin,
                  dom_texts: domTexts,
                  is_home_page: isHome,
                });
                totalCost += Number(analyzeRes.cost_usd || 0);
              } catch (e) { log("warn", `analyze hiba: ${e.message}`); }
            }

            // Hibák bejelentése
            const issues = analyzeRes?.issues || [];
            log("info", `[${language}/${skin}] ${url} — ${issues.length} hiba`);
            for (const iss of issues) {
              try {
                await qaApi.reportIssue({
                  run_id: runId,
                  severity: iss.severity || "minor",
                  category: iss.category || "other",
                  language,
                  skin,
                  page_url: url,
                  page_title: title,
                  expected_language: language,
                  detected_language: iss.detected_language || null,
                  problematic_text: iss.problematic_text || null,
                  selector: iss.selector || null,
                  ai_diagnosis: iss.diagnosis || null,
                  ai_suggested_fix: iss.suggested_fix || null,
                  screenshot_path: screenshotPath,
                });
              } catch (e) { log("warn", `reportIssue hiba: ${e.message}`); }
            }

            // Coverage + cost delta
            try {
              const cov = await qaApi.reportCoverage({
                run_id: runId,
                url,
                language,
                skin,
                interactions_count: 0,
                cost_delta_usd: Number(analyzeRes?.cost_usd || 0),
              });
              if (cov.cost_cap_reached) {
                log("warn", `Költségplafon elérve ($${Number(cov.total_cost_usd || totalCost).toFixed(2)}) — leállunk.`);
                await safeFinishRun(qaApi, log, { run_id: runId, status: "stopped", final_cost_usd: totalCost });
                return { run_id: runId, status: "stopped", total_cost_usd: totalCost };
              }
            } catch (e) {
              log("warn", `reportCoverage hiba — folytatjuk: ${e.message}`);
            }

            // További linkek felderítése (nyers URL-ek, ?lang= majd később ráteszünk)
            const links = await collectInternalLinks(page, baseHost);
            for (const l of links) {
              let lk = l; try { const u = new URL(l); lk = u.origin + u.pathname; } catch {}
              if (!visited.has(lk) && !queue.includes(l)) queue.push(l);
            }
            processed++;
          } catch (e) {
            log("warn", `oldal hiba (${url}): ${e.message}`);
          }
        }
        log("info", `--- Kombináció vége: ${language}/${skin} — ${processed} oldal ---`);
      }
    }

    await safeFinishRun(qaApi, log, { run_id: runId, status: "completed", final_cost_usd: totalCost });
    log("info", `Kylo.study QA befejezve — összköltség: $${totalCost.toFixed(4)}`);
    return { run_id: runId, status: "completed", total_cost_usd: totalCost };
  } catch (e) {
    log("error", `QA fatal: ${e.message}`);
    await safeFinishRun(qaApi, log, { run_id: runId, status: "failed", final_cost_usd: totalCost });
    throw e;
  }
}

async function safeFinishRun(qaApi, log, payload) {
  try {
    await qaApi.finishRun(payload);
  } catch (e) {
    log("warn", `finishRun endpoint hiba — a worker eredményét akkor is visszaküldjük: ${e.message}`);
  }
}
