import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Loader2,
  CheckCircle2 as CheckIcon,
  XCircle,
  Ban,
  Clock4,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cancelRun } from "@/lib/runs.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PreflightResult = {
  ok?: boolean;
  ip?: string | null;
  country?: string | null;
  country_code?: string | null;
  city?: string | null;
  gateway_country?: string | null;
  expected_country?: string | null;
  error?: string | null;
} | null;

type FingerprintCheck = {
  name?: string;
  ok?: boolean;
  red_flags?: string[];
  total_tests?: number;
  // CreepJS mezők
  headless_pct?: number | null;
  like_headless_pct?: number | null;
  stealth_pct?: number | null;
  lies?: number | null;
  fp_id?: string | null;
  error?: string;
};

type FingerprintAudit = {
  all_ok?: boolean;
  ran_at?: string;
  checks?: FingerprintCheck[];
  error?: string;
} | null;

type RunRow = {
  id: string;
  runner: string;
  status: string;
  external_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  error: string | null;
  preflight_result: PreflightResult;
  result:
    | ({
        fingerprint_audit?: FingerprintAudit;
        checks?: FingerprintCheck[];
        all_ok?: boolean;
      } & Record<string, unknown>)
    | null;
};

async function fetchRuns(workflowId: string): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("brain_workflow_runs")
    .select(
      "id, runner, status, external_id, started_at, finished_at, created_at, error, preflight_result, result",
    )
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data ?? []) as RunRow[];
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: runs = [] } = useQuery({
    queryKey: ["brain_workflow_runs", workflowId],
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
          table: "brain_workflow_runs",
          filter: `workflow_id=eq.${workflowId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["brain_workflow_runs", workflowId] });
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
            const fa: FingerprintAudit =
              r.result?.fingerprint_audit ??
              (Array.isArray(r.result?.checks)
                ? { checks: r.result!.checks, all_ok: r.result!.all_ok }
                : null);
            const sanny = fa?.checks?.find((c) => c.name === "sannysoft");
            const creep = fa?.checks?.find((c) => c.name === "creepjs");
            const isOpen = !!expanded[r.id];
            const hasDetails = !!fa || !!r.preflight_result || !!r.error;
            return (
              <li
                key={r.id}
                className="group rounded-md border bg-background/40 px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2">
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
                    {r.preflight_result && (
                      <div
                        className={cn(
                          "mt-0.5 truncate text-[10px]",
                          r.preflight_result.ok
                            ? "text-emerald-600"
                            : "text-destructive",
                        )}
                      >
                        {r.preflight_result.ok ? "✓" : "✗"} whoer:{" "}
                        {r.preflight_result.ip ?? "?"} ·{" "}
                        {r.preflight_result.country_code ??
                          r.preflight_result.country ??
                          "?"}
                        {r.preflight_result.city
                          ? ` · ${r.preflight_result.city}`
                          : ""}
                      </div>
                    )}
                    {fa && (
                      <div
                        className={cn(
                          "mt-0.5 truncate text-[10px]",
                          fa.all_ok ? "text-emerald-600" : "text-amber-600",
                        )}
                      >
                        {fa.all_ok ? "✓" : "⚠"} fingerprint:
                        {sanny
                          ? ` sanny ${sanny.ok ? "ok" : `❌ (${sanny.red_flags?.length ?? 0})`}`
                          : ""}
                        {creep
                          ? ` · creep ${creep.trust_score != null ? `${creep.trust_score}%` : "n/a"}`
                          : ""}
                      </div>
                    )}
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
                          queryKey: ["brain_workflow_runs", workflowId],
                        });
                      }}
                    >
                      <Ban className="size-3.5" />
                    </Button>
                  )}
                  {hasDetails ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))
                      }
                      className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
                      title={isOpen ? "Bezárás" : "Részletes jelentés"}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                  ) : (
                    <ChevronRight className="size-3 text-muted-foreground/40" />
                  )}
                </div>

                {isOpen && (
                  <div className="mt-2 space-y-2 border-t pt-2 text-[11px]">
                    {r.error && (
                      <div className="rounded bg-destructive/10 p-2 text-destructive">
                        <div className="font-semibold">Hiba</div>
                        <div className="mt-0.5 whitespace-pre-wrap break-words">
                          {r.error}
                        </div>
                      </div>
                    )}

                    {r.preflight_result && (
                      <div className="rounded border p-2">
                        <div className="font-semibold text-muted-foreground">
                          Preflight (whoer.net)
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                          <span className="text-muted-foreground">IP:</span>
                          <span>{r.preflight_result.ip ?? "—"}</span>
                          <span className="text-muted-foreground">Ország:</span>
                          <span>
                            {r.preflight_result.country ?? "—"}{" "}
                            {r.preflight_result.country_code
                              ? `(${r.preflight_result.country_code})`
                              : ""}
                          </span>
                          <span className="text-muted-foreground">Város:</span>
                          <span>{r.preflight_result.city ?? "—"}</span>
                          {r.preflight_result.expected_country && (
                            <>
                              <span className="text-muted-foreground">
                                Elvárt:
                              </span>
                              <span>{r.preflight_result.expected_country}</span>
                            </>
                          )}
                          {r.preflight_result.error && (
                            <>
                              <span className="text-muted-foreground">
                                Hiba:
                              </span>
                              <span className="text-destructive">
                                {r.preflight_result.error}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {fa?.checks?.map((c, i) => (
                      <div key={i} className="rounded border p-2">
                        <div className="flex items-center gap-1.5">
                          {c.ok ? (
                            <CheckIcon className="size-3.5 text-emerald-500" />
                          ) : (
                            <XCircle className="size-3.5 text-amber-600" />
                          )}
                          <span className="font-semibold">
                            {c.name ?? "check"}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] uppercase",
                              c.ok ? "text-emerald-600" : "text-amber-600",
                            )}
                          >
                            {c.ok ? "OK" : "FIGYELEM"}
                          </span>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {c.total_tests != null && (
                            <div>
                              <span className="text-muted-foreground">
                                Tesztek:{" "}
                              </span>
                              {c.total_tests}
                              {c.red_flags
                                ? ` · piros: ${c.red_flags.length}`
                                : ""}
                            </div>
                          )}
                          {c.trust_score != null && (
                            <div>
                              <span className="text-muted-foreground">
                                Trust score:{" "}
                              </span>
                              {c.trust_score}%
                              {c.trust_label ? ` — ${c.trust_label}` : ""}
                            </div>
                          )}
                          {c.lies != null && (
                            <div>
                              <span className="text-muted-foreground">
                                Lies:{" "}
                              </span>
                              {c.lies}
                            </div>
                          )}
                          {c.trust_score == null &&
                            c.name === "creepjs" &&
                            !c.error && (
                              <div className="text-amber-600">
                                A CreepJS nem tudta időben kiszámolni a trust
                                score-t (timeout). A screenshot elmentődött.
                              </div>
                            )}
                          {c.red_flags && c.red_flags.length > 0 && (
                            <div>
                              <div className="text-muted-foreground">
                                Piros zászlók:
                              </div>
                              <ul className="mt-0.5 list-disc pl-4">
                                {c.red_flags.map((f, j) => (
                                  <li key={j} className="break-words">
                                    {f}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {c.error && (
                            <div className="text-destructive">
                              Hiba: {c.error}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
