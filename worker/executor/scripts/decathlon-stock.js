// Decathlon stockfigyelő — Brain típusú (humanized) viselkedéssel.
// Az ember körbenéz, scrollozik, csak azután nyúl a méretválasztóhoz.
// Result: { available: true|false, size, url, productName }

import { humanBrowseMoment, humanCasualScroll, humanClick, humanThink, humanWait, reseedHuman } from "./humanize.js";

export async function runDecathlonStock({ page, spec, log }) {
  const url = spec.product_url;
  const targetSize = (spec.size || "4XL").toString().trim().toUpperCase();
  const timeout = Number(spec.timeout_ms || 30000);

  if (!url) throw new Error("Spec.product_url hiányzik");
  reseedHuman([spec.workflow_id || "", targetSize, Date.now()]);
  log("info", `Decathlon stock check (humanized) → ${url} | méret: ${targetSize}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  // Az ember először megnézi az oldalt
  await humanBrowseMoment(page);

  // Cookie banner — humanClick-kel, hogy ne bot-szerű legyen
  for (const sel of [
    'button#didomi-notice-agree-button',
    'button:has-text("Elfogadom")',
    'button:has-text("Accept")',
    'button:has-text("Egyetértek")',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await humanClick(page, await btn.elementHandle());
        log("info", `Cookie banner elfogadva: ${sel}`);
        break;
      }
    } catch { /* ignore */ }
  }

  await humanCasualScroll(page, { rounds: 2 });
  await humanThink(page, 900);

  let productName = null;
  try {
    productName = (await page.locator("h1").first().innerText({ timeout: 5000 })).trim();
  } catch { productName = null; }

  const sizeCandidates = [
    '[data-testid="size-selector"] button',
    '[data-testid="product-sizes"] button',
    'button[data-size]',
    'label[data-size]',
    'fieldset[aria-label*="méret" i] button',
    'fieldset[aria-label*="size" i] button',
    'div[role="radiogroup"] button',
  ];

  let sizeButtons = [];
  for (const sel of sizeCandidates) {
    const found = await page.locator(sel).all();
    if (found.length > 0) {
      sizeButtons = found;
      log("info", `Méret gombok: ${found.length} (szelektor: ${sel})`);
      break;
    }
  }

  if (sizeButtons.length === 0) {
    sizeButtons = await page.locator(`text=/^\\s*${targetSize}\\s*$/i`).all();
    log("info", `Fallback méretkeresés "${targetSize}" felirattal: ${sizeButtons.length} találat`);
  }

  let targetEl = null;
  for (const btn of sizeButtons) {
    const text = ((await btn.innerText().catch(() => "")) || "").trim().toUpperCase();
    const dataSize = ((await btn.getAttribute("data-size").catch(() => "")) || "")
      .trim().toUpperCase();
    if (text === targetSize || dataSize === targetSize) {
      targetEl = btn;
      break;
    }
  }

  if (!targetEl) {
    log("warn", `Méret "${targetSize}" nincs a kínálatban ezen az oldalon.`);
    return { available: false, size: targetSize, url, productName, reason: "size_not_listed" };
  }

  // Ránéz a méretre — hover, gondolkodik, majd (nem szükségszerűen kattint, csak ránéz)
  try {
    const handle = await targetEl.elementHandle();
    if (handle) {
      // Emberi mozgás a gombra, de NEM kattintunk — csak megnézzük az állapotát
      const { humanClick: _hc } = { humanClick };
      // Csak hover, kattintás nélkül: humanClick belülről kattint, ezért
      // itt inkább scrollIntoView + drift.
      await handle.scrollIntoViewIfNeeded().catch(() => {});
      await humanThink(page, 600);
    }
  } catch { /* ignore */ }

  const disabled =
    (await targetEl.getAttribute("disabled").catch(() => null)) !== null ||
    (await targetEl.getAttribute("aria-disabled").catch(() => null)) === "true";

  let outOfStockText = false;
  try {
    const cls = (await targetEl.getAttribute("class").catch(() => "")) || "";
    if (/disabled|out[-_ ]?of[-_ ]?stock|unavailable|sold[-_ ]?out|elfogyott/i.test(cls)) {
      outOfStockText = true;
    }
  } catch { /* ignore */ }

  const available = !disabled && !outOfStockText;
  log("info", `Eredmény: available=${available} (disabled=${disabled}, oosClass=${outOfStockText})`);

  return { available, size: targetSize, url, productName };
}
