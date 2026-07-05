import type { Session } from "@supabase/supabase-js";

function getConfiguredSupabaseUrl() {
  return import.meta.env.VITE_SUPABASE_URL || "";
}

export function getSupabaseAuthStorageKey() {
  const configuredUrl = getConfiguredSupabaseUrl();
  if (!configuredUrl) return null;

  try {
    const host = new URL(configuredUrl).hostname;
    const projectRef = host.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

function isUsableSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  return (
    typeof session.access_token === "string" &&
    typeof session.refresh_token === "string" &&
    !!session.user &&
    typeof session.user === "object"
  );
}

export function readStoredSupabaseSession(): Session | null {
  if (typeof window === "undefined") return null;
  const key = getSupabaseAuthStorageKey();
  if (!key) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isUsableSession(parsed)) return null;

    if (parsed.expires_at && parsed.expires_at * 1000 <= Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function saveSupabaseSession(session: Session) {
  if (typeof window === "undefined") return;
  const key = getSupabaseAuthStorageKey();
  if (!key) throw new Error("Hiányzik az auth tárolási kulcs.");
  window.localStorage.setItem(key, JSON.stringify(session));
}

export function clearStoredSupabaseSession() {
  if (typeof window === "undefined") return;
  const key = getSupabaseAuthStorageKey();
  if (!key) return;
  window.localStorage.removeItem(key);
  window.localStorage.removeItem(`${key}-code-verifier`);
}