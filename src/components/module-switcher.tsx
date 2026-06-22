// Dev modul-kapcsoló — csak akkor látszik, ha NEM az éles aldomainen vagyunk.
// A header jobb oldalára kerül, mellette egy info címke jelzi, hogy ez dev funkció.

import { Brain, Bot } from "lucide-react";

import { useModule } from "@/lib/module/provider";
import { cn } from "@/lib/utils";

export function ModuleSwitcher() {
  const { module, setModule, isLockedByDomain } = useModule();

  if (isLockedByDomain) return null;

  return (
    <div
      className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5"
      title="Fejlesztői modul-kapcsoló (preview / dev)"
    >
      <button
        type="button"
        onClick={() => setModule("brain")}
        className={cn(
          "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
          module === "brain"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={module === "brain"}
      >
        <Brain className="size-3.5" />
        Brain
      </button>
      <button
        type="button"
        onClick={() => setModule("audit")}
        className={cn(
          "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
          module === "audit"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={module === "audit"}
      >
        <Bot className="size-3.5" />
        Audit
      </button>
    </div>
  );
}
