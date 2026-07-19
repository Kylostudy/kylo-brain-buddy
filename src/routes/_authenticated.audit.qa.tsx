import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
  listExpectedRoutes,
  upsertExpectedRoutes,
  getAuditQaCoverageMatrix,
} from "@/lib/audit-qa.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { MoreVertical, Download, Trash2, ListChecks, CheckCircle2, AlertCircle, MinusCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModule } from "@/lib/module/provider";

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
  const { forceModule } = useModule();
  const startFn = useServerFn(startAuditQaRun);
  const listRunsFn = useServerFn(listAuditQaRuns);
  const listIssuesFn = useServerFn(listAuditQaIssues);
  const updateIssueFn = useServerFn(updateAuditQaIssueStatus);
  const buildPatchFn = useServerFn(buildAuditQaPatchPackage);
  const activityFn = useServerFn(getAuditQaRunActivity);
  const deleteRunFn = useServerFn(deleteAuditQaRun);
  const exportRunFn = useServerFn(exportAuditQaRun);
  const qc = useQueryClient();

  useEffect(() => {
    forceModule("audit");
  }, [forceModule]);

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

  const [exportingRunId, setExportingRunId] = useState<string | null>(null);

  async function handleExport(runId: string) {
    if (exportingRunId) return; // duplakattintás blokk
    setExportingRunId(runId);
    const toastId = toast.loading("Riport összeállítása...");
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
      toast.success("Végleges riport letöltve JSON-ban.", { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: toastId });
    } finally {
      setExportingRunId(null);
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
    <div className="p-4 md:p-6 space-y-6 w-full max-w-[1400px] mx-auto min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Kylo.study QA riport</h1>
          <p className="text-sm text-muted-foreground">
            Robot végigmegy minden oldalon, minden nyelven és skinnel, és minden vizuális + fordítási hibát megjelöl.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 min-w-0 sm:shrink-0">
          <ExpectedRoutesDialog />
          <StartRunDialog onStart={(v) => startMut.mutate(v)} pending={startMut.isPending} />
        </div>
      </div>

      {/* Futások listája */}
      <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2 xl:grid-cols-3">
        {(runsQ.data ?? []).map((r) => {
          const isActiveRun = isRecentlyActiveRun(r);
          const displayStatus = getRunDisplayStatus(r);
          return (
            <div
              key={r.id}
              className={`min-w-0 rounded-md border pl-3 pr-1 py-2 text-sm flex items-start gap-1 ${activeRunId === r.id ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <button onClick={() => setSelectedRunId(r.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate font-medium">{new Date(r.started_at).toLocaleString()}</div>
                <div className="truncate text-xs text-muted-foreground">
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
          <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Státusz" value={getRunDisplayStatus(activeRun)} />
            <StatCard title="Bejárt oldal" value={String(activeRun.total_pages_visited)} />
            <StatCard title="Talált hiba" value={String(activeRun.total_issues_found)} />
            <StatCard
              title="Költség"
              value={`$${Number(activeRun.total_cost_usd).toFixed(2)} / $${Number(activeRun.cost_cap_usd ?? 0).toFixed(0)}`}
            />
          </div>

          <LiveActivityPanel activity={activityQ.data ?? null} />

          {activeRunId && <CoverageMatrixPanel runId={activeRunId} />}





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
            <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row">
              <Button variant="outline" onClick={() => copyPatch("filtered")} className="min-w-0">
                Copy AI patch (szűrt)
              </Button>
              <Button onClick={() => copyPatch("all")} className="min-w-0">Copy AI patch (mind)</Button>
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
        <div className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs space-y-0.5 min-w-0">
          {logs.length === 0 && <div className="text-muted-foreground">Még nincs log — a konténer most indul…</div>}
          {logs.slice(-200).map((l, i) => (
            <div
              key={i}
              className={`break-all whitespace-pre-wrap ${
                l.level === "error"
                  ? "text-red-400"
                  : l.level === "warn"
                    ? "text-yellow-500"
                    : "text-foreground/80"
              }`}
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
    <Card className="min-w-0">
      <CardContent className="p-4 min-w-0">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-xl font-semibold mt-1 truncate">{value}</div>
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

const DEFAULT_LANGS = "hu,en-GB";
const SKIN_OPTIONS = [
  { value: "magic-school", label: "Magic School", note: "stabil" },
  { value: "alaska", label: "Alaska", note: "teszt alatt" },
  { value: "puppy-cat", label: "Puppy Cat", note: "teszt alatt" },
] as const;

const DEFAULT_SKINS = SKIN_OPTIONS.map((skin) => skin.value);

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
  const [skins, setSkins] = useState<string[]>(DEFAULT_SKINS);
  const [baseUrl, setBaseUrl] = useState("https://kylo.study");
  const [cost, setCost] = useState(50);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [maxPages, setMaxPages] = useState(300);

  // Mentett belépési adat hint (email + van-e mentett jelszó) — csak akkor
  // kérjük le, ha a dialóg nyitva van, hogy ne pörögjön feleslegesen.
  const hintFn = useServerFn(getAuditQaCredentialHint);
  const hintQ = useQuery({
    queryKey: ["audit-qa-cred-hint"],
    queryFn: () => hintFn(),
    enabled: open,
    staleTime: 60_000,
  });
  const savedEmail = hintQ.data?.email ?? null;
  const hasSavedPassword = !!hintQ.data?.hasSavedPassword;

  // Ha nyílik a dialóg és még üres az email input, töltsük elő a mentett értékkel.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (open && savedEmail && !prefilledRef.current) {
      if (!email) setEmail(savedEmail);
      prefilledRef.current = true;
    }
    if (!open) prefilledRef.current = false;
  }, [open, savedEmail, email]);

  const canSubmit =
    !!email.trim() && (!!password.trim() || hasSavedPassword);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Új QA futás indítása</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
          <div className="space-y-2">
            <Label>Skinek</Label>
            <div className="grid gap-2">
              {SKIN_OPTIONS.map((skin) => {
                const checked = skins.includes(skin.value);
                return (
                  <label
                    key={skin.value}
                    className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border p-3 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => {
                        setSkins((current) => {
                          if (next === true) return current.includes(skin.value) ? current : [...current, skin.value];
                          const filtered = current.filter((value) => value !== skin.value);
                          return filtered.length > 0 ? filtered : current;
                        });
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{skin.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{skin.value} · {skin.note}</span>
                    </span>
                  </label>
                );
              })}
            </div>
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
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder={savedEmail ?? "email@kylo.study"}
            />
            {savedEmail && email === savedEmail && (
              <p className="text-xs text-muted-foreground mt-1">Mentett email előtöltve — bármikor felülírhatod.</p>
            )}
          </div>
          <div>
            <Label>Jelszó</Label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder={hasSavedPassword ? "•••••••• (mentve — hagyd üresen a régihez)" : "Új jelszó"}
            />
            {hasSavedPassword && !password && (
              <p className="text-xs text-muted-foreground mt-1">
                A workflow-hoz mentett jelszó lesz használva. Csak akkor írj be újat, ha frissíteni akarod.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            🔒 A belépési adatok AES-titkosítva mentődnek a workflow-hoz. A worker a claim
            során kapja meg dekódolva — soha nem megy át specen vagy logon.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Mégse
          </Button>
          <Button
            disabled={pending || !canSubmit}
            onClick={() => {
              onStart({
                languages: langs.split(",").map((s) => s.trim()).filter(Boolean),
                skins,
                baseUrl,
                costCapUsd: cost,
                email: email.trim(),
                password: password.trim(),
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

// ─────────────────────────────────────────────────────────────
// Coverage mátrix — sorok: elvárt path, oszlopok: nyelv×skin
// ─────────────────────────────────────────────────────────────

function CoverageMatrixPanel({ runId }: { runId: string }) {
  const fn = useServerFn(getAuditQaCoverageMatrix);
  const q = useQuery({
    queryKey: ["audit-qa-coverage-matrix", runId],
    queryFn: () => fn({ data: { runId } }),
    refetchInterval: 5000,
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Lefedettségi mátrix</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Töltés…</CardContent>
      </Card>
    );
  }
  const data = q.data;
  if (!data) return null;

  const { combos, rows, totals } = data;
  const expectedRows = rows.filter((r) => r.isExpected);
  const orphanRows = rows.filter((r) => !r.isExpected);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
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
            Nincs még adat. Add meg az elvárt oldalak listáját fent az „Elvárt oldalak" gombbal, és indíts egy futást.
          </div>
        )}
        {expectedRows.length > 0 && (
          <MatrixTable title="Elvárt oldalak (checklista)" combos={combos} rows={expectedRows} />
        )}
        {orphanRows.length > 0 && (
          <div className="border-t">
            <div className="px-4 py-2 text-xs text-muted-foreground">
              Nem tervezett oldalak — a robot felfedezte, de nincsenek a checklistán. Érdemes felvenni.
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
      {title && <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{title}</div>}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-left px-4 py-2 font-medium sticky left-0 bg-background z-10 min-w-[160px]">Route</th>
            {combos.map((c) => (
              <th key={`${c.language}|${c.skin}`} className="px-2 py-2 font-medium whitespace-nowrap">
                <div>{c.language}</div>
                <div className="text-[10px] text-muted-foreground">{c.skin}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-b hover:bg-muted/30">
              <td className="px-4 py-2 sticky left-0 bg-background z-10 font-mono">
                <div className="truncate max-w-[240px]" title={row.path}>{row.path}</div>
                {row.note && !compact && (
                  <div className="text-[10px] text-muted-foreground truncate max-w-[240px]">{row.note}</div>
                )}
              </td>
              {combos.map((c) => {
                const key = `${c.language}|${c.skin}`;
                const cell = row.cells[key];
                return (
                  <td key={key} className="px-2 py-2 text-center">
                    <CoverageCell cell={cell} />
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

// ─────────────────────────────────────────────────────────────
// Elvárt oldalak szerkesztő dialógus
// ─────────────────────────────────────────────────────────────

const DEFAULT_EXPECTED_ROUTES = `# Egy sor = egy oldal. A ':' paramétert jelöl (pl. /kviz/:id).
# '#'-tal kezdődő sor jegyzet. Az útvonal után '#' jegyzet jöhet.
# Példa:
# /                    # landing
# /regisztracio        # login/regisztráció
# /dashboard
# /olvasonaplo
# /kviz
# /kviz/:id
# /beallitasok
# /profil
`;

function parseRoutesText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [rawPath, ...rest] = line.split("#");
      const path = rawPath.trim();
      const note = rest.join("#").trim() || null;
      return { path, note, requires_auth: path !== "/" };
    })
    .filter((r) => r.path.length > 0);
}

function formatRoutesText(rows: Array<{ path: string; note: string | null }>) {
  if (rows.length === 0) return DEFAULT_EXPECTED_ROUTES;
  return rows.map((r) => (r.note ? `${r.path}  # ${r.note}` : r.path)).join("\n") + "\n";
}

function ExpectedRoutesDialog() {
  const listFn = useServerFn(listExpectedRoutes);
  const upsertFn = useServerFn(upsertExpectedRoutes);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const q = useQuery({
    queryKey: ["audit-qa-expected-routes"],
    queryFn: () => listFn(),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (open && q.data) {
      setText(formatRoutesText(q.data));
    }
  }, [open, q.data]);

  const mut = useMutation({
    mutationFn: (paths: Array<{ path: string; note: string | null; requires_auth: boolean }>) =>
      upsertFn({ data: { paths, replaceAll: true } }),
    onSuccess: (res) => {
      toast.success(`Mentve: ${res.count} elvárt oldal.`);
      qc.invalidateQueries({ queryKey: ["audit-qa-expected-routes"] });
      qc.invalidateQueries({ queryKey: ["audit-qa-coverage-matrix"] });
      setOpen(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const count = useMemo(() => parseRoutesText(text).length, [text]);
  const savedCount = q.data?.length ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <ListChecks className="h-4 w-4" />
          Elvárt oldalak
          {savedCount !== null && savedCount > 0 && (
            <Badge variant="secondary" className="ml-1">{savedCount}</Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Elvárt oldalak — a kylo.study checklistája</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add meg a kylo.study összes olyan útvonalát, amit szeretnél lefedni. A robot minden
            futásnál ellenőrzi, hogy ezek mind el lettek-e érve. A statikus oldalakat (`:` nélkül)
            célzottan is meg fogja látogatni, ha a felfedezés kihagyta őket.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-xs min-h-[320px]"
            placeholder={DEFAULT_EXPECTED_ROUTES}
          />
          <div className="text-xs text-muted-foreground">
            Beolvasott sorok: <span className="font-medium">{count}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mut.isPending}>
            Mégse
          </Button>
          <Button
            disabled={mut.isPending}
            onClick={() => mut.mutate(parseRoutesText(text))}
          >
            {mut.isPending ? "Mentés…" : "Mentés"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


