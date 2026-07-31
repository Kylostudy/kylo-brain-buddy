import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ListChecks, MinusCircle } from "lucide-react";

import {
  listAuditQaIssues,
  updateAuditQaIssueStatus,
  buildAuditQaPatchPackage,
  getAuditQaRunActivity,
  getAuditQaCoverageMatrix,
  exportAuditQaRun,
  explainAuditQaRun,
} from "@/lib/audit-qa.functions";
import { AiExplanationBlock } from "@/components/audit-qa/ai-explanation-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const SEVERITY_ORDER = ["critical", "major", "minor", "info"] as const;
export const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/40",
  major: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  minor: "bg-yellow-500/15 text-yellow-500 border-yellow-500/40",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/40",
};

export type QaRun = {
  id: string;
  status: string;
  base_url: string;
  config: unknown;
  total_pages_visited: number;
  total_issues_found: number;
  total_cost_usd: number;
  cost_cap_usd: number | null;
  started_at: string;
  updated_at?: string | null;
  finished_at?: string | null;
  ai_explanation?: unknown;
};

export function readQaConfig(config: unknown): { languages?: string[]; skins?: string[]; maxPagesPerCombo?: number; diffMode?: boolean } {
  if (!config || typeof config !== "object") return {};
  return config as never;
}

export function canExportFinalRun(run: { status: string }) {
  return ["completed", "failed", "timed_out", "cancelled"].includes(run.status);
}

