import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Clock, Play, Pause, Pencil, Trash2, Plus } from "lucide-react";

import {
  listAuditQaSchedules,
  upsertAuditQaSchedule,
  deleteAuditQaSchedule,
  toggleAuditQaSchedule,
} from "@/lib/audit-qa-schedules.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Előre gyártott cron minták — a legtöbb esetet lefedik, egyéni is megadható.
const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Naponta reggel 3:00-kor", value: "0 3 * * *" },
  { label: "Naponta 9:00-kor", value: "0 9 * * *" },
  { label: "Hétköznap 6:00", value: "0 6 * * 1-5" },
  { label: "Hetente hétfőn 9:00", value: "0 9 * * 1" },
  { label: "6 óránként", value: "0 */6 * * *" },
  { label: "Óránként", value: "0 * * * *" },
  { label: "Egyéni…", value: "custom" },
];

// A skinek + presetek a fő dialóggal egyeznek meg.
const SKIN_OPTIONS = [
  { value: "magic-school", label: "Magic School" },
  { value: "alaska", label: "Alaska" },
  { value: "puppy-cat", label: "Puppy Cat" },
] as const;

const TRANSLATION_LANGS = ["hu", "en-GB", "de", "es", "fr", "it", "pl", "pt", "ro"];

type ScheduleRow = Awaited<ReturnType<typeof listAuditQaSchedules>>[number];

export function SchedulesPanel() {
  const listFn = useServerFn(listAuditQaSchedules);
  const deleteFn = useServerFn(deleteAuditQaSchedule);
  const toggleFn = useServerFn(toggleAuditQaSchedule);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["audit-qa-schedules"], queryFn: () => listFn(), refetchInterval: 15_000 });
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Ütemezés törölve.");
      qc.invalidateQueries({ queryKey: ["audit-qa-schedules"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-qa-schedules"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const rows = q.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> Ütemezések
        </CardTitle>
        <Button size="sm" onClick={() => setOpenNew(true)}>
          <Plus className="h-4 w-4 mr-1" /> Új ütemezés
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            Még nincs ütemezés. Kattints az „Új ütemezés" gombra, és a rendszer napi/óránkénti QA-t
            fog futtatni automatikusan (diff-módban, olcsón).
          </div>
        )}
        <div className="divide-y">
          {rows.map((r) => (
            <div key={r.id} className="p-3 flex items-start gap-3 hover:bg-muted/30">
              <button
                type="button"
                className="mt-0.5 shrink-0"
                title={r.enabled ? "Szüneteltetés" : "Aktiválás"}
                onClick={() => toggleMut.mutate({ id: r.id, enabled: !r.enabled })}
              >
                {r.enabled ? <Play className="h-4 w-4 text-green-500" /> : <Pause className="h-4 w-4 text-muted-foreground" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="font-medium truncate">{r.name}</div>
                  {r.preset === "translation" && <Badge variant="secondary">Fordítás</Badge>}
                  {r.preset === "visual" && <Badge variant="secondary">Megjelenés</Badge>}
                  {!r.enabled && <Badge variant="outline">szünetel</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-mono">{r.cron_expression}</span> · {r.timezone} · {r.languages.length} nyelv · {r.skins.length} skin
                  {r.diff_mode ? " · diff-mód" : ""}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Következő: {r.next_run_at ? new Date(r.next_run_at).toLocaleString() : "—"}
                  {r.last_run_at && ` · Utolsó: ${new Date(r.last_run_at).toLocaleString()}${r.last_run_status ? ` (${r.last_run_status})` : ""}`}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(r)} aria-label="Szerkesztés">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(`Törlöd az ütemezést: „${r.name}"?`)) delMut.mutate(r.id);
                  }}
                  aria-label="Törlés"
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      {openNew && (
        <ScheduleEditor
          initial={null}
          onClose={() => setOpenNew(false)}
          onSaved={() => {
            setOpenNew(false);
            qc.invalidateQueries({ queryKey: ["audit-qa-schedules"] });
          }}
        />
      )}
      {editing && (
        <ScheduleEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["audit-qa-schedules"] });
          }}
        />
      )}
    </Card>
  );
}

function ScheduleEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: ScheduleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsertFn = useServerFn(upsertAuditQaSchedule);

  const [name, setName] = useState(initial?.name ?? "Napi QA – Kylo.study");
  const [preset, setPreset] = useState<"translation" | "visual" | "custom">(
    (initial?.preset as "translation" | "visual" | "custom" | null) ?? "translation",
  );
  const [cronPreset, setCronPreset] = useState<string>(
    initial ? (CRON_PRESETS.find((c) => c.value === initial.cron_expression)?.value ?? "custom") : "0 3 * * *",
  );
  const [cronExpr, setCronExpr] = useState(initial?.cron_expression ?? "0 3 * * *");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "Europe/Budapest");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "https://kylo.study");
  const [langs, setLangs] = useState<string>(
    initial ? initial.languages.join(",") : TRANSLATION_LANGS.join(","),
  );
  const [skins, setSkins] = useState<string[]>(initial?.skins ?? ["magic-school"]);
  const [diffMode, setDiffMode] = useState<boolean>(initial?.diff_mode ?? true);
  const [costCap, setCostCap] = useState<number>(Number(initial?.cost_cap_usd ?? 30));
  const [maxPages, setMaxPages] = useState<number>(Number(initial?.max_pages_per_combo ?? 300));
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);

  function applyPreset(p: "translation" | "visual" | "custom") {
    setPreset(p);
    if (p === "translation") {
      setLangs(TRANSLATION_LANGS.join(","));
      setSkins(["magic-school"]);
      setName((n) => (n && n !== "Napi QA – Kylo.study" ? n : "Napi fordítás-teszt"));
    } else if (p === "visual") {
      setLangs("en-GB");
      setSkins(SKIN_OPTIONS.map((s) => s.value));
      setName((n) => (n && n !== "Napi QA – Kylo.study" ? n : "Napi megjelenés-teszt"));
    }
  }

  const upsertMut = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          id: initial?.id ?? null,
          name,
          enabled,
          cronExpression: cronExpr,
          timezone,
          baseUrl,
          languages: langs.split(",").map((s) => s.trim()).filter(Boolean),
          skins,
          diffMode,
          costCapUsd: costCap,
          maxPagesPerCombo: maxPages,
          preset,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        `Ütemezés mentve. Következő futás: ${res.nextRunAt ? new Date(res.nextRunAt).toLocaleString() : "—"}`,
      );
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Ütemezés szerkesztése" : "Új ütemezés"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Név</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <Label>Preset</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              <Button
                size="sm"
                variant={preset === "translation" ? "default" : "outline"}
                onClick={() => applyPreset("translation")}
              >
                Fordítás-teszt
              </Button>
              <Button
                size="sm"
                variant={preset === "visual" ? "default" : "outline"}
                onClick={() => applyPreset("visual")}
              >
                Megjelenés-teszt
              </Button>
              <Button
                size="sm"
                variant={preset === "custom" ? "default" : "outline"}
                onClick={() => setPreset("custom")}
              >
                Egyéni
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              A preset kitölti a nyelveket és skineket, de kézzel bármit felülírhatsz.
            </p>
          </div>

          <div>
            <Label>Cron kifejezés</Label>
            <Select
              value={cronPreset}
              onValueChange={(v) => {
                setCronPreset(v);
                if (v !== "custom") setCronExpr(v);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cronPreset === "custom" && (
              <Input className="mt-2 font-mono" value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="0 3 * * *" />
            )}
            <p className="text-xs text-muted-foreground mt-1 font-mono">{cronExpr} · {timezone}</p>
          </div>

          <div>
            <Label>Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>

          <div>
            <Label>Nyelvek (vesszővel)</Label>
            <Input value={langs} onChange={(e) => setLangs(e.target.value)} />
          </div>

          <div>
            <Label>Skinek</Label>
            <div className="grid gap-2">
              {SKIN_OPTIONS.map((skin) => {
                const checked = skins.includes(skin.value);
                return (
                  <label
                    key={skin.value}
                    className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border p-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => {
                        setSkins((current) => {
                          if (next === true) return current.includes(skin.value) ? current : [...current, skin.value];
                          const filtered = current.filter((v) => v !== skin.value);
                          return filtered.length > 0 ? filtered : current;
                        });
                      }}
                    />
                    <span className="truncate">{skin.label} <span className="text-xs text-muted-foreground">({skin.value})</span></span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Költségplafon (USD)</Label>
              <Input type="number" value={costCap} onChange={(e) => setCostCap(Number(e.target.value))} />
            </div>
            <div>
              <Label>Max oldal / kombináció</Label>
              <Input type="number" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} />
            </div>
          </div>

          <div className="rounded-md border p-3 bg-muted/30">
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={diffMode} onCheckedChange={(v) => setDiffMode(v === true)} className="mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium">Diff-mód</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Csak azokat az oldalakat elemzi az AI, amiknek megváltozott a tartalma. Ütemezett futáshoz erősen ajánlott.
                </div>
              </div>
            </label>
          </div>

          <div className="rounded-md border p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} className="mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium">Aktív</div>
                <div className="text-xs text-muted-foreground mt-0.5">Kikapcsolva nem indul automatikusan.</div>
              </div>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={upsertMut.isPending}>Mégse</Button>
          <Button onClick={() => upsertMut.mutate()} disabled={upsertMut.isPending}>
            {upsertMut.isPending ? "Mentés…" : "Mentés"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
