// worker/executor/scripts/brain-tasks/dom-digest.js
// Egységes DOM-kivonat: mit lát épp az oldalon egy ember és a gép.
// Nem kattint semmire, csak olvas.

export async function collectDomDigest(page, { maxItems = 60 } = {}) {
  try {
    return await page.evaluate((limit) => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        const s = getComputedStyle(el);
        return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
      };
      const txt = (el) => (el.innerText || el.textContent || "").trim().slice(0, 60);

      const buttons = [];
      const aria = [];
      const dataAttrs = [];
      const editors = [];

      for (const el of Array.from(
        document.querySelectorAll('button, [role="button"], a[href]'),
      )) {
        if (buttons.length >= limit) break;
        if (!visible(el)) continue;
        const label = txt(el) || el.getAttribute("aria-label") || "";
        if (label) buttons.push(label);
      }

      for (const el of Array.from(document.querySelectorAll("[aria-label]"))) {
        if (aria.length >= limit) break;
        if (!visible(el)) continue;
        aria.push(`${el.tagName.toLowerCase()}[aria-label="${el.getAttribute("aria-label")}"]`);
      }

      for (const el of Array.from(document.querySelectorAll("[class]"))) {
        if (dataAttrs.length >= limit) break;
        if (!visible(el)) continue;
        for (const a of Array.from(el.attributes)) {
          if (a.name.startsWith("data-") && a.value && a.value.length < 40) {
            dataAttrs.push(`${el.tagName.toLowerCase()}[${a.name}="${a.value}"]`);
            break;
          }
        }
      }

      for (const el of Array.from(
        document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]'),
      )) {
        if (editors.length >= 20) break;
        if (!visible(el)) continue;
        editors.push(
          `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`,
        );
      }

      return {
        title: document.title,
        url: location.href,
        buttons: [...new Set(buttons)],
        aria: [...new Set(aria)],
        data_attrs: [...new Set(dataAttrs)],
        editors: [...new Set(editors)],
      };
    }, maxItems);
  } catch {
    return { title: "", url: page.url(), buttons: [], aria: [], data_attrs: [], editors: [] };
  }
}