export function QaRunDetailsDialog({
  run,
  displayStatus,
  onDelete,
}: {
  run: QaRun;
  displayStatus: string;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cfg = readQaConfig(run.config);
  const exportFn = useServerFn(exportAuditQaRun);
  const explainFn = useServerFn(explainAuditQaRun);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    const toastId = toast.loading("Riport összeállítása…");
    try {
      const res = await exportFn({ data: { runId: run.id, allowSnapshot: false } });
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date(run.started_at ?? Date.now()).toISOString().replace(/[:.]/g, "-");
      a.download = `kylo-qa-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Riport letöltve.", { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: toastId });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Megnyit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center justify-between gap-3">
            <span>QA futás — {new Date(run.started_at).toLocaleString("hu-HU")}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!canExportFinalRun(run) || exporting} onClick={handleExport}>
                {exporting ? "Készül…" : "Riport letöltése (JSON)"}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={onDelete}>
                Törlés
              </Button>
            </span>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex w-full flex-wrap">
            <TabsTrigger value="overview">Áttekintés</TabsTrigger>
            <TabsTrigger value="issues">Hibák</TabsTrigger>
            <TabsTrigger value="coverage">Lefedettség</TabsTrigger>
            <TabsTrigger value="activity">Élő aktivitás</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard title="Státusz" value={displayStatus} />
              <StatCard title="Bejárt oldal" value={String(run.total_pages_visited)} />
              <StatCard title="Talált hiba" value={String(run.total_issues_found)} />
              <StatCard
                title="Költség"
                value={`$${Number(run.total_cost_usd).toFixed(2)} / $${Number(run.cost_cap_usd ?? 0).toFixed(0)}`}
              />
            </div>
            <div className="space-y-1 rounded-md border p-3 text-sm">
              <div>
                <span className="text-muted-foreground">Cím:</span> {run.base_url}
              </div>
              <div>
                <span className="text-muted-foreground">Nyelvek:</span> {(cfg.languages ?? []).join(", ") || "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Skinek:</span> {(cfg.skins ?? []).join(", ") || "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Max oldal / kombináció:</span> {cfg.maxPagesPerCombo ?? "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Diff-mód:</span> {cfg.diffMode === false ? "ki" : "be"}
              </div>
              <div>
                <span className="text-muted-foreground">Befejezve:</span>{" "}
                {run.finished_at ? new Date(run.finished_at).toLocaleString("hu-HU") : "—"}
              </div>
            </div>
            <AiExplanationBlock
              runId={run.id}
              enabled={open}
              initial={(run.ai_explanation ?? null) as { text?: string; generated_at?: string } | null}
              explain={explainFn}
            />
          </TabsContent>

          <TabsContent value="issues">
            <IssuesTab runId={run.id} enabled={open} />
          </TabsContent>

          <TabsContent value="coverage">
            {open && <CoverageMatrixPanel runId={run.id} />}
          </TabsContent>

          <TabsContent value="activity">
            {open && <LiveActivityPanel runId={run.id} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card className="min-w-0">
      <CardContent className="min-w-0 p-3">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="mt-1 truncate text-lg font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

// ── Hibák fül ──────────────────────────────────────────────

type IssueLike = Awaited<ReturnType<typeof listAuditQaIssues>>[number];

function IssuesTab({ runId, enabled }: { runId: string; enabled: boolean }) {
  const qc = useQueryClient();
  const listIssuesFn = useServerFn(listAuditQaIssues);
  const updateIssueFn = useServerFn(updateAuditQaIssueStatus);
  const buildPatchFn = useServerFn(buildAuditQaPatchPackage);
  const [filters, setFilters] = useState<{ severity?: string; category?: string; status?: string }>({});

  const issuesQ = useQuery({
    queryKey: ["audit-qa-issues", runId],
    queryFn: () => listIssuesFn({ data: { runId } }),
    enabled,
    refetchInterval: 5000,
  });
  const issues = issuesQ.data ?? [];

  const byCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of issues) m[i.category] = (m[i.category] ?? 0) + 1;
    return m;
  }, [issues]);

  const bySeverity = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of issues) m[i.severity] = (m[i.severity] ?? 0) + 1;
    return m;
  }, [issues]);

  const filtered = useMemo(
    () =>
      issues.filter(
        (i) =>
          (!filters.severity || i.severity === filters.severity) &&
          (!filters.category || i.category === filters.category) &&
          (!filters.status || i.status === filters.status),
      ),
    [issues, filters],
  );

  async function copyPatch(scope: "all" | "filtered") {
    const ids = (scope === "filtered" ? filtered : issues).map((i) => i.id);
    if (ids.length === 0) return toast.error("Nincs hiba a csomagba.");
    try {
      const res = await buildPatchFn({ data: { runId, issueIds: ids } });
      await navigator.clipboard.writeText(res.markdown);
      toast.success(`${res.count} hiba a vágólapon.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SEVERITY_ORDER.map((s) => (
          <Badge key={s} variant="outline" className={SEVERITY_COLOR[s]}>
            {s}: {bySeverity[s] ?? 0}
          </Badge>
        ))}
        {Object.entries(byCategory).map(([c, n]) => (
          <Badge key={c} variant="secondary">
            {c}: {n}
          </Badge>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <FilterSelect
          label="Súlyosság"
          value={filters.severity}
          onChange={(v) => setFilters((f) => ({ ...f, severity: v }))}
          options={["critical", "major", "minor", "info"]}
        />
        <FilterSelect
          label="Kategória"
          value={filters.category}
          onChange={(v) => setFilters((f) => ({ ...f, category: v }))}
          options={Object.keys(byCategory)}
        />
        <FilterSelect
          label="Státusz"
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={["open", "fixed", "wont_fix", "duplicate"]}
        />
        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row">
          <Button variant="outline" size="sm" onClick={() => copyPatch("filtered")}>
            Copy AI patch (szűrt)
          </Button>
          <Button size="sm" onClick={() => copyPatch("all")}>
            Copy AI patch (mind)
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hibák ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {filtered.map((iss) => (
              <IssueRow
                key={iss.id}
                issue={iss}
                onMark={async (status) => {
                  await updateIssueFn({ data: { id: iss.id, status } });
                  qc.invalidateQueries({ queryKey: ["audit-qa-issues", runId] });
                }}
              />
            ))}
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">Nincs a szűrésnek megfelelő hiba.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  options: string[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value ?? "__all__"} onValueChange={(v) => onChange(v === "__all__" ? undefined : v)}>
        <SelectTrigger className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">mind</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function IssueRow({ issue, onMark }: { issue: IssueLike; onMark: (s: "open" | "fixed" | "wont_fix" | "duplicate") => void }) {
  return (
    <div className="flex items-start gap-3 p-3 hover:bg-muted/30">
      <Badge variant="outline" className={SEVERITY_COLOR[issue.severity] ?? ""}>
        {issue.severity}
      </Badge>
      <Badge variant="secondary">{issue.category}</Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{issue.ai_diagnosis || "(diagnózis nélkül)"}</div>
        <div className="truncate text-xs text-muted-foreground">
          {issue.page_url} · {issue.language ?? "?"}/{issue.skin ?? "?"}
          {issue.problematic_text ? ` · "${issue.problematic_text.slice(0, 100)}"` : ""}
        </div>
        {issue.ai_suggested_fix && <div className="mt-1 text-xs text-muted-foreground">💡 {issue.ai_suggested_fix}</div>}
      </div>
      <div className="flex gap-1">
        {issue.status === "open" ? (
          <>
            <Button size="sm" variant="outline" onClick={() => onMark("fixed")}>
              Fixed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onMark("wont_fix")}>
              Ignore
            </Button>
          </>
        ) : (
          <Badge>{issue.status}</Badge>
        )}
      </div>
    </div>
  );
}

// ── Élő aktivitás ──────────────────────────────────────────

function LiveActivityPanel({ runId }: { runId: string }) {
  const activityFn = useServerFn(getAuditQaRunActivity);
  const { data: activity } = useQuery({
    queryKey: ["audit-qa-activity", runId],
    queryFn: () => activityFn({ data: { runId } }),
    refetchInterval: 2000,
  });

  if (!activity) {
    return (
      <div className="text-sm text-muted-foreground">
        Várom az első jelet a workertől… (a szerver ~2 mp-enként küld frissítést)
      </div>
    );
  }
  const logs = activity.logs ?? [];
  const isRunning = activity.workerStatus === "running" || activity.workerStatus === "queued" || activity.status === "running";
  const lastLog = logs[logs.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isRunning ? "animate-pulse bg-green-500" : activity.workerStatus === "failed" ? "bg-red-500" : "bg-muted-foreground"
            }`}
          />
          worker: {activity.workerStatus ?? "—"}
        </span>
        <span>{logs.length} log sor</span>
      </div>
      {activity.error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <div className="mb-1 font-semibold">Hibaüzenet a workertől</div>
          <div className="whitespace-pre-wrap break-words font-mono text-xs">{activity.error}</div>
        </div>
      )}
      {isRunning && lastLog && (
        <div className="text-sm">
          <span className="text-muted-foreground">Épp:</span> <span className="font-medium">{lastLog.message}</span>
        </div>
      )}
      <div className="min-w-0 max-h-64 space-y-0.5 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
        {logs.length === 0 && <div className="text-muted-foreground">Még nincs log — a konténer most indul…</div>}
        {logs.slice(-200).map((l, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-all ${
              l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-yellow-500" : "text-foreground/80"
            }`}
          >
            <span className="text-muted-foreground">{new Date(l.ts).toLocaleTimeString()}</span> {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Lefedettségi mátrix ────────────────────────────────────

function CoverageMatrixPanel({ runId }: { runId: string }) {
  const fn = useServerFn(getAuditQaCoverageMatrix);
  const q = useQuery({
    queryKey: ["audit-qa-coverage-matrix", runId],
    queryFn: () => fn({ data: { runId } }),
    refetchInterval: 5000,
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Töltés…</div>;
  const data = q.data;
  if (!data) return null;

  const { combos, rows, totals } = data;
  const expectedRows = rows.filter((r) => r.isExpected);
  const orphanRows = rows.filter((r) => !r.isExpected);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4" />
          Lefedettségi mátrix
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {totals.coveredCount}/{totals.expectedCount} elvárt oldal érintve
          {totals.orphanCount > 0 && ` · ${totals.orphanCount} nem tervezett oldal`}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {expectedRows.length === 0 && orphanRows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            Nincs még adat. Add meg az elvárt oldalak listáját, és indíts egy futást.
          </div>
        )}
        {expectedRows.length > 0 && <MatrixTable title="Elvárt oldalak (checklista)" combos={combos} rows={expectedRows} />}
        {orphanRows.length > 0 && (
          <div className="border-t">
            <div className="px-4 py-2 text-xs text-muted-foreground">
              Nem tervezett oldalak — a robot felfedezte, de nincsenek a checklistán.
            </div>
            <MatrixTable title="" combos={combos} rows={orphanRows} compact />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type MatrixRow = Awaited<ReturnType<typeof getAuditQaCoverageMatrix>>["rows"][number];
type MatrixCombo = Awaited<ReturnType<typeof getAuditQaCoverageMatrix>>["combos"][number];

function MatrixTable({
  title,
  combos,
  rows,
  compact,
}: {
  title: string;
  combos: MatrixCombo[];
  rows: MatrixRow[];
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      {title && <div className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">{title}</div>}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 z-10 min-w-[160px] bg-background px-4 py-2 text-left font-medium">Route</th>
            {combos.map((c) => (
              <th key={`${c.language}|${c.skin}`} className="whitespace-nowrap px-2 py-2 font-medium">
                <div>{c.language}</div>
                <div className="text-[10px] text-muted-foreground">{c.skin}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-b hover:bg-muted/30">
              <td className="sticky left-0 z-10 bg-background px-4 py-2 font-mono">
                <div className="max-w-[240px] truncate" title={row.path}>
                  {row.path}
                </div>
                {row.note && !compact && (
                  <div className="max-w-[240px] truncate text-[10px] text-muted-foreground">{row.note}</div>
                )}
              </td>
              {combos.map((c) => {
                const key = `${c.language}|${c.skin}`;
                return (
                  <td key={key} className="px-2 py-2 text-center">
                    <CoverageCell cell={row.cells[key]} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageCell({ cell }: { cell: { visited: boolean; issueCount: number; urls: string[] } | undefined }) {
  if (!cell || !cell.visited) {
    return (
      <span title="Nem járt itt" className="inline-flex items-center text-muted-foreground/50">
        <MinusCircle className="h-4 w-4" />
      </span>
    );
  }
  if (cell.issueCount === 0) {
    return (
      <span title={`Rendben (${cell.urls.length} URL)`} className="inline-flex items-center text-green-500">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span title={`${cell.issueCount} nyitott hiba`} className="inline-flex items-center gap-1 text-orange-500">
      <AlertCircle className="h-4 w-4" />
      <span className="text-[10px] font-medium">{cell.issueCount}</span>
    </span>
  );
}
