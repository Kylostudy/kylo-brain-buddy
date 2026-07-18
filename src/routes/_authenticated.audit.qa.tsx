import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  startAuditQaRun,
  listAuditQaRuns,
  listAuditQaIssues,
  updateAuditQaIssueStatus,
  buildAuditQaPatchPackage,
  getAuditQaRunActivity,
  deleteAuditQaRun,
  exportAuditQaRun,
  getAuditQaCredentialHint,
} from "@/lib/audit-qa.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Download, Trash2 } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/audit/qa")({
  head: () => ({
    meta: [
      { title: "Kylo.study QA — KyloAudit" },
      { name: "description", content: "Automatikus fordítási és vizuális hibakereső riport a Kylo.study oldalhoz." },
    ],
  }),
  component: QaPage,
});

const SEVERITY_ORDER = ["critical", "major", "minor", "info"] as const;
const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/40",
  major: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  minor: "bg-yellow-500/15 text-yellow-500 border-yellow-500/40",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/40",
};

const ACTIVE_RUN_PROTECTION_MS = 10 * 60 * 1000;

function restorePageInteractivity() {
  // Radix overlayeknél ritkán beragadhat a body pointer-events értéke, ha
  // dropdownból nyitunk megerősítő ablakot. Ez okozza a „lefagyott oldal” érzést.
  requestAnimationFrame(() => {
    document.body.style.pointerEvents = "";
  });
}

function isRecentlyActiveRun(run: { status: string; started_at: string | null; updated_at?: string | null }) {
  if (run.status !== "running" && run.status !== "queued") return false;
  const ts = run.updated_at ?? run.started_at;
  const lastActivity = ts ? new Date(ts).getTime() : 0;
  return !!lastActivity && Date.now() - lastActivity < ACTIVE_RUN_PROTECTION_MS;
}

function getRunDisplayStatus(run: { status: string; started_at: string | null; updated_at?: string | null }) {
  if ((run.status === "running" || run.status === "queued") && !isRecentlyActiveRun(run)) return "elakadt";
  return run.status;
}

function canExportFinalRun(run: { status: string }) {
  return ["completed", "failed", "timed_out", "cancelled"].includes(run.status);
}

