// Shared module types — both client and server can import this.
// The two product surfaces share a single codebase; this enum is the
// only thing that switches behaviour, branding, RLS scope, and log tables.

export type AppModule = "brain" | "audit";

export const APP_MODULES: readonly AppModule[] = ["brain", "audit"] as const;

export function isAppModule(value: unknown): value is AppModule {
  return value === "brain" || value === "audit";
}

export const MODULE_META: Record<
  AppModule,
  {
    label: string;
    fullName: string;
    tagline: string;
    runsTable: "brain_workflow_runs" | "audit_workflow_runs";
  }
> = {
  brain: {
    label: "Brain",
    fullName: "KyloBrain",
    tagline: "Emberi viselkedésű böngésző-automatizáció",
    runsTable: "brain_workflow_runs",
  },
  audit: {
    label: "Audit",
    fullName: "KyloAudit",
    tagline: "Automatikus weboldal-tesztelő robot",
    runsTable: "audit_workflow_runs",
  },
};
