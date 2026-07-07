import type { WorkflowSpec } from "@/lib/chat.functions";

const PINTEREST_LOGIN_URL = "https://www.pinterest.com/login/";

export function normalizeRecordingStartUrl(
  rawUrl: string | undefined,
  platform: WorkflowSpec["platform"],
) {
  const raw = String(rawUrl || "").trim();
  const isPinterestWorkflow = /pinterest/i.test(String(platform || ""));

  if (!raw) return isPinterestWorkflow ? PINTEREST_LOGIN_URL : undefined;

  const compact = raw.replace(/\s+/g, "");
  const pinterestish = /pinterest/i.test(compact) || isPinterestWorkflow;

  // Tipikus elrontott címmező / autocomplete eredmény:
  // `www.pinterest.nl.login.pinterest.comcom` vagy hasonló összeragasztás.
  if (pinterestish && (/\.comcom(?:\/|$)/i.test(compact) || /login\.pinterest\./i.test(compact))) {
    return PINTEREST_LOGIN_URL;
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(compact)
    ? compact
    : /^localhost(?::\d+)?(?:\/|$)/i.test(compact)
      ? `http://${compact}`
      : `https://${compact}`;

  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase();

    if (pinterestish) {
      const isOfficialPinterestHost =
        host === "pinterest.com" ||
        host.endsWith(".pinterest.com") ||
        host === "pin.it" ||
        host.endsWith(".pin.it");

      if (!isOfficialPinterestHost) return PINTEREST_LOGIN_URL;
    }

    return url.toString();
  } catch {
    return pinterestish ? PINTEREST_LOGIN_URL : undefined;
  }
}