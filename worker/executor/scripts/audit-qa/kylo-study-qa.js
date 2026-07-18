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
const DEFAULT_MAX_CLICKS_PER_PAGE = 14;

const SKIN_STORAGE_VALUE = {
  "magic-school": "magic_school",
  magic_school: "magic_school",
  alaska: "alaszka",
  alaszka: "alaszka",
  "puppy-cat": "puppy_cat",
  puppy_cat: "puppy_cat",
};

function normalizeSkinForKylo(skin) {
  const raw = String(skin || "magic-school").trim();
  return SKIN_STORAGE_VALUE[raw] || raw.replaceAll("-", "_");
}

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

function urlForPath(baseUrl, pathname) {
  try { return new URL(pathname, baseUrl).toString(); } catch { return baseUrl; }
}

function pathKeyOf(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`;
  } catch { return String(rawUrl); }
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

async function acceptCookiesIfVisible(page) {
  const buttons = [
    'button:has-text("Elfogadom")',
    'button:has-text("Accept")',
    'button:has-text("OK")',
  ];
  for (const sel of buttons) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({ timeout: 1500 });
        await page.waitForTimeout(400);
        return true;
      }
    } catch {}
  }
  return false;
}

async function setKyloSkin(page, baseUrl, skin, log) {
  const storageValue = normalizeSkinForKylo(skin);
  try {
    if (!page.url().startsWith(new URL(baseUrl).origin)) {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    }
    await page.evaluate((value) => {
      localStorage.setItem("selectedSkin", value);
      document.documentElement.setAttribute("data-skin", value);
    }, storageValue);
    log("info", `Skin beállítva localStorage alapján: ${skin} → ${storageValue}`);
    return true;
  } catch (e) {
    log("warn", `Skin beállítása nem sikerült (${skin}): ${e.message}`);
    return false;
  }
}

async function visibleLoginFields(page) {
  return await page.evaluate(() => ({
    email: !!document.querySelector('input[type="email"], input#login-email, input[name*="email" i], input[id*="email" i]'),
    password: !!document.querySelector('input[type="password"], input#login-password'),
  })).catch(() => ({ email: false, password: false }));
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
  await acceptCookiesIfVisible(page);
  // Várjuk hogy megjelenjen egy email input
  try {
    await page.waitForSelector('input[type="email"], input#login-email, input[name*="email" i], input[id*="email" i]', { timeout: 8000 });
  } catch {
    log("warn", "Email input nem jelent meg — próbáljuk anélkül.");
    return false;
  }
  const emailInp = await page.$('input#login-email, input[type="email"], input[name*="email" i], input[id*="email" i]');
  const passInp = await page.$('input#login-password, input[type="password"]');
  if (!emailInp || !passInp) { log("warn", "Login mezők nem találhatóak."); return false; }
  await emailInp.fill(email);
  await passInp.fill(password);
  const submit = await page.$('button[type="submit"]:has-text("Belépés"), button:has-text("Bejelentkez"), button:has-text("Login"), button:has-text("Sign in"), button[type="submit"]');
  if (submit) await submit.click();
  else await passInp.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const fields = await visibleLoginFields(page);
  if (fields.password) {
    log("warn", "Belépés után is látszik a jelszómező — a login valószínűleg nem sikerült.");
    return false;
  }
  log("info", `Belépés sikeresnek tűnik — aktuális URL: ${page.url()}`);
  return true;
}

async function collectClickableTargets(page, maxTargets) {
  return await page.evaluate((maxTargets) => {
    const skip = /(google|apple|lovable|dismiss|elfogadom|accept|cookie|kijelentkez|logout|törlés|delete|fizetés|payment|unsubscribe)/i;
    function isVisible(el) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    }
    function cssPath(el) {
      const parts = [];
      let cur = el;
      for (let depth = 0; cur && cur.nodeType === 1 && cur !== document.body && depth < 5; depth++) {
        const id = cur.id ? `#${CSS.escape(cur.id)}` : "";
        if (id) { parts.unshift(`${cur.tagName.toLowerCase()}${id}`); break; }
        const parent = cur.parentElement;
        if (!parent) break;
        const same = Array.from(parent.children).filter((x) => x.tagName === cur.tagName);
        const idx = same.indexOf(cur) + 1;
        parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`);
        cur = parent;
      }
      return parts.join(" > ");
    }
    const nodes = Array.from(document.querySelectorAll('a[href], button, [role="button"], [data-radix-collection-item], input[type="button"], input[type="submit"]'));
    const out = [];
    const seen = new Set();
    for (const el of nodes) {
      if (!isVisible(el) || el.disabled) continue;
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
      const href = el.getAttribute("href") || "";
      const label = text || href;
      if (!label || skip.test(label)) continue;
      const selector = cssPath(el);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      out.push({ selector, label: label.slice(0, 80) });
      if (out.length >= maxTargets) break;
    }
    return out;
  }, maxTargets).catch(() => []);
}

async function discoverLinksByClicking(context, page, sourceUrl, baseHost, log, maxClicks) {
  // A célokat a fő oldalról gyűjtjük (már be van töltve), a kattintásokat
  // egy külön aux tabon próbáljuk, hogy a fő oldal ne mozduljon el —
  // így nem kell utána újratölteni.
  const targets = await collectClickableTargets(page, maxClicks);
  const found = new Set();
  let interactions = 0;

  if (targets.length === 0) return { links: [], interactions: 0 };

  const aux = await context.newPage();
  try {
    await aux.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    for (const target of targets) {
      try {
        // Csak akkor navigálunk vissza, ha az előző kattintás elvitt máshova.
        if (pathKeyOf(aux.url()) !== pathKeyOf(sourceUrl)) {
          await aux.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => {});
        }
        const el = await aux.$(target.selector);
        if (!el) continue;
        await el.click({ timeout: 2000 }).catch(() => {});
        interactions++;
        // Nincs networkidle-várakozás — SPA-nál nem terminál rendesen. Rövid nyugvási idő elég.
        await aux.waitForTimeout(500);
        const after = aux.url();
        try {
          const u = new URL(after);
          if (u.host === baseHost && (u.protocol === "http:" || u.protocol === "https:")) {
            u.hash = "";
            found.add(u.toString());
          }
        } catch {}
        const links = await collectInternalLinks(aux, baseHost).catch(() => []);
        for (const l of links) found.add(l);
      } catch (e) {
        log("warn", `Kattintás felderítés kihagyva ("${target.label}"): ${e.message}`);
      }
    }
  } finally {
    await aux.close().catch(() => {});
  }

  return { links: Array.from(found), interactions };
}

async function reportAnalyzedPage({ runId, page, url, title, language, skin, isHome, skipLanguageAnalysis, interactions, totalCostRef, log }) {
  let analyzeRes = null;
  let screenshotPath = null;

  if (!skipLanguageAnalysis) {
    const b64 = await shotJpegB64(page);
    if (b64) {
      const fname = `${sha1(url + language + skin).slice(0, 12)}-${Date.now()}.jpg`;
      try {
        const up = await qaApi.uploadScreenshot({ run_id: runId, filename: fname, screenshot_b64: b64, content_type: "image/jpeg" });
        screenshotPath = up.path;
      } catch (e) { log("warn", `screenshot upload hiba: ${e.message}`); }

      const domTexts = await extractDomTexts(page);
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
        totalCostRef.value += Number(analyzeRes.cost_usd || 0);
      } catch (e) { log("warn", `analyze hiba: ${e.message}`); }
    }
  }

  const issues = analyzeRes?.issues || [];
  log("info", `[${language}/${skin}] ${url} — ${skipLanguageAnalysis ? "landing nyelvi elemzés kihagyva" : `${issues.length} hiba`} · ${interactions} kattintás`);
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

  try {
    const cov = await qaApi.reportCoverage({
      run_id: runId,
      url,
      language,
      skin,
      interactions_count: interactions,
      cost_delta_usd: Number(analyzeRes?.cost_usd || 0),
    });
    return !!cov.cost_cap_reached;
  } catch (e) {
    log("warn", `reportCoverage hiba — folytatjuk: ${e.message}`);
    return false;
  }
}

export async function runKyloStudyQa({ page, context, spec, creds, log }) {
  const qa = spec.audit_qa || {};
  const runId = qa.run_id;
  const baseUrl = qa.base_url || "https://kylo.study";
  const rawLanguages = Array.isArray(qa.languages) && qa.languages.length > 0 ? qa.languages : ["hu"];
  const languages = rawLanguages.map(normalizeLang);
  const skins = Array.isArray(qa.skins) && qa.skins.length > 0 ? qa.skins : ["default"];
  const maxPagesPerCombo = Number(qa.max_pages_per_combo || DEFAULT_MAX_PAGES);
  const maxClicksPerPage = Number(qa.max_clicks_per_page || DEFAULT_MAX_CLICKS_PER_PAGE);
  if (!runId) throw new Error("audit_qa.run_id hiányzik a specből");

  const baseHost = new URL(baseUrl).host;
  const totalCostRef = { value: 0 };
  let postLoginUrl = null;

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

    // 1) Belépés — direkt a /regisztracio oldalról, mert a landing waitlist email mezője nem login.
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await acceptCookiesIfVisible(page);
    await clickLogo7Times(page, log);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    let fields = await visibleLoginFields(page);
    if (!fields.password) {
      const loginUrl = withLangParam(urlForPath(baseUrl, "/regisztracio"), languages.includes("hu") ? "hu" : languages[0]);
      log("info", `A rejtett logó-kattintás nem nyitott login formot, direkt belépési oldalra megyek: ${loginUrl}`);
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    }
    const loggedIn = await tryLogin(page, creds, log);
    if (loggedIn) {
      postLoginUrl = page.url();
    }

    // 2) Nyelv × skin ciklusok — a nyelvet ?lang=XX URL paraméterrel állítjuk (Kylo standard)
    for (const language of languages) {
      for (const skin of skins) {
        log("info", `--- Kombináció kezdés: ${language}/${skin} ---`);
        await setKyloSkin(page, baseUrl, skin, log);

        const visited = new Set(); // pathname-alapú, hogy ne látogassuk többször ugyanazt más query-vel
        const queue = [baseUrl];
        if (postLoginUrl && new URL(postLoginUrl).host === baseHost) queue.push(postLoginUrl);
        let processed = 0;

        while (queue.length > 0 && processed < maxPagesPerCombo) {
          const rawUrl = queue.shift();
          const pathKey = pathKeyOf(rawUrl);
          if (visited.has(pathKey)) continue;
          visited.add(pathKey);

          const url = withLangParam(rawUrl, language);

          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
            // Rövid „settling" idő — a networkidle SPA-nál nem terminál rendesen.
            await page.waitForTimeout(800);
            const title = await page.title().catch(() => "");
            const isHome = samePath(url, baseUrl);

            const initialLinks = await collectInternalLinks(page, baseHost);
            const discovery = await discoverLinksByClicking(context, page, url, baseHost, log, maxClicksPerPage);
            // NEM navigálunk vissza — az aux tabban kattintottunk, a fő page érintetlen.

            // A landing (/) oldal szándékosan angol nyelvű minden nyelven — kihagyjuk a nyelvi elemzést
            const skipLanguageAnalysis = isHome && language !== "en-GB";
            if (skipLanguageAnalysis) {
              log("info", `Landing oldal (${url}) — szándékosan angol, kihagyjuk a ${language} elemzést.`);
            }

            const capped = await reportAnalyzedPage({
              runId,
              page,
              url,
              title,
              language,
              skin,
              isHome,
              skipLanguageAnalysis,
              interactions: discovery.interactions,
              totalCostRef,
              log,
            });
            if (capped) {
              log("warn", `Költségplafon elérve ($${totalCostRef.value.toFixed(2)}) — leállunk.`);
              await safeFinishRun(qaApi, log, { run_id: runId, status: "stopped", final_cost_usd: totalCostRef.value });
              return { run_id: runId, status: "stopped", total_cost_usd: totalCostRef.value };
            }

            // További linkek felderítése: statikus linkek + biztonságos gomb/menu kattintások.
            const links = [...initialLinks, ...discovery.links];
            for (const l of links) {
              const lk = pathKeyOf(l);
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

    await safeFinishRun(qaApi, log, { run_id: runId, status: "completed", final_cost_usd: totalCostRef.value });
    log("info", `Kylo.study QA befejezve — összköltség: $${totalCostRef.value.toFixed(4)}`);
    return { run_id: runId, status: "completed", total_cost_usd: totalCostRef.value };
  } catch (e) {
    log("error", `QA fatal: ${e.message}`);
    await safeFinishRun(qaApi, log, { run_id: runId, status: "failed", final_cost_usd: totalCostRef.value });
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
