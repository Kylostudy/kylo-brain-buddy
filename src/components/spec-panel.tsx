import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  User,
  Film,
  FolderInput,
  Link2,
  Clock,
  Hash,
  ShieldAlert,
  MousePointerClick,
  Target,
  Circle,
  CheckCircle2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { WorkflowSpec } from "@/lib/chat.functions";
import { cn } from "@/lib/utils";
import { RunsPanel } from "@/components/runs-panel";
import { CredentialsForm } from "@/components/credentials-form";
import { CookieJarBadge } from "@/components/cookie-jar-badge";

type Row = {
  key: keyof WorkflowSpec;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ROWS: Row[] = [
  { key: "platform", label: "Platform", icon: Boxes },
  { key: "account_label", label: "Fiók", icon: User },
  { key: "content_type", label: "Tartalom típusa", icon: Film },
  { key: "content_source", label: "Tartalom forrása", icon: FolderInput },
  { key: "media_source", label: "Konkrét média (teszt)", icon: Link2 },
  { key: "schedule", label: "Ütemezés", icon: Clock },
  { key: "caption_strategy", label: "Caption / hashtag", icon: Hash },
  { key: "kill_switches", label: "Kill switch-ek", icon: ShieldAlert },
  { key: "human_behavior", label: "Emberi viselkedés", icon: MousePointerClick },
  { key: "success_criteria", label: "Sikerkritérium", icon: Target },
];

async function fetchWorkflow(id: string) {
  const { data, error } = await supabase
    .from("workflows")
    .select("spec, ready_for_test, name")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

function renderValue(v: unknown) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    return (
      <ul className="mt-1 space-y-0.5">
        {v.map((item, i) => (
          <li key={i} className="text-sm text-foreground">
            • {String(item)}
          </li>
        ))}
      </ul>
    );
  }
  const s = String(v).trim();
  if (!s) return null;
  return <div className="mt-1 text-sm text-foreground">{s}</div>;
}

export function SpecPanel({ workflowId }: { workflowId: string }) {
  const { data } = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => fetchWorkflow(workflowId),
    refetchInterval: 2000, // keep panel in sync as Brain writes
  });

  const spec = (data?.spec as WorkflowSpec | null) ?? {};
  const filledCount = ROWS.filter((r) => {
    const v = spec[r.key];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === "string" && v.trim().length > 0;
  }).length;

  return (
    <aside className="hidden h-full w-80 shrink-0 flex-col border-l bg-card/30 lg:flex">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Workflow spec
          </h2>
          <span className="text-[10px] text-muted-foreground">
            {filledCount}/{ROWS.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          A Brain élőben tölti, ahogy haladtok.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3 px-4 py-3">
          {ROWS.map((row) => {
            const Icon = row.icon;
            const value = spec[row.key];
            const filled =
              Array.isArray(value)
                ? value.length > 0
                : typeof value === "string" && value.trim().length > 0;
            const rendered = renderValue(value);

            return (
              <div
                key={row.key}
                className={cn(
                  "rounded-md border bg-background/40 p-2.5 transition",
                  filled ? "border-border" : "border-dashed border-border/60",
                )}
              >
                <div className="flex items-center gap-2">
                  {filled ? (
                    <CheckCircle2 className="size-3.5 text-primary" />
                  ) : (
                    <Circle className="size-3.5 text-muted-foreground/50" />
                  )}
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {row.label}
                  </span>
                </div>
                {rendered ?? (
                  <div className="mt-1 text-xs italic text-muted-foreground/60">
                    még nincs megadva
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <CookieJarBadge workflowId={workflowId} />
        <CredentialsForm workflowId={workflowId} />
        <RunsPanel workflowId={workflowId} />
      </div>
    </aside>
  );
}
