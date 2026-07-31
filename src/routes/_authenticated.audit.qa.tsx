import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  startAuditQaRun,
  listAuditQaRuns,
  deleteAuditQaRun,
  deleteAuditQaRuns,
  getAuditQaCredentialHint,
  listExpectedRoutes,
  upsertExpectedRoutes,
} from "@/lib/audit-qa.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ListChecks } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

import { useModule } from "@/lib/module/provider";
import { SchedulesPanel } from "@/components/audit-qa/schedules-panel";
import { QaSummaryCard } from "@/components/audit-qa/qa-summary-card";
import { QaErrorLog } from "@/components/audit-qa/qa-error-log";
import { QaRunDetailsDialog, readQaConfig, type QaRun } from "@/components/audit-qa/qa-run-details-dialog";

export const Route = createFileRoute("/_authenticated/audit/qa")({
  head: () => ({
    meta: [
      { title: "Kylo.study QA — KyloAudit" },
      { name: "description", content: "Automatikus fordítási és vizuális hibakereső riport a Kylo.study oldalhoz." },
      { property: "og:title", content: "Kylo.study QA — KyloAudit" },
      { property: "og:description", content: "Automatikus fordítási és vizuális hibakereső riport a Kylo.study oldalhoz." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QaPage,
});

const ACTIVE_RUN_PROTECTION_MS = 10 * 60 * 1000;

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

function statusColor(s: string) {
  if (s === "completed") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
  if (s === "failed" || s === "timed_out") return "bg-red-500/15 text-red-400 border-red-500/40";
  if (s === "running") return "bg-blue-500/15 text-blue-400 border-blue-500/40";
  if (s === "elakadt") return "bg-amber-500/15 text-amber-400 border-amber-500/40";
  return "bg-yellow-500/15 text-yellow-500 border-yellow-500/40";
}

function QaPage() {
  const { forceModule } = useModule();
  const startFn = useServerFn(startAuditQaRun);
  const listRunsFn = useServerFn(listAuditQaRuns);
  const deleteRunFn = useServerFn(deleteAuditQaRun);
  const bulkDeleteFn = useServerFn(deleteAuditQaRuns);
  const qc = useQueryClient();

  useEffect(() => {
    forceModule("audit");
  }, [forceModule]);

  const runsQ = useQuery({
    queryKey: ["audit-qa-runs"],
    queryFn: () => listRunsFn(),
    refetchInterval: 5000,
  });
  const runs = (runsQ.data ?? []) as unknown as QaRun[];

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["audit-qa-runs"] });
    qc.invalidateQueries({ queryKey: ["audit-qa-summary"] });
    qc.invalidateQueries({ queryKey: ["audit-qa-aggregated-issues"] });
  }

  const deleteMut = useMutation({
    mutationFn: (runId: string) => deleteRunFn({ data: { runId } }),
    onSuccess: () => {
      toast.success("Riport törölve.");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = runs.length > 0 && runs.every((r) => selected.has(r.id));
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(runs.map((r) => r.id)));
  }

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteFn({ data: { runIds: ids } }),
    onSuccess: (res) => {
      toast.success(
        `${res.deleted} riport törölve${res.skippedActive ? ` · ${res.skippedActive} kihagyva (még aktív)` : ""}`,
      );
      setSelected(new Set());
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
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
      diffMode: boolean;
    }) => startFn({ data: input }),
    onSuccess: (res) => {
      toast.success(`Futás elindult (${res.runId.slice(0, 8)}).`);
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "queued");

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 px-3 py-6 sm:px-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Kylo.study QA riport</h1>
          <p className="text-sm text-muted-foreground">
            Robot végigmegy minden oldalon, minden nyelven és skinnel, és minden vizuális + fordítási hibát megjelöl.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0">
          <ExpectedRoutesDialog />
          <StartRunDialog onStart={(v) => startMut.mutate(v)} pending={startMut.isPending} />
        </div>
      </div>

      <SchedulesPanel />

      {/* Sorban álló / futó */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sorban álló / futó ({activeRuns.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {activeRuns.length === 0 && <div className="text-muted-foreground">Most nincs futó QA ellenőrzés.</div>}
          {activeRuns.map((r) => {
            const cfg = readQaConfig(r.config);
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {new Date(r.started_at).toLocaleString("hu-HU")} · {(cfg.languages ?? []).join(", ") || "?"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.total_pages_visited} oldal · {r.total_issues_found} hiba · ${Number(r.total_cost_usd).toFixed(2)}
                  </div>
                </div>
                <Badge variant="outline" className={statusColor(getRunDisplayStatus(r))}>
                  {getRunDisplayStatus(r)}
                </Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <QaSummaryCard />

      <QaErrorLog />

      {/* Legutóbbi futások */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Legutóbbi futások</CardTitle>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="size-4 accent-primary" checked={allSelected} onChange={toggleAll} />
              Összes kijelölése
            </label>
            <Button
              size="sm"
              variant="outline"
              className="text-red-400 hover:text-red-300"
              disabled={selected.size === 0 || bulkDeleteMut.isPending}
              onClick={() => {
                if (window.confirm(`Biztos törlöd a kijelölt ${selected.size} riportot? Ez nem visszavonható.`)) {
                  bulkDeleteMut.mutate(Array.from(selected));
                }
              }}
            >
              {bulkDeleteMut.isPending ? "Törlés…" : `Kijelöltek törlése (${selected.size})`}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {runsQ.isLoading && <div className="text-sm text-muted-foreground">Betöltés…</div>}
          {!runsQ.isLoading && runs.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Még nincs futás. Kattints az „Új QA futás indítása" gombra.
            </div>
          )}
          {runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Összes kijelölése"
                      />
                    </th>
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Idő</th>
                    <th className="py-2 pr-3">Státusz</th>
                    <th className="py-2 pr-3">Nyelvek</th>
                    <th className="py-2 pr-3">Skinek</th>
                    <th className="py-2 pr-3">Oldal</th>
                    <th className="py-2 pr-3">Hiba</th>
                    <th className="py-2 pr-3">Költség</th>
                    <th className="py-2 pr-3">Részletek</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, idx) => {
                    const cfg = readQaConfig(r.config);
                    const displayStatus = getRunDisplayStatus(r);
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={selected.has(r.id)}
                            onChange={() => toggleOne(r.id)}
                            aria-label="Riport kijelölése"
                          />
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{runs.length - idx}</td>
                        <td className="py-2 pr-3">{new Date(r.started_at).toLocaleString("hu-HU")}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className={statusColor(displayStatus)}>
                            {displayStatus}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">{(cfg.languages ?? []).join(", ") || "—"}</td>
                        <td className="py-2 pr-3">{(cfg.skins ?? []).join(", ") || "—"}</td>
                        <td className="py-2 pr-3">{r.total_pages_visited}</td>
                        <td className="py-2 pr-3">{r.total_issues_found}</td>
                        <td className="py-2 pr-3">${Number(r.total_cost_usd).toFixed(2)}</td>
                        <td className="py-2 pr-3">
                          <QaRunDetailsDialog
                            run={r}
                            displayStatus={displayStatus}
                            onDelete={() => {
                              if (window.confirm("Biztos törlöd ezt a riportot? Ez nem visszavonható.")) {
                                deleteMut.mutate(r.id);
                              }
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 text-right">
            <Button variant="ghost" size="sm" onClick={() => refreshAll()}>
              Frissítés
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        <Link to="/">← Vissza a főoldalra</Link>
      </div>
    </div>
  );
}

const DEFAULT_LANGS = "hu,en-GB";
const SKIN_OPTIONS = [
  { value: "magic-school", label: "Magic School", note: "fő skin" },
  { value: "alaska", label: "Alaska", note: "prémium" },
  { value: "puppy-cat", label: "Puppy Cat", note: "prémium" },
  { value: "minimal-zold", label: "Minimal Zöld", note: "minimal" },
  { value: "minimal-kek", label: "Minimal Kék", note: "minimal" },
  { value: "minimal-piros", label: "Minimal Piros", note: "minimal" },
  { value: "minimal-lila", label: "Minimal Lila", note: "minimal" },
  { value: "minimal-arany", label: "Minimal Arany", note: "minimal" },
  { value: "minimal-turkiz", label: "Minimal Türkiz", note: "minimal" },
] as const;

const ALL_SKINS = SKIN_OPTIONS.map((skin) => skin.value);
const DEFAULT_SKINS = ["magic-school"];

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
    diffMode: boolean;
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
  const [diffMode, setDiffMode] = useState(true);

  const hintFn = useServerFn(getAuditQaCredentialHint);
  const hintQ = useQuery({
    queryKey: ["audit-qa-cred-hint"],
    queryFn: () => hintFn(),
    enabled: open,
    staleTime: 60_000,
  });
  const savedEmail = hintQ.data?.email ?? null;
  const hasSavedPassword = !!hintQ.data?.hasSavedPassword;

  const prefilledRef = useRef(false);
  useEffect(() => {
    if (open && savedEmail && !prefilledRef.current) {
      if (!email) setEmail(savedEmail);
      prefilledRef.current = true;
    }
    if (!open) prefilledRef.current = false;
  }, [open, savedEmail, email]);

  const canSubmit = !!email.trim() && (!!password.trim() || hasSavedPassword);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Új QA futás indítása</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kylo.study QA — új futás</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Preset</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLangs("hu,en-GB,de,es,fr,it,pl,pt,ro");
                  setSkins(["magic-school"]);
                }}
              >
                Fordítás-teszt
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLangs("en-GB");
                  setSkins([...ALL_SKINS]);
                }}
              >
                Megjelenés-teszt (9 skin)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLangs("en-GB,hu,de");
                  setSkins(["magic-school"]);
                }}
              >
                Alap 3 nyelv (EN/HU/DE)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLangs("ar");
                  setSkins(["magic-school"]);
                }}
              >
                RTL nyelvek (arab)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLangs("ja,zh,ko,hi");
                  setSkins(["magic-school"]);
                }}
              >
                Ázsiai nyelvek (JA/ZH/KO/HI)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLangs(DEFAULT_LANGS);
                  setSkins(DEFAULT_SKINS);
                }}
              >
                Alapértelmezett
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              A preset kitölti a nyelveket és skineket. Kézzel bármit felülírhatsz.
            </p>
          </div>
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
                      <span className="block truncate text-xs text-muted-foreground">
                        {skin.value} · {skin.note}
                      </span>
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
              <p className="mt-1 text-xs text-muted-foreground">Mentett email előtöltve — bármikor felülírhatod.</p>
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
              <p className="mt-1 text-xs text-muted-foreground">
                A workflow-hoz mentett jelszó lesz használva. Csak akkor írj be újat, ha frissíteni akarod.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            🔒 A belépési adatok titkosítva mentődnek a workflow-hoz. A worker a claim során kapja meg dekódolva —
            soha nem megy át specen vagy logon.
          </p>
          <div className="rounded-md border bg-muted/30 p-3">
            <label className="flex cursor-pointer items-start gap-2">
              <Checkbox checked={diffMode} onCheckedChange={(v) => setDiffMode(v === true)} className="mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium">Diff-mód (költségtakarékos)</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Ha egy oldalt egy korábbi <b>befejezett</b> futásban már elemeztünk és a tartalma nem változott,
                  nem hívjuk újra az AI-t — a régi hibákat klónozzuk.
                </div>
              </div>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Mégse
          </Button>
          <Button
            disabled={pending || !canSubmit}
            onClick={() => {
              onStart({
                languages: langs
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                skins,
                baseUrl,
                costCapUsd: cost,
                email: email.trim(),
                password: password.trim(),
                maxPagesPerCombo: maxPages,
                diffMode,
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
    if (open && q.data) setText(formatRoutesText(q.data));
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
            <Badge variant="secondary" className="ml-1">
              {savedCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Elvárt oldalak — a kylo.study checklistája</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add meg a kylo.study összes olyan útvonalát, amit szeretnél lefedni. A robot minden futásnál ellenőrzi,
            hogy ezek mind el lettek-e érve.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[320px] font-mono text-xs"
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
          <Button disabled={mut.isPending} onClick={() => mut.mutate(parseRoutesText(text))}>
            {mut.isPending ? "Mentés…" : "Mentés"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
