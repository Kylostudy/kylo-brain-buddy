import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Video, Play, Plus, Copy, Trash2, Download } from "lucide-react";

import {
  listScenarioLibrary,
  upsertScenario,
  deleteScenario,
  duplicateScenario,
  upsertExamType,
  deleteExamType,
  ensureScenarioWorkflow,
  importRecordedSteps,
  startScenarioRun,
} from "@/lib/audit-scenarios.functions";
import { startRecording } from "@/lib/recording.functions";
import { BrowserRecorderModal } from "@/components/browser-recorder-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useModule } from "@/lib/module/provider";

export const Route = createFileRoute("/_authenticated/audit/scenarios")({
  head: () => ({
    meta: [
      { title: "Teszt-forgatókönyvek — KyloAudit" },
      {
        name: "description",
        content:
          "Újrahasznosítható teszt-forgatókönyvek és építőkockák a Kylo.study funkcióihoz, kettős AI-értékeléssel és nyelvvizsga-mátrixszal.",
      },
      { property: "og:title", content: "Teszt-forgatókönyvek — KyloAudit" },
      { property: "og:description", content: "Forgatókönyv-alapú funkciótesztek kettős AI-értékeléssel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScenariosPage,
});

type Scenario = {
  id: string;
  name: string;
  feature_tag: string | null;
  description: string | null;
  kind: string;
  base_url: string;
  record_start_url?: string | null;
  steps: unknown;
  prelude_block_ids: string[] | null;
  expectations: Record<string, unknown> | null;
  run_per_exam: boolean;
  is_active: boolean;
  sort_order: number;
  workflow_id: string | null;
};

type ExamType = {
  id: string;
  code: string;
  label: string;
  expected_features: string[] | null;
  sort_order: number;
  is_active: boolean;
};

type Verdict = {
  id: string;
  scenario_id: string | null;
  run_id: string | null;
  exam_code: string | null;
  score: number | null;
  passed: boolean | null;
  summary: string | null;
  observer: unknown;
  judge: unknown;
  created_at: string;
};

const emptyDraft = {
  id: null as string | null,
  name: "",
  featureTag: "",
  description: "",
  kind: "scenario" as "scenario" | "block",
  baseUrl: "https://kylo.study",
  recordStartUrl: "",
  preludeBlockIds: [] as string[],
  expectationsText: "",
  runPerExam: false,
  isActive: true,
  sortOrder: 0,
  stepCount: 0,
  workflowId: null as string | null,
};

function stepsOf(s: Scenario): unknown[] {
  return Array.isArray(s.steps) ? (s.steps as unknown[]) : [];
}

function ScenariosPage() {
  const { forceModule } = useModule();
  const qc = useQueryClient();

  const listFn = useServerFn(listScenarioLibrary);
  const saveFn = useServerFn(upsertScenario);
  const delFn = useServerFn(deleteScenario);
  const dupFn = useServerFn(duplicateScenario);
  const saveExamFn = useServerFn(upsertExamType);
  const delExamFn = useServerFn(deleteExamType);
  const ensureWfFn = useServerFn(ensureScenarioWorkflow);
  const importFn = useServerFn(importRecordedSteps);
  const runFn = useServerFn(startScenarioRun);
  const recordFn = useServerFn(startRecording);

  const [draft, setDraft] = useState<typeof emptyDraft | null>(null);
  const [examDraft, setExamDraft] = useState<{
    id: string | null;
    code: string;
    label: string;
    featuresText: string;
    sortOrder: number;
    isActive: boolean;
  } | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordSessionId, setRecordSessionId] = useState<string | null>(null);
  const [openVerdict, setOpenVerdict] = useState<Verdict | null>(null);

  useEffect(() => {
    forceModule("audit");
  }, [forceModule]);

  const q = useQuery({
    queryKey: ["audit-scenario-library"],
    queryFn: () => listFn(),
    refetchInterval: 20_000,
  });

  const scenarios = (q.data?.scenarios ?? []) as Scenario[];
  const examTypes = (q.data?.examTypes ?? []) as ExamType[];
  const verdicts = (q.data?.verdicts ?? []) as Verdict[];

  const blocks = useMemo(() => scenarios.filter((s) => s.kind === "block"), [scenarios]);
  const tests = useMemo(() => scenarios.filter((s) => s.kind !== "block"), [scenarios]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["audit-scenario-library"] });

  const saveMut = useMutation({
    mutationFn: async (d: typeof emptyDraft) => {
      let expectations: Record<string, unknown> = {};
      if (d.expectationsText.trim()) {
        const lines = d.expectationsText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        expectations = { checklist: lines };
      }
      const existing = d.id ? scenarios.find((s) => s.id === d.id) : null;
      return saveFn({
        data: {
          id: d.id,
          name: d.name,
          featureTag: d.featureTag || null,
          description: d.description || null,
          kind: d.kind,
          baseUrl: d.baseUrl,
          recordStartUrl: d.recordStartUrl || null,
          steps: (existing ? stepsOf(existing) : []) as Record<string, unknown>[],
          preludeBlockIds: d.preludeBlockIds,
          expectations,
          runPerExam: d.runPerExam,
          isActive: d.isActive,
          sortOrder: d.sortOrder,
        },
      });
    },
    onSuccess: () => {
      toast.success("Forgatókönyv mentve.");
      setDraft(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const examMut = useMutation({
    mutationFn: async (d: NonNullable<typeof examDraft>) =>
      saveExamFn({
        data: {
          id: d.id,
          code: d.code,
          label: d.label,
          expectedFeatures: d.featuresText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
          sortOrder: d.sortOrder,
          isActive: d.isActive,
        },
      }),
    onSuccess: () => {
      toast.success("Vizsgatípus mentve.");
      setExamDraft(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordMut = useMutation({
    mutationFn: async (scenario: Scenario) => {
      const wf = await ensureWfFn({ data: { scenarioId: scenario.id } });
      const session = await recordFn({
        data: { workflowId: wf.workflowId, startUrl: scenario.record_start_url || scenario.base_url },
      });
      return session;
    },
    onSuccess: (session: { sessionId?: string; id?: string }) => {
      setRecordSessionId(session.sessionId ?? session.id ?? null);
      setRecordOpen(true);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importMut = useMutation({
    mutationFn: async (id: string) => importFn({ data: { scenarioId: id } }),
    onSuccess: (r: { stepCount: number }) => {
      toast.success(`${r.stepCount} lépés importálva a felvételből.`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMut = useMutation({
    mutationFn: async (v: { id: string; parallel: number }) =>
      runFn({ data: { scenarioId: v.id, parallel: v.parallel } }),
    onSuccess: (r: { count: number; stepCount: number }) => {
      toast.success(`${r.count} futás sorba téve (${r.stepCount} lépés, mindegyik friss belépéssel).`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verdictsByScenario = useMemo(() => {
    const m = new Map<string, Verdict[]>();
    for (const v of verdicts) {
      if (!v.scenario_id) continue;
      const arr = m.get(v.scenario_id) ?? [];
      arr.push(v);
      m.set(v.scenario_id, arr);
    }
    return m;
  }, [verdicts]);

  function openEditor(s?: Scenario, kind: "scenario" | "block" = "scenario") {
    if (!s) {
      setDraft({ ...emptyDraft, kind });
      return;
    }
    const checklist = Array.isArray((s.expectations as { checklist?: unknown })?.checklist)
      ? ((s.expectations as { checklist: string[] }).checklist as string[])
      : [];
    setDraft({
      id: s.id,
      name: s.name,
      featureTag: s.feature_tag ?? "",
      description: s.description ?? "",
      kind: (s.kind === "block" ? "block" : "scenario") as "scenario" | "block",
      baseUrl: s.base_url,
      recordStartUrl: s.record_start_url ?? "",
      preludeBlockIds: s.prelude_block_ids ?? [],
      expectationsText: checklist.join("\n"),
      runPerExam: s.run_per_exam,
      isActive: s.is_active,
      sortOrder: s.sort_order,
      stepCount: stepsOf(s).length,
      workflowId: s.workflow_id,
    });
  }

  function exportVerdicts() {
    const blob = new Blob([JSON.stringify(verdicts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kylo-audit-iteletek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderScenarioCard(s: Scenario) {
    const vs = verdictsByScenario.get(s.id) ?? [];
    const last = vs[0];
    return (
      <div key={s.id} className="rounded-lg border p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.name}</span>
          {s.feature_tag && <Badge variant="outline">{s.feature_tag}</Badge>}
          {!s.is_active && <Badge variant="secondary">inaktív</Badge>}
          {s.run_per_exam && <Badge variant="outline">vizsgánként fut</Badge>}
          <Badge variant="secondary">{stepsOf(s).length} lépés</Badge>
          {last && (
            <Badge
              className={
                last.passed
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                  : "bg-red-500/15 text-red-400 border-red-500/40"
              }
            >
              {last.passed ? "átment" : "megbukott"} {last.score ?? "-"}
            </Badge>
          )}
        </div>
        {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => recordMut.mutate(s)} disabled={recordMut.isPending}>
            <Video className="size-4" /> Felvétel
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => importMut.mutate(s.id)}
            disabled={!s.workflow_id || importMut.isPending}
          >
            Felvett lépések importja
          </Button>
          <Button size="sm" onClick={() => runMut.mutate({ id: s.id, parallel: 1 })} disabled={runMut.isPending}>
            <Play className="size-4" /> Futtatás
          </Button>
          {s.kind !== "block" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => runMut.mutate({ id: s.id, parallel: 10 })}
              disabled={runMut.isPending}
            >
              <Play className="size-4" /> 10 párhuzamos futás
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => openEditor(s)}>
            Szerkesztés
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dupFn({ data: { id: s.id } }).then(invalidate)}>
            <Copy className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Biztosan törlöd: ${s.name}?`)) delFn({ data: { id: s.id } }).then(invalidate);
            }}
          >
            <Trash2 className="size-4 text-red-400" />
          </Button>
        </div>
        {vs.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {vs.slice(0, 12).map((v) => (
              <button
                key={v.id}
                onClick={() => setOpenVerdict(v)}
                className={`rounded border px-2 py-0.5 text-xs ${
                  v.passed
                    ? "border-emerald-500/40 text-emerald-400"
                    : "border-red-500/40 text-red-400"
                }`}
              >
                {v.exam_code ?? "általános"} · {v.score ?? "-"}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Teszt-forgatókönyvek</h1>
        <p className="text-sm text-muted-foreground">
          Egy motor, sok forgatókönyv: a bevált felvétel-visszajátszó motort használjuk minden teszthez. Az
          építőkockákat (pl. belépés) egyszer veszed fel, és bármelyik teszt elé beteheted.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Építőkockák</CardTitle>
          <Button size="sm" variant="outline" onClick={() => openEditor(undefined, "block")}>
            <Plus className="size-4" /> Új kocka
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {blocks.length === 0 && (
            <p className="text-sm text-muted-foreground">Még nincs kocka. Kezdd egy „Belépés” kockával.</p>
          )}
          {blocks.map(renderScenarioCard)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Forgatókönyvek</CardTitle>
          <Button size="sm" onClick={() => openEditor(undefined, "scenario")}>
            <Plus className="size-4" /> Új forgatókönyv
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {tests.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Még nincs forgatókönyv. Az első lehet például az olvasónapló tesztje.
            </p>
          )}
          {tests.map(renderScenarioCard)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Nyelvvizsga-típusok</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setExamDraft({ id: null, code: "", label: "", featuresText: "", sortOrder: 0, isActive: true })
            }
          >
            <Plus className="size-4" /> Új vizsgatípus
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {examTypes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Vedd fel a vizsgatípusokat (pl. IELTS, TOEFL), és jelöld, mely funkciókat várod el mindegyiknél.
            </p>
          )}
          {examTypes.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
              <Badge variant="outline">{e.code}</Badge>
              <span className="font-medium">{e.label}</span>
              <span className="text-muted-foreground">
                {(e.expected_features ?? []).length} elvárt funkció
              </span>
              {!e.is_active && <Badge variant="secondary">inaktív</Badge>}
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setExamDraft({
                      id: e.id,
                      code: e.code,
                      label: e.label,
                      featuresText: (e.expected_features ?? []).join("\n"),
                      sortOrder: e.sort_order,
                      isActive: e.is_active,
                    })
                  }
                >
                  Szerkesztés
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Törlöd: ${e.label}?`)) delExamFn({ data: { id: e.id } }).then(invalidate);
                  }}
                >
                  <Trash2 className="size-4 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Legutóbbi ítéletek</CardTitle>
          <Button size="sm" variant="outline" onClick={exportVerdicts} disabled={verdicts.length === 0}>
            <Download className="size-4" /> Export JSON
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {verdicts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Még nincs értékelés. Minden futás végén két külön AI néz rá: az egyik leírja, mit lát, a másik ez
              alapján dönt — így az értékelés nem befolyásolható.
            </p>
          )}
          {verdicts.slice(0, 25).map((v) => (
            <button
              key={v.id}
              onClick={() => setOpenVerdict(v)}
              className="flex w-full flex-wrap items-center gap-2 rounded border p-2 text-left text-sm hover:bg-muted/40"
            >
              <Badge
                className={
                  v.passed
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                    : "bg-red-500/15 text-red-400 border-red-500/40"
                }
              >
                {v.passed ? "átment" : "megbukott"}
              </Badge>
              <span className="font-medium">{v.score ?? "-"} pont</span>
              {v.exam_code && <Badge variant="outline">{v.exam_code}</Badge>}
              <span className="truncate text-muted-foreground">{v.summary ?? ""}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(v.created_at).toLocaleString("hu-HU")}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        <Link to="/audit/qa" className="underline">
          Vissza a Kylo.study QA-hoz
        </Link>
      </div>

      {/* Forgatókönyv szerkesztő */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "Szerkesztés" : draft?.kind === "block" ? "Új építőkocka" : "Új forgatókönyv"}
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Név</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="pl. Olvasónapló létrehozása"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Funkció címke</Label>
                  <Input
                    value={draft.featureTag}
                    onChange={(e) => setDraft({ ...draft, featureTag: e.target.value })}
                    placeholder="pl. olvasonaplo"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Alapcím</Label>
                  <Input
                    value={draft.baseUrl}
                    onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Felvétel indulási oldala</Label>
                <Input
                  value={draft.recordStartUrl}
                  onChange={(e) => setDraft({ ...draft, recordStartUrl: e.target.value })}
                  placeholder="pl. https://kylo.study/generalas"
                />
                <p className="text-xs text-muted-foreground">
                  Innen indul a böngészős felvétel (a funkciók / generálás oldal). Üresen hagyva az alapcímet
                  használjuk. A belépést nem kell felvenned: minden futás előtt a belépés kocka lefut.
                </p>
              </div>
              <div className="space-y-1">
                <Label>Leírás</Label>
                <Textarea
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Elvárások (soronként egy)</Label>
                <Textarea
                  rows={5}
                  value={draft.expectationsText}
                  onChange={(e) => setDraft({ ...draft, expectationsText: e.target.value })}
                  placeholder={"Az olvasónapló megjelenik a listában\nA cím a beírt szöveggel egyezik\nMinden felirat a beállított nyelven van"}
                />
                <p className="text-xs text-muted-foreground">
                  Ezeket kapja meg a Bíró — a képeket viszont csak a Megfigyelő látja.
                </p>
              </div>
              {draft.kind !== "block" && blocks.length > 0 && (
                <div className="space-y-2">
                  <Label>Előjáték-kockák (ezek futnak le először)</Label>
                  {blocks.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.preludeBlockIds.includes(b.id)}
                        onCheckedChange={(c) =>
                          setDraft({
                            ...draft,
                            preludeBlockIds: c
                              ? [...draft.preludeBlockIds, b.id]
                              : draft.preludeBlockIds.filter((x) => x !== b.id),
                          })
                        }
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={draft.runPerExam}
                    onCheckedChange={(c) => setDraft({ ...draft, runPerExam: c })}
                  />
                  Minden nyelvvizsgára lefuttatni
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={draft.isActive} onCheckedChange={(c) => setDraft({ ...draft, isActive: c })} />
                  Aktív
                </label>
              </div>
              {draft.id && (
                <p className="text-xs text-muted-foreground">
                  Jelenleg {draft.stepCount} felvett lépés. A lépéseket felvétellel rögzíted, majd az „Importálás”
                  gombbal hozod ide.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Mégse
            </Button>
            <Button
              onClick={() => draft && saveMut.mutate(draft)}
              disabled={!draft?.name.trim() || saveMut.isPending}
            >
              Mentés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vizsgatípus szerkesztő */}
      <Dialog open={!!examDraft} onOpenChange={(o) => !o && setExamDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{examDraft?.id ? "Vizsgatípus szerkesztése" : "Új vizsgatípus"}</DialogTitle>
          </DialogHeader>
          {examDraft && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Kód</Label>
                  <Input
                    value={examDraft.code}
                    onChange={(e) => setExamDraft({ ...examDraft, code: e.target.value })}
                    placeholder="IELTS"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Megnevezés</Label>
                  <Input
                    value={examDraft.label}
                    onChange={(e) => setExamDraft({ ...examDraft, label: e.target.value })}
                    placeholder="IELTS Academic"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Elvárt funkciók (soronként egy)</Label>
                <Textarea
                  rows={5}
                  value={examDraft.featuresText}
                  onChange={(e) => setExamDraft({ ...examDraft, featuresText: e.target.value })}
                  placeholder={"olvasonaplo\nszokincs-gyakorlo\nesszé-értékelő"}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={examDraft.isActive}
                  onCheckedChange={(c) => setExamDraft({ ...examDraft, isActive: c })}
                />
                Aktív
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExamDraft(null)}>
              Mégse
            </Button>
            <Button
              onClick={() => examDraft && examMut.mutate(examDraft)}
              disabled={!examDraft?.code.trim() || !examDraft?.label.trim() || examMut.isPending}
            >
              Mentés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ítélet részletek */}
      <Dialog open={!!openVerdict} onOpenChange={(o) => !o && setOpenVerdict(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Értékelés részletei</DialogTitle>
          </DialogHeader>
          {openVerdict && (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={
                    openVerdict.passed
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                      : "bg-red-500/15 text-red-400 border-red-500/40"
                  }
                >
                  {openVerdict.passed ? "átment" : "megbukott"}
                </Badge>
                <span>{openVerdict.score ?? "-"} pont</span>
                {openVerdict.exam_code && <Badge variant="outline">{openVerdict.exam_code}</Badge>}
              </div>
              {openVerdict.summary && <p>{openVerdict.summary}</p>}
              <div>
                <h3 className="mb-1 font-medium">Bíró (döntés)</h3>
                <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(openVerdict.judge, null, 2)}
                </pre>
              </div>
              <div>
                <h3 className="mb-1 font-medium">Megfigyelő (mit látott)</h3>
                <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(openVerdict.observer, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BrowserRecorderModal
        open={recordOpen}
        sessionId={recordSessionId}
        mode="record"
        onClose={() => {
          setRecordOpen(false);
          setRecordSessionId(null);
          invalidate();
        }}
      />
    </div>
  );
}
