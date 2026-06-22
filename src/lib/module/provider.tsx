// ModuleProvider — kontextus, ami az egész app számára eldönti, melyik modulban
// fut éppen. A <html data-module="..."> attribútumot is innen állítjuk, hogy a
// CSS [data-module="audit"] override automatikusan érvényesüljön.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  detectModule,
  isProductionSubdomain,
  setModuleOverride,
} from "./detect";
import { MODULE_META, type AppModule } from "./types";

type ModuleContextValue = {
  module: AppModule;
  meta: (typeof MODULE_META)[AppModule];
  /** Csak preview/dev környezetben enged váltani; éles aldomainen no-op. */
  setModule: (next: AppModule) => void;
  /** True, ha a hostname brain.* vagy audit.* — ekkor a dev kapcsoló rejtve marad. */
  isLockedByDomain: boolean;
};

const ModuleContext = createContext<ModuleContextValue | null>(null);

export function ModuleProvider({ children }: { children: ReactNode }) {
  // SSR-en mindig brain (a hostname / localStorage nem ismert).
  // A kliens első renderelése után állítjuk be a valódi értéket.
  const [module, setModuleState] = useState<AppModule>("brain");
  const [isLockedByDomain, setLocked] = useState(false);

  useEffect(() => {
    setModuleState(detectModule());
    setLocked(isProductionSubdomain(window.location.hostname));
  }, []);

  // <html data-module="..."> — a CSS innen tudja, melyik palettát húzza.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-module", module);
  }, [module]);

  const setModule = useCallback((next: AppModule) => {
    if (isProductionSubdomain(window.location.hostname)) {
      // Éles aldomainen nem lehet váltani — a Hub dönti el, hova küldi a tenantot.
      return;
    }
    setModuleOverride(next);
    setModuleState(next);
  }, []);

  const value = useMemo<ModuleContextValue>(
    () => ({
      module,
      meta: MODULE_META[module],
      setModule,
      isLockedByDomain,
    }),
    [module, setModule, isLockedByDomain],
  );

  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>;
}

export function useModule(): ModuleContextValue {
  const ctx = useContext(ModuleContext);
  if (!ctx) {
    throw new Error("useModule() csak ModuleProvider-en belül használható.");
  }
  return ctx;
}
