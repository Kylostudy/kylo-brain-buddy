import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";

import { listAuditQaAggregatedIssues } from "@/lib/audit-qa.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const SEVERITY_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2, info: 3 };

/**
 * Összesített hibanapló. Alapértelmezésben CSAK a legutolsó befejezett futást
 * mutatja, nyitott hibákra szűrve és duplikáció nélkül — így a riport valóban
 * azt tükrözi, mi van még nyitva.
 */
export function QaErrorLog() {
  const fn = useServerFn(listAuditQaAggregatedIssues);
  const [open, setOpen] = useState(false);
  const [runLimit, setRunLimit] = useState(1);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [dedupe, setDedupe] = useState(true);

  const { data } = useQuery({
    queryKey: ["audit-qa-aggregated-issues", runLimit, onlyOpen, dedupe],
    queryFn: () => fn({ data: { runLimit, onlyOpen, dedupe } }),
    refetchInterval: 30000,
  });

  const issues = useMemo(() => {
    const rows = data?.issues ?? [];
    return [...rows].sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
    );
  }, [data]);

  const byLang = useMemo(() => {
    const m: Record<string, typeof issues> = {};
    for (const i of issues) {
      const lang = i.language ?? "?";
      (m[lang] = m[lang] ?? []).push(i);
    }
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [issues]);

  if (!data) return null;

  const runsMeta = data.runs;

  function buildText() {
    const d = data!;
    const lines: string[] = [];
    lines.push(
      runLimit === 1
        ? "KYLO.STUDY QA — HIBANAPLÓ (LEGUTOLSÓ BEFEJEZETT FUTÁS)"
        : `KYLO.STUDY QA — ÖSSZESÍTETT HIBANAPLÓ (utolsó ${d.runs.length} befejezett futás)`,
    );
    lines.push(`Készült: ${new Date().toLocaleString("hu-HU")}`);
    for (const r of d.runs) {
      lines.push(
        `Futás: ${r.id} · ${r.status} · indult: ${
          r.started_at ? new Date(r.started_at).toLocaleString("hu-HU") : "?"
        }${r.finished_at ? ` · vége: ${new Date(r.finished_at).toLocaleString("hu-HU")}` : ""}`,
      );
    }
    lines.push(`Szűrés: ${onlyOpen ? "csak nyitott hibák" : "minden hiba"}${dedupe ? " · duplikátumok összevonva" : ""}`);
    lines.push(
      `Megjelenített hibák: ${issues.length}${
        dedupe && d.totalRaw !== issues.length ? ` (nyers sorok: ${d.totalRaw})` : ""
      }`,
    );
    if (d.truncated) lines.push("FIGYELEM: a lista elérte a 10000 soros felső határt, nem teljes.");
    lines.push("");
    for (const [lang, list] of byLang) {
      lines.push(`── ${lang} (${list.length} hiba) ──`);
      for (const i of list) {
        lines.push(
          `[${i.severity}/${i.category}] ${i.page_url} (skin: ${i.skin ?? "?"})` +
            (i.occurrence_count && i.occurrence_count > 1 ? ` ×${i.occurrence_count}` : "") +
            `\n  Diagnózis: ${i.ai_diagnosis ?? "—"}` +
            (i.problematic_text ? `\n  Szöveg: "${i.problematic_text.slice(0, 200)}"` : "") +
            (i.ai_suggested_fix ? `\n  Javaslat: ${i.ai_suggested_fix}` : ""),
        );
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(buildText());
      toast.success(`${issues.length} hiba a vágólapon.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Hibanapló ({issues.length})
          </button>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">Futások</Label>
            <Select value={String(runLimit)} onValueChange={(v) => setRunLimit(Number(v))}>
              <SelectTrigger className="h-8 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Csak a legutolsó</SelectItem>
                <SelectItem value="3">Utolsó 3</SelectItem>
                <SelectItem value="5">Utolsó 5</SelectItem>
                <SelectItem value="10">Utolsó 10</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={onlyOpen} onCheckedChange={(v) => setOnlyOpen(v === true)} />
            Csak nyitott
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={dedupe} onCheckedChange={(v) => setDedupe(v === true)} />
            Duplikátumok összevonva
          </label>
          <Button size="sm" variant="outline" onClick={copyAll} disabled={issues.length === 0}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Vágólapra
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="text-xs text-muted-foreground">
          {runsMeta.length === 0
            ? "Még nincs befejezett futás."
            : runsMeta
                .map(
                  (r) =>
                    `${r.status} · ${
                      r.started_at ? new Date(r.started_at).toLocaleString("hu-HU") : "?"
                    }`,
                )
                .join(" | ")}
          {dedupe && data.totalRaw !== issues.length
            ? ` · nyers sorok: ${data.totalRaw}, összevonás után: ${issues.length}`
            : ""}
          {data.truncated ? " · FIGYELEM: 10000 soros felső határ elérve" : ""}
        </div>

        {open && issues.length > 0 && (
          <div className="space-y-4">
            {byLang.map(([lang, list]) => (
              <div key={lang} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{lang}</Badge>
                  <span className="text-xs text-muted-foreground">{list.length} hiba</span>
                </div>
                <div className="space-y-1 rounded-md border p-2">
                  {list.slice(0, 50).map((i) => (
                    <div key={i.id} className="text-xs [overflow-wrap:anywhere]">
                      <span className="font-medium">[{i.severity}]</span> {i.page_url}
                      {i.skin ? ` · ${i.skin}` : ""} — {i.ai_diagnosis ?? "—"}
                    </div>
                  ))}
                  {list.length > 50 && (
                    <div className="text-xs text-muted-foreground">
                      …és további {list.length - 50} hiba (a vágólapra másolás mindet tartalmazza)
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
