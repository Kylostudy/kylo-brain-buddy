import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardCopy, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type BatchRun = {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  spec_snapshot: unknown;
  result: unknown;
  error: string | null;
};

type SignupSpec = {
  skin?: string;
  lang?: string;
  currency?: string;
  email?: string;
  expected_country?: string | null;
  run_index?: number;
  batch_id?: string;
  batch_scope?: string;
  batch_started_at?: string;
  batch_size?: number;
};

type SignupResult = {
  reached_stripe?: boolean;
  final_url?: string;
  steps?: Array<Record<string, unknown>>;
  criteria?: Record<string, boolean>;
  criteria_failed?: string[];
  language_checks?: Array<{
    label: string;
    url?: string;
    ok?: boolean | null;
    html_lang?: string | null;
    reason?: string | null;
  }>;
  ai_explanation?: { text?: string };
};

function readSpec(spec: unknown): SignupSpec {
  if (!spec || typeof spec !== "object") return {};
  return ((spec as { kylo_signup?: SignupSpec }).kylo_signup ?? {}) as SignupSpec;
}

function readRes(r: unknown): SignupResult {
  if (!r || typeof r !== "object") return {};
  return r as SignupResult;
}

const SCOPE_LABEL: Record<string, string> = {
  english: "Angol kör",
  "non-english": "Nem-angol kör",
  all: "Összes proxy",
};

function isFailed(status: string) {
  return status === "failed" || status === "timed_out" || status === "cancelled";
}

function runBlock(run: BatchRun): string {
  const spec = readSpec(run.spec_snapshot);
  const res = readRes(run.result);
  const lines: string[] = [];
  lines.push(
    `--- Futás #${spec.run_index ?? "?"} (run_id: ${run.id}) ---`,
  );
  lines.push(
    `Státusz: ${run.status} | Ország: ${spec.expected_country ?? "?"} | Nyelv: ${spec.lang ?? "?"} | Valuta: ${spec.currency ?? "?"} | Skin: ${spec.skin ?? "?"}`,
  );
  lines.push(`Alias: ${spec.email ?? "?"}`);
  lines.push(
    `Idő: ${run.started_at ? new Date(run.started_at).toLocaleString("hu-HU") : "?"} → ${run.finished_at ? new Date(run.finished_at).toLocaleString("hu-HU") : "—"}`,
  );
  lines.push(`Végállomás URL: ${res.final_url ?? "—"}`);
  lines.push(`Eljutott a Stripe-ig: ${res.reached_stripe === true ? "igen" : "nem"}`);
  lines.push(`Hibaüzenet: ${run.error ?? "—"}`);

  const failedCriteria =
    res.criteria_failed && res.criteria_failed.length > 0
      ? res.criteria_failed
      : Object.entries(res.criteria ?? {})
          .filter(([, v]) => !v)
          .map(([k]) => k);
  if (failedCriteria.length > 0) {
    lines.push(`Nem teljesült kritériumok: ${failedCriteria.join(", ")}`);
  }

  const langBad = (res.language_checks ?? []).filter((c) => c.ok === false);
  if (langBad.length > 0) {
    lines.push("Nyelvi hibák:");
    for (const c of langBad) {
      lines.push(`  - ${c.label} (lang=${c.html_lang ?? "?"}): ${c.reason ?? "nem a várt nyelv"}${c.url ? ` · ${c.url}` : ""}`);
    }
  }

  const steps = Array.isArray(res.steps) ? res.steps : [];
  if (steps.length > 0) {
    lines.push(`Utolsó lépések (${Math.min(8, steps.length)} / ${steps.length}):`);
    for (const s of steps.slice(-8)) {
      lines.push(`  - ${JSON.stringify(s)}`);
    }
  }

  if (res.ai_explanation?.text) {
    lines.push(`AI elemzés: ${res.ai_explanation.text.replace(/\*\*/g, "")}`);
  }
  return lines.join("\n");
}

