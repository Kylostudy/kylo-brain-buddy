import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";

import { listAuditQaAggregatedIssues } from "@/lib/audit-qa.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SEVERITY_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2, info: 3 };

/** Összesített hibanapló az utolsó futásokból — lenyitható és vágólapra másolható. */
export function QaErrorLog({ runLimit = 10 }: { runLimit?: number }) {
  const fn = useServerFn(listAuditQaAggregatedIssues);
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["audit-qa-aggregated-issues", runLimit],
    queryFn: () => fn({ data: { runLimit } }),
    refetchInterval: 15000,
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

  if (!data || issues.length === 0) return null;

  function buildText() {
    const lines: string[] = [];
    lines.push(`KYLO.STUDY QA — ÖSSZESÍTETT HIBANAPLÓ (utolsó ${data!.runs.length} futás)`);
    lines.push(`Készült: ${new Date().toLocaleString("hu-HU")}`);
    lines.push(`Összes hiba: ${issues.length}`);
    lines.push("");
    for (const [lang, list] of byLang) {
      lines.push(`── ${lang} (${list.length} hiba) ──`);
      for (const i of list) {
        lines.push(
          `[${i.severity}/${i.category}] ${i.page_url} (skin: ${i.skin ?? "?"})\n` +
            `  Diagnózis: ${i.ai_diagnosis ?? "—"}` +
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
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Összesített hibanapló ({issues.length})
          </button>
        </CardTitle>
        <Button size="sm" variant="outline" onClick={copyAll}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Vágólapra
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4 text-sm">
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
        </CardContent>
      )}
    </Card>
  );
}