function QaPage() {
  const startFn = useServerFn(startAuditQaRun);
  const listRunsFn = useServerFn(listAuditQaRuns);
  const listIssuesFn = useServerFn(listAuditQaIssues);
  const updateIssueFn = useServerFn(updateAuditQaIssueStatus);
  const buildPatchFn = useServerFn(buildAuditQaPatchPackage);
  const activityFn = useServerFn(getAuditQaRunActivity);
  const deleteRunFn = useServerFn(deleteAuditQaRun);
  const exportRunFn = useServerFn(exportAuditQaRun);
  const qc = useQueryClient();

  const runsQ = useQuery({
    queryKey: ["audit-qa-runs"],
    queryFn: () => listRunsFn(),
    refetchInterval: 5000,
  });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const activeRunId = selectedRunId ?? runsQ.data?.[0]?.id ?? null;

  const deleteMut = useMutation({
    mutationFn: (runId: string) => deleteRunFn({ data: { runId } }),
    onSuccess: (_res, runId) => {
      toast.success("Riport törölve.");
      if (selectedRunId === runId) setSelectedRunId(null);
      qc.setQueryData<Awaited<ReturnType<typeof listAuditQaRuns>>>(["audit-qa-runs"], (old) =>
        old ? old.filter((run) => run.id !== runId) : old,
      );
      qc.invalidateQueries({ queryKey: ["audit-qa-runs"] });
      qc.removeQueries({ queryKey: ["audit-qa-issues", runId] });
      qc.removeQueries({ queryKey: ["audit-qa-activity", runId] });
      restorePageInteractivity();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : String(e));
      restorePageInteractivity();
    },
    onSettled: () => restorePageInteractivity(),
  });

  async function handleExport(runId: string) {
    try {
      const res = await exportRunFn({ data: { runId, allowSnapshot: false } });
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date(res.run?.started_at ?? Date.now()).toISOString().replace(/[:.]/g, "-");
      a.download = `kylo-qa-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Végleges riport letöltve JSON-ban.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }


  const issuesQ = useQuery({
    queryKey: ["audit-qa-issues", activeRunId],
    queryFn: () => (activeRunId ? listIssuesFn({ data: { runId: activeRunId } }) : Promise.resolve([])),
    enabled: !!activeRunId,
    refetchInterval: 5000,
  });

  const activityQ = useQuery({
    queryKey: ["audit-qa-activity", activeRunId],
    queryFn: () => (activeRunId ? activityFn({ data: { runId: activeRunId } }) : Promise.resolve(null)),
    enabled: !!activeRunId,
    refetchInterval: 2000,
  });

  const startMut = useMutation({
    mutationFn: (input: {
      languages: string[];
      skins: string[];
      baseUrl: string;
      costCapUsd: number;
      email: string;
      password: string;
      maxPagesPerCombo: number;
    }) =>
      startFn({
        data: {
          languages: input.languages,
          skins: input.skins,
          baseUrl: input.baseUrl,
          costCapUsd: input.costCapUsd,
          maxPagesPerCombo: input.maxPagesPerCombo,
          email: input.email,
          password: input.password,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Futás elindult (${res.runId.slice(0, 8)}).`);
      qc.invalidateQueries({ queryKey: ["audit-qa-runs"] });
      setSelectedRunId(res.runId);
    },
    onError: (e: unknown) => toast.error(`Hiba: ${e instanceof Error ? e.message : String(e)}`),
  });

  const activeRun = runsQ.data?.find((r) => r.id === activeRunId) ?? null;
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

  const [filters, setFilters] = useState<{ severity?: string; category?: string; status?: string }>({});
  const filteredIssues = useMemo(() => {
    return issues.filter(
      (i) =>
        (!filters.severity || i.severity === filters.severity) &&
        (!filters.category || i.category === filters.category) &&
        (!filters.status || i.status === filters.status),
    );
  }, [issues, filters]);

  async function copyPatch(scope: "all" | "filtered") {
    if (!activeRunId) return;
    const ids = (scope === "filtered" ? filteredIssues : issues).map((i) => i.id);
    if (ids.length === 0) return toast.error("Nincs hiba a csomagba.");
    try {
      const res = await buildPatchFn({ data: { runId: activeRunId, issueIds: ids } });
      await navigator.clipboard.writeText(res.markdown);
      toast.success(`${res.count} hiba a vágólapon — máris beillesztheted a kylo.study chatjébe.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Kylo.study QA riport</h1>
          <p className="text-sm text-muted-foreground">
            Robot végigmegy minden oldalon, minden nyelven és skinnel, és minden vizuális + fordítási hibát megjelöl.
          </p>
        </div>
        <StartRunDialog onStart={(v) => startMut.mutate(v)} pending={startMut.isPending} />
      </div>

      {/* Futások listája */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {(runsQ.data ?? []).map((r) => {
          const isActiveRun = isRecentlyActiveRun(r);
          const displayStatus = getRunDisplayStatus(r);
          return (
            <div
              key={r.id}
              className={`shrink-0 rounded-md border pl-3 pr-1 py-2 text-sm min-w-[240px] flex items-start gap-1 ${activeRunId === r.id ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <button onClick={() => setSelectedRunId(r.id)} className="flex-1 text-left">
                <div className="font-medium">{new Date(r.started_at).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">
                  {displayStatus} · {r.total_pages_visited} oldal · {r.total_issues_found} hiba · ${Number(r.total_cost_usd).toFixed(2)}
                </div>
              </button>
              <RunActionsMenu
                runId={r.id}
                isActive={isActiveRun}
                canExport={canExportFinalRun(r)}
                isDeleting={deleteMut.isPending && deleteMut.variables === r.id}
                onExport={() => handleExport(r.id)}
                onDelete={() => deleteMut.mutateAsync(r.id)}
              />
            </div>
          );
        })}
        {(runsQ.data ?? []).length === 0 && (
          <div className="text-sm text-muted-foreground">Még nincs futás. Indíts egyet a jobb felső gombbal.</div>
        )}
      </div>

      {activeRun && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <StatCard title="Státusz" value={getRunDisplayStatus(activeRun)} />
            <StatCard title="Bejárt oldal" value={String(activeRun.total_pages_visited)} />
            <StatCard title="Talált hiba" value={String(activeRun.total_issues_found)} />
            <StatCard
              title="Költség"
              value={`$${Number(activeRun.total_cost_usd).toFixed(2)} / $${Number(activeRun.cost_cap_usd ?? 0).toFixed(0)}`}
            />
          </div>

          <LiveActivityPanel activity={activityQ.data ?? null} />



          <Card>
            <CardHeader>
              <CardTitle className="text-base">Súlyosság szerint</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
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
            </CardContent>
          </Card>

          <div className="flex gap-2 flex-wrap items-end">
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
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => copyPatch("filtered")}>
                Copy AI patch (szűrt)
              </Button>
              <Button onClick={() => copyPatch("all")}>Copy AI patch (mind)</Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hibák ({filteredIssues.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {filteredIssues.map((iss) => (
                  <IssueRow
                    key={iss.id}
                    issue={iss}
                    onMark={async (status) => {
                      await updateIssueFn({ data: { id: iss.id, status } });
                      qc.invalidateQueries({ queryKey: ["audit-qa-issues", activeRunId] });
                    }}
                  />
                ))}
                {filteredIssues.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nincs a szűrésnek megfelelő hiba.</div>}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="text-xs text-muted-foreground">
        <Link to="/">← Vissza a főoldalra</Link>
      </div>
    </div>
  );
}

type Activity = Awaited<ReturnType<typeof getAuditQaRunActivity>>;

function LiveActivityPanel({ activity }: { activity: Activity | null }) {
  if (!activity) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Élő aktivitás</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Várom az első jelet a workertől… (VPS orchestrator ~2 mp-enként küld frissítést)
        </CardContent>
      </Card>
    );
  }
  const logs = activity.logs ?? [];
  const isRunning = activity.workerStatus === "running" || activity.workerStatus === "queued" || activity.status === "running";
  const lastLog = logs[logs.length - 1];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isRunning ? "bg-green-500 animate-pulse" : activity.workerStatus === "failed" ? "bg-red-500" : "bg-muted-foreground"
            }`}
          />
          Élő aktivitás
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          worker: {activity.workerStatus ?? "—"} · {logs.length} log sor
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {activity.error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            <div className="font-semibold mb-1">Hibaüzenet a workertől</div>
            <div className="font-mono whitespace-pre-wrap break-words text-xs">{activity.error}</div>
          </div>
        )}
        {isRunning && lastLog && (
          <div className="text-sm">
            <span className="text-muted-foreground">Épp:</span>{" "}
            <span className="font-medium">{lastLog.message}</span>
          </div>
        )}
        <div className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs space-y-0.5">
          {logs.length === 0 && <div className="text-muted-foreground">Még nincs log — a konténer most indul…</div>}
          {logs.slice(-200).map((l, i) => (
            <div
              key={i}
              className={
                l.level === "error"
                  ? "text-red-400"
                  : l.level === "warn"
                    ? "text-yellow-500"
                    : "text-foreground/80"
              }
            >
              <span className="text-muted-foreground">{new Date(l.ts).toLocaleTimeString()}</span>{" "}
              {l.message}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
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
        <SelectTrigger className="w-[160px]">
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

type IssueLike = Awaited<ReturnType<typeof listAuditQaIssues>>[number];

function IssueRow({ issue, onMark }: { issue: IssueLike; onMark: (s: "open" | "fixed" | "wont_fix" | "duplicate") => void }) {
  return (
    <div className="p-3 flex gap-3 items-start hover:bg-muted/30">
      <Badge variant="outline" className={SEVERITY_COLOR[issue.severity] ?? ""}>
        {issue.severity}
      </Badge>
      <Badge variant="secondary">{issue.category}</Badge>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{issue.ai_diagnosis || "(diagnózis nélkül)"}</div>
        <div className="text-xs text-muted-foreground truncate">
          {issue.page_url} · {issue.language ?? "?"}/{issue.skin ?? "?"}
          {issue.problematic_text ? ` · "${issue.problematic_text.slice(0, 100)}"` : ""}
        </div>
        {issue.ai_suggested_fix && <div className="text-xs mt-1 text-muted-foreground">💡 {issue.ai_suggested_fix}</div>}
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

const DEFAULT_LANGS = "hu,en";
const DEFAULT_SKINS = "magic-school,alaska";

function StartRunDialog({
  onStart,
  pending,
}: {
  onStart: (v: {
    languages: string[];
    skins: string[];
    baseUrl: string;
    costCapUsd: number;
    email: string;
    password: string;
    maxPagesPerCombo: number;
  }) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [langs, setLangs] = useState(DEFAULT_LANGS);
  const [skins, setSkins] = useState(DEFAULT_SKINS);
  const [baseUrl, setBaseUrl] = useState("https://kylo.study");
  const [cost, setCost] = useState(50);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [maxPages, setMaxPages] = useState(40);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Új QA futás indítása</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Kylo.study QA — új futás</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div>
            <Label>Nyelvek (vesszővel)</Label>
            <Input value={langs} onChange={(e) => setLangs(e.target.value)} placeholder="hu,en" />
          </div>
          <div>
            <Label>Skinek (vesszővel)</Label>
            <Input value={skins} onChange={(e) => setSkins(e.target.value)} placeholder="magic-school,alaska" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Költségplafon (USD)</Label>
              <Input type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
            </div>
            <div>
              <Label>Max oldal / kombináció</Label>
              <Input type="number" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label>Bejelentkező email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
          <div>
            <Label>Jelszó</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
          </div>
          <p className="text-xs text-muted-foreground">
            🔒 Az email és jelszó AES-titkosítva mentődik a workflow_credentials táblába. A worker a claim
            során kapja meg dekódolva — soha nem megy át spec-en vagy logon.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Mégse
          </Button>
          <Button
            disabled={pending || !email || !password}
            onClick={() => {
              onStart({
                languages: langs.split(",").map((s) => s.trim()).filter(Boolean),
                skins: skins.split(",").map((s) => s.trim()).filter(Boolean),
                baseUrl,
                costCapUsd: cost,
                email,
                password,
                maxPagesPerCombo: maxPages,
              });
              setOpen(false);
            }}
          >
            {pending ? "Indítás…" : "Indít"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunActionsMenu({
  isActive,
  canExport,
  isDeleting,
  onExport,
  onDelete,
}: {
  runId: string;
  isActive: boolean;
  canExport: boolean;
  isDeleting: boolean;
  onExport: () => void;
  onDelete: () => Promise<unknown>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleConfirmedDelete() {
    try {
      await onDelete();
    } finally {
      setConfirmOpen(false);
      restorePageInteractivity();
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Riport műveletek">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onExport} disabled={!canExport}>
            <Download className="mr-2 h-4 w-4" />
            {canExport ? "Export (végleges JSON)" : "Export csak kész riportnál"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-red-500 focus:text-red-500"
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              window.setTimeout(() => setConfirmOpen(true), 0);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {isActive ? "Törlés kérése" : "Törlés"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Biztosan törlöd ezt a riportot?</AlertDialogTitle>
            <AlertDialogDescription>
              Ez véglegesen törli a futást, az összes hibát, a lefedettségi adatokat és a screenshotokat.
              Exportáld előtte, ha szükséged lehet rá.
              {isActive ? " Ha tényleg még fut, a rendszer nem fogja engedni a törlést." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Mégse</AlertDialogCancel>
            <Button
              className="bg-red-600 hover:bg-red-700"
              disabled={isDeleting}
              onClick={handleConfirmedDelete}
            >
              {isDeleting ? "Törlés…" : "Törlés"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