export function buildBatchReport(batchId: string, runs: BatchRun[]): string {
  const first = readSpec(runs[0]?.spec_snapshot);
  const failed = runs.filter((r) => isFailed(r.status));
  const ok = runs.filter((r) => r.status === "succeeded").length;
  const header = [
    "KYLO SIGN UP — HIBÁS FUTÁSOK ÖSSZESÍTETT NAPLÓJA",
    `Batch: ${SCOPE_LABEL[first.batch_scope ?? ""] ?? first.batch_scope ?? "?"} (batch_id: ${batchId})`,
    `Batch indítva: ${first.batch_started_at ? new Date(first.batch_started_at).toLocaleString("hu-HU") : "?"}`,
    `Futások: ${runs.length} · sikeres: ${ok} · hibás: ${failed.length}`,
    `Hibás futások sorszámai: ${failed.map((r) => `#${readSpec(r.spec_snapshot).run_index ?? "?"}`).join(", ") || "—"}`,
    "",
  ].join("\n");
  if (failed.length === 0) return `${header}Ebben a körben nem volt hibás futás.`;
  return header + failed.map(runBlock).join("\n\n");
}

export function BatchErrorReports({ runs }: { runs: BatchRun[] }) {
  const batches = useMemo(() => {
    const map = new Map<string, BatchRun[]>();
    for (const r of runs) {
      const id = readSpec(r.spec_snapshot).batch_id;
      if (!id) continue;
      const arr = map.get(id) ?? [];
      arr.push(r);
      map.set(id, arr);
    }
    return Array.from(map.entries())
      .map(([id, list]) => {
        const sorted = [...list].sort(
          (a, b) => (readSpec(a.spec_snapshot).run_index ?? 0) - (readSpec(b.spec_snapshot).run_index ?? 0),
        );
        return { id, runs: sorted, spec: readSpec(sorted[0].spec_snapshot) };
      })
      .sort((a, b) =>
        (b.spec.batch_started_at ?? "").localeCompare(a.spec.batch_started_at ?? ""),
      );
  }, [runs]);

  if (batches.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tömeges indítások — hibanapló Kailónak</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Minden tömeges indítás (angol kör, nem-angol kör) külön csoportot kap. A
          „Vágólapra másolás" gomb a csoport összes hibás futását egyben, futás-azonosítóval
          együtt átmásolja.
        </p>
        {batches.map((b) => (
          <BatchRow key={b.id} batchId={b.id} runs={b.runs} spec={b.spec} />
        ))}
      </CardContent>
    </Card>
  );
}

function BatchRow({
  batchId,
  runs,
  spec,
}: {
  batchId: string;
  runs: BatchRun[];
  spec: SignupSpec;
}) {
  const [open, setOpen] = useState(false);
  const failed = runs.filter((r) => isFailed(r.status));
  const ok = runs.filter((r) => r.status === "succeeded").length;
  const pending = runs.length - failed.length - ok;
  const report = buildBatchReport(batchId, runs);

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-1"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Bezárás" : "Kinyitás"}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>
        <span className="font-medium">
          {SCOPE_LABEL[spec.batch_scope ?? ""] ?? "Tömeges indítás"}
        </span>
        <span className="text-xs text-muted-foreground">
          {spec.batch_started_at ? new Date(spec.batch_started_at).toLocaleString("hu-HU") : ""}
        </span>
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
          sikeres: {ok}
        </Badge>
        <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-red-400">
          hibás: {failed.length}
        </Badge>
        {pending > 0 && <Badge variant="outline">folyamatban: {pending}</Badge>}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={failed.length === 0}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(report);
              toast.success(`${failed.length} hibás futás naplója a vágólapon.`);
            } catch {
              toast.error("A böngésző nem engedte a vágólapra másolást.");
            }
          }}
          title={
            failed.length === 0
              ? "Ebben a körben nincs hibás futás"
              : "Az összes hibás futás naplója egyben"
          }
        >
          <ClipboardCopy className="size-4" />
          <span className="ml-1.5">Vágólapra másolás</span>
        </Button>
      </div>
      {open && (
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words border-t bg-background/40 p-2 text-xs [overflow-wrap:anywhere]">
          {report}
        </pre>
      )}
    </div>
  );
}
