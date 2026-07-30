import type { WorkflowSpec } from "@/lib/chat.functions";

const PINTEREST_LOGIN_URL = "https://www.pinterest.com/login/";
const REDDIT_HOME_URL = "https://www.reddit.com/";

export function normalizeRecordingStartUrl(
  rawUrl: string | undefined,
  platform: WorkflowSpec["platform"],
) {
  const raw = String(rawUrl || "").trim();
  const isPinterestWorkflow = /pinterest/i.test(String(platform || ""));
  const isRedditWorkflow = /reddit/i.test(String(platform || ""));

  if (!raw) {
    if (isPinterestWorkflow) return PINTEREST_LOGIN_URL;
    if (isRedditWorkflow) return REDDIT_HOME_URL;
    return undefined;
  }

  let compact = raw.replace(/\s+/g, "");
  // Gyakori kézi elírás: `https:pelda.hu/oldal` (a két perjel hiányzik).
  // Ezt javítsuk, ne dobjuk el csendben a kezdőcímet, mert abból üres
  // böngészőablak lenne.
  compact = compact
    .replace(/^https:(?!\/\/)/i, "https://")
    .replace(/^http:(?!\/\/)/i, "http://");
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
      if (isPinterestWorkflow && (url.pathname === "" || url.pathname === "/")) {
        return PINTEREST_LOGIN_URL;
      }
    }

    // A gmail.com csak egy átirányító; proxy mögött gyakran elakad, ezért
    // egyből a valódi postafiók címére megyünk.
    if (host === "gmail.com" || host === "www.gmail.com") {
      return url.pathname && url.pathname !== "/"
        ? `https://mail.google.com${url.pathname}${url.search}`
        : "https://mail.google.com/mail/u/0/";
    }

    return url.toString();

  } catch {
    return pinterestish ? PINTEREST_LOGIN_URL : undefined;
  }
}