// Modul-felismerés a böngészőben.
//
// Prioritás:
//   1) Aldomain (éles): brain.kylosystems.com → "brain", audit.kylosystems.com → "audit"
//   2) Query param: ?module=brain | ?module=audit  (override; localStorage-ba is menti)
//   3) localStorage ("kylo.module") — preview-n a dev kapcsoló ide ír
//   4) Fallback: "brain"

import { isAppModule, type AppModule } from "./types";

const STORAGE_KEY = "kylo.module";

function fromHostname(hostname: string): AppModule | null {
  const host = hostname.toLowerCase();
  if (host.startsWith("brain.")) return "brain";
  if (host.startsWith("audit.")) return "audit";
  return null;
}

function fromQueryString(search: string): AppModule | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search);
    const raw = params.get("module");
    return isAppModule(raw) ? raw : null;
  } catch {
    return null;
  }
}

function fromLocalStorage(): AppModule | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isAppModule(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function detectModule(): AppModule {
  if (typeof window === "undefined") return "brain";

  // 1) Aldomain dominálja az éles felhasználói élményt
  const fromHost = fromHostname(window.location.hostname);
  if (fromHost) return fromHost;

  // 2) Query param — explicit override (mentsük el)
  const fromQs = fromQueryString(window.location.search);
  if (fromQs) {
    try {
      window.localStorage.setItem(STORAGE_KEY, fromQs);
    } catch {
      /* ignore */
    }
    return fromQs;
  }

  // 3) Korábbi dev választás
  const fromLs = fromLocalStorage();
  if (fromLs) return fromLs;

  // 4) Alapértelmezés
  return "brain";
}

export function setModuleOverride(module: AppModule): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, module);
  } catch {
    /* ignore */
  }
}

export function isProductionSubdomain(hostname: string): boolean {
  return fromHostname(hostname) !== null;
}
