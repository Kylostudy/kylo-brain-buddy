import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import {
  Loader2,
  CheckCircle2 as CheckIcon,
  XCircle,
  Ban,
  Clock4,
  ChevronRight,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cancelRun } from "@/lib/runs.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RunRow = {
  id: string;
  runner: string;
  status: string;
  external_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  error: string | null;
};

async function fetchRuns(workflowId: string): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("workflow_runs")
    .select(
      "id, runner, status, external_id, started_at, finished_at, created_at, error",
    )
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  return data ?? [];
}

const STATUS_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  queued: { label: "Várakozik", icon: Clock4, cls: "text-muted-foreground" },
  running: { label: "Fut", icon: Loader2, cls: "text-primary animate-spin" },
  succeeded: { label: "Sikeres", icon: CheckIcon, cls: "text-emerald-500" },
  failed: { label: "Hiba", icon: XCircle, cls: "text-destructive" },
  cancelled: { label: "Megszakítva", icon: Ban, cls: "text-muted-foreground" },
};

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function RunsPanel({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const callCancel = useServerFn(cancelRun);

  const { data: runs = [] } = useQuery({
    queryKey: ["workflow_runs", workflowId],
    queryFn: () => fetchRuns(workflowId),
    refetchInterval: 2000,
  });

  // Live updates via Supabase realtime (optional but cheap)
  useEffect(() => {
    const channel = supabase
      .channel(`runs:${workflowId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_runs",
          filter: `workflow_id=eq.${workflowId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["workflow_runs", workflowId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workflowId, qc]);

  return (
    <div className="border-t px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Legutóbbi futások
      </h2>

      {runs.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-muted-foreground/70">
          Még nem futott le. Indítsd el a "Teszt indítása" gombbal.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {runs.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.queued;
            const Icon = meta.icon;
            const isActive = r.status === "queued" || r.status === "running";
            return (
              <li
                key={r.id}
                className="group flex items-center gap-2 rounded-md border bg-background/40 px-2.5 py-1.5"
              >
                <Icon className={cn("size-3.5 shrink-0", meta.cls)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{meta.label}</span>
                    <span className="text-[10px] uppercase text-muted-foreground/70">
                      {r.runner}
                    </span>
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {formatTime(r.started_at ?? r.created_at)}
                    {r.error ? ` · ${r.error.slice(0, 40)}` : ""}
                  </div>
                </div>
                {isActive && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="Megszakítás"
                    onClick={async () => {
                      await callCancel({ data: { runId: r.id } });
                      qc.invalidateQueries({
                        queryKey: ["workflow_runs", workflowId],
                      });
                    }}
                  >
                    <Ban className="size-3.5" />
                  </Button>
                )}
                <ChevronRight className="size-3 text-muted-foreground/40" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
