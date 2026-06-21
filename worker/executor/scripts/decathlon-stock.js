// Decathlon stockfigyelő — egy adott termékoldalon megnézi, az adott méret
// (pl. 4XL) kapható-e. Eredmény:
//   { available: true|false, size, url, productName, screenshot?: base64 }
//
// Spec mezők (workflows.spec):
//   product_url:   teljes Decathlon termékoldal URL
//   size:          "4XL" (string, ahogyan a méretválasztón szerepel)
//   timeout_ms:    opcionális, alap 30000
//
// Megjegyzés: a Decathlon több országban más DOM-ot ad. Itt egy robusztus
// heurisztikát használunk: minden méretválasztó gombot felolvasunk, és
// megnézzük, a célméret gombja "disabled" / "out of stock" jelölés nélkül van-e.

export async function runDecathlonStock({ page, spec, log }) {
  const url = spec.product_url;
  const targetSize = (spec.size || "4XL").toString().trim().toUpperCase();
  const timeout = Number(spec.timeout_ms || 30000);

  if (!url) throw new Error("Spec.product_url hiányzik");
  log("info", `Decathlon stock check → ${url} | méret: ${targetSize}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout });

  // Cookie banner — ha van, próbáljuk elfogadni (több variáció).
  for (const sel of [
    'button#didomi-notice-agree-button',
    'button:has-text("Elfogadom")',
    'button:has-text("Accept")',
    'button:has-text("Egyetértek")',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click({ timeout: 2000 });
        log("info", `Cookie banner elfogadva: ${sel}`);
        break;
      }
    } catch {
      // ignore
    }
  }

  // Termék neve (best effort)
  let productName = null;
  try {
    productName = (await page.locator("h1").first().innerText({ timeout: 5000 })).trim();
  } catch {
    productName = null;
  }

  // Méretválasztó gombok — több ismert szelektort próbálunk.
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
    // Fallback: bármi, ami 4XL feliratot tartalmaz
    sizeButtons = await page.locator(`text=/^\\s*${targetSize}\\s*$/i`).all();
    log("info", `Fallback méretkeresés "${targetSize}" felirattal: ${sizeButtons.length} találat`);
  }

  let targetEl = null;
  for (const btn of sizeButtons) {
    const text = ((await btn.innerText().catch(() => "")) || "").trim().toUpperCase();
    const dataSize = ((await btn.getAttribute("data-size").catch(() => "")) || "")
      .trim()
      .toUpperCase();
    if (text === targetSize || dataSize === targetSize) {
      targetEl = btn;
      break;
    }
  }

  if (!targetEl) {
    log("warn", `Méret "${targetSize}" nincs a kínálatban ezen az oldalon.`);
    return {
      available: false,
      size: targetSize,
      url,
      productName,
      reason: "size_not_listed",
    };
  }

  // Diszabolt-e? (aria-disabled, disabled attribútum, vagy „elfogyott" felirat a környezetben)
  const disabled =
    (await targetEl.getAttribute("disabled").catch(() => null)) !== null ||
    (await targetEl.getAttribute("aria-disabled").catch(() => null)) === "true";

  let outOfStockText = false;
  try {
    const cls = (await targetEl.getAttribute("class").catch(() => "")) || "";
    if (/disabled|out[-_ ]?of[-_ ]?stock|unavailable|sold[-_ ]?out|elfogyott/i.test(cls)) {
      outOfStockText = true;
    }
  } catch {
    // ignore
  }

  const available = !disabled && !outOfStockText;
  log("info", `Eredmény: available=${available} (disabled=${disabled}, oosClass=${outOfStockText})`);

  return {
    available,
    size: targetSize,
    url,
    productName,
  };
}
