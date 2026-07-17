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
} from "@/lib/audit-qa.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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

function QaPage() {
  const startFn = useServerFn(startAuditQaRun);
  const listRunsFn = useServerFn(listAuditQaRuns);
  const listIssuesFn = useServerFn(listAuditQaIssues);
  const updateIssueFn = useServerFn(updateAuditQaIssueStatus);
  const buildPatchFn = useServerFn(buildAuditQaPatchPackage);
  const qc = useQueryClient();

  const runsQ = useQuery({
    queryKey: ["audit-qa-runs"],
    queryFn: () => listRunsFn(),
    refetchInterval: 5000,
  });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const activeRunId = selectedRunId ?? runsQ.data?.[0]?.id ?? null;

  const issuesQ = useQuery({
    queryKey: ["audit-qa-issues", activeRunId],
    queryFn: () => (activeRunId ? listIssuesFn({ data: { runId: activeRunId } }) : Promise.resolve([])),
    enabled: !!activeRunId,
    refetchInterval: 5000,
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
        {(runsQ.data ?? []).map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedRunId(r.id)}
            className={`shrink-0 rounded-md border px-3 py-2 text-sm text-left min-w-[220px] ${activeRunId === r.id ? "border-primary bg-primary/5" : "border-border"}`}
          >
            <div className="font-medium">{new Date(r.started_at).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">
              {r.status} · {r.total_pages_visited} oldal · {r.total_issues_found} hiba · ${Number(r.total_cost_usd).toFixed(2)}
            </div>
          </button>
        ))}
        {(runsQ.data ?? []).length === 0 && (
          <div className="text-sm text-muted-foreground">Még nincs futás. Indíts egyet a jobb felső gombbal.</div>
        )}
      </div>

      {activeRun && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <StatCard title="Státusz" value={activeRun.status} />
            <StatCard title="Bejárt oldal" value={String(activeRun.total_pages_visited)} />
            <StatCard title="Talált hiba" value={String(activeRun.total_issues_found)} />
            <StatCard
              title="Költség"
              value={`$${Number(activeRun.total_cost_usd).toFixed(2)} / $${Number(activeRun.cost_cap_usd ?? 0).toFixed(0)}`}
            />
          </div>

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
          <Textarea
            readOnly
            className="text-xs h-16"
            value="Az email/jelszó egyelőre a workflow credentials rendszerbe kell kerüljön a megbízható tároláshoz. Ezt a következő iterációban kötjük össze — most a workernek küldött specben menne, ami nem biztonságos éles adatoknál."
          />
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
